import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { getAccess } from '../lib/access.ts';
import { EVENTS_CHANNEL, type AppointmentEvent } from '../lib/events.ts';

// Live calendar updates.
//   browser --WebSocket--> this server --LISTEN--> PostgreSQL <--NOTIFY-- any server that changed an appointment
// The browser subscribes to a business; owners receive every event of that
// business, staff members only the events of their own calendar.

interface Subscription {
  businessId: number;
  onlyStaffId: number | null;
}

const subscribeSchema = z.object({ type: z.literal('subscribe'), businessId: z.number().int().positive() });

export async function registerRealtime(app: FastifyInstance, ctx: AppContext) {
  const subscriptions = new Map<WebSocket, Subscription>();

  app.get('/api/ws', { websocket: true }, (socket, request) => {
    const user = request.user;
    if (!user) {
      socket.close(4401, 'unauthorized');
      return;
    }
    socket.on('message', async (raw) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = subscribeSchema.safeParse(message);
      if (!parsed.success) return;
      const access = await getAccess(ctx.db, user.id, parsed.data.businessId).catch(() => null);
      if (!access) {
        socket.send(JSON.stringify({ type: 'error', code: 'FORBIDDEN' }));
        return;
      }
      subscriptions.set(socket, {
        businessId: access.businessId,
        onlyStaffId: access.role === 'staff' ? access.ownStaffId : null,
      });
      socket.send(JSON.stringify({ type: 'subscribed', businessId: access.businessId }));
    });
    socket.on('close', () => subscriptions.delete(socket));
  });

  // One dedicated connection per server process listens for NOTIFY messages.
  const listener = await ctx.pool.connect();
  await listener.query(`LISTEN ${EVENTS_CHANNEL}`);
  listener.on('notification', (notification) => {
    if (!notification.payload) return;
    const event = JSON.parse(notification.payload) as AppointmentEvent;
    const message = JSON.stringify({ type: 'appointment', event });
    for (const [socket, sub] of subscriptions) {
      if (sub.businessId !== event.businessId) continue;
      if (sub.onlyStaffId !== null && sub.onlyStaffId !== event.staffId) continue;
      if (socket.readyState === socket.OPEN) socket.send(message);
    }
  });

  app.addHook('onClose', async () => {
    for (const socket of subscriptions.keys()) socket.close(1001, 'server shutting down');
    await listener.query(`UNLISTEN ${EVENTS_CHANNEL}`).catch(() => {});
    listener.release();
  });
}
