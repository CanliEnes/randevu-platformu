import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JOBS } from '../src/lib/queue.ts';
import { createJobHandlers } from '../src/modules/notifications.ts';
import { createTestEnv, istanbul, setupBusiness, type TestEnv } from './helpers.ts';

let env: TestEnv;
let shop: Awaited<ReturnType<typeof setupBusiness>>;
beforeAll(async () => (env = await createTestEnv()));
beforeEach(async () => {
  await env.reset();
  shop = await setupBusiness(env);
});
afterAll(async () => env.close());

async function bookAsCustomer() {
  const customer = env.client();
  await customer.register('customer@test.dev', 'Can Er');
  const appointment = (await customer.post('/api/appointments', {
    serviceId: shop.haircut.id, start: istanbul('2030-01-08', '10:00'),
  })).body.appointment;
  return { customer, appointment };
}

describe('e-mail jobs', () => {
  it('confirmation goes to the customer and the owner', async () => {
    const { appointment } = await bookAsCustomer();
    await createJobHandlers(env.ctx)[JOBS.confirmation]({ appointmentId: appointment.id });
    expect(env.mails.map((m) => [m.to, m.kind])).toEqual([
      ['customer@test.dev', 'confirmation'],
      ['owner@test.dev', 'owner-new'],
    ]);
    expect(env.mails[0]!.text).toContain('8 Ocak 2030 Salı, 10:00');
  });

  it('reminder is sent once, and not at all for a cancelled appointment', async () => {
    const { customer, appointment } = await bookAsCustomer();
    const handlers = createJobHandlers(env.ctx);

    await handlers[JOBS.reminder]({ appointmentId: appointment.id });
    await handlers[JOBS.reminder]({ appointmentId: appointment.id }); // a retried job
    expect(env.mails.filter((m) => m.kind === 'reminder')).toHaveLength(1);

    const second = (await customer.post('/api/appointments', {
      serviceId: shop.haircut.id, start: istanbul('2030-01-09', '10:00'),
    })).body.appointment;
    await customer.post(`/api/appointments/${second.id}/cancel`);
    await handlers[JOBS.reminder]({ appointmentId: second.id });
    expect(env.mails.filter((m) => m.kind === 'reminder')).toHaveLength(1);
  });
});

describe('live updates', () => {
  it('pushes new bookings to the owner and only own bookings to staff', async () => {
    const ownerSocket = await env.app.injectWS('/api/ws', { headers: { cookie: shop.owner.cookie! } });
    const aliSocket = await env.app.injectWS('/api/ws', { headers: { cookie: shop.aliClient.cookie! } });
    const received = { owner: [] as any[], ali: [] as any[] };
    ownerSocket.on('message', (m) => received.owner.push(JSON.parse(m.toString())));
    aliSocket.on('message', (m) => received.ali.push(JSON.parse(m.toString())));

    for (const socket of [ownerSocket, aliSocket]) socket.send(JSON.stringify({ type: 'subscribe', businessId: shop.business.id }));
    await waitFor(() => received.owner.length === 1 && received.ali.length === 1);

    const customer = env.client();
    await customer.register('live@test.dev');
    await customer.post('/api/appointments', { serviceId: shop.haircut.id, staffId: shop.banu.id, start: istanbul('2030-01-08', '10:00') });
    await customer.post('/api/appointments', { serviceId: shop.haircut.id, staffId: shop.ali.id, start: istanbul('2030-01-08', '11:00') });

    await waitFor(() => received.owner.length === 3 && received.ali.length === 2);
    expect(received.owner.slice(1).map((m) => m.event.staffId)).toEqual([shop.banu.id, shop.ali.id]);
    expect(received.ali[1].event).toMatchObject({ type: 'created', staffId: shop.ali.id });

    ownerSocket.terminate();
    aliSocket.terminate();
  });

  it('refuses anonymous connections and foreign businesses', async () => {
    const anonymous = await env.app.injectWS('/api/ws');
    const closed = await new Promise<number>((resolve) => anonymous.on('close', resolve));
    expect(closed).toBe(4401);

    const stranger = env.client();
    await stranger.register('s@test.dev');
    const socket = await env.app.injectWS('/api/ws', { headers: { cookie: stranger.cookie! } });
    const messages: any[] = [];
    socket.on('message', (m) => messages.push(JSON.parse(m.toString())));
    socket.send(JSON.stringify({ type: 'subscribe', businessId: shop.business.id }));
    await waitFor(() => messages.length === 1);
    expect(messages[0]).toEqual({ type: 'error', code: 'FORBIDDEN' });
    socket.terminate();
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
