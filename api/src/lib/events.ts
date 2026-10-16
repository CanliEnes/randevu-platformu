import { sql } from 'kysely';
import type { Db } from '../db/index.ts';

export const EVENTS_CHANNEL = 'appointment_events';

export interface AppointmentEvent {
  type: 'created' | 'cancelled' | 'updated';
  businessId: number;
  staffId: number;
  appointmentId: number;
}

/**
 * Publishes an event through PostgreSQL NOTIFY. Called inside the same
 * transaction as the change: PostgreSQL only delivers it if the transaction
 * commits, so listeners never hear about a booking that was rolled back.
 * Every API server LISTENs, so this also works with several server instances.
 */
export async function publishAppointmentEvent(db: Db, event: AppointmentEvent) {
  await sql`SELECT pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(event)})`.execute(db);
}
