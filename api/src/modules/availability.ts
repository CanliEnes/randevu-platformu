import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { badRequest, notFound, parse } from '../lib/errors.ts';
import { blocksToIntervals, dayBounds, isoWeekday, MINUTE, slotStarts, subtractIntervals, type Interval } from '../lib/slots.ts';

/** Customers cannot book an appointment that starts sooner than this. */
export const BOOKING_LEAD_MINUTES = 30;
/** ...or further ahead than this. */
export const BOOKING_HORIZON_DAYS = 60;
export const SLOT_STEP_MINUTES = 15;

export interface Slot {
  start: string; // ISO 8601 with the business' UTC offset
  staffIds: number[]; // who is free at that time
}

export interface AvailabilityInput {
  businessId: number;
  serviceId: number;
  date: string; // YYYY-MM-DD in the business time zone
  staffId?: number;
}

export async function computeAvailability(db: Db, now: Date, input: AvailabilityInput) {
  const business = await db.selectFrom('businesses').select('timezone').where('id', '=', input.businessId).executeTakeFirst();
  if (!business) throw notFound('İşletme');
  const zone = business.timezone;

  const service = await db
    .selectFrom('services')
    .select(['duration_minutes', 'price_cents'])
    .where('id', '=', input.serviceId)
    .where('business_id', '=', input.businessId)
    .where('active', '=', true)
    .executeTakeFirst();
  if (!service) throw notFound('Hizmet');

  const empty = { timezone: zone, durationMinutes: service.duration_minutes, slots: [] as Slot[] };

  const today = DateTime.fromJSDate(now, { zone }).startOf('day');
  const day = DateTime.fromISO(input.date, { zone });
  if (day < today || day > today.plus({ days: BOOKING_HORIZON_DAYS })) return empty;

  // 1. Who can perform this service?
  const staffRows = await db
    .selectFrom('staff')
    .innerJoin('staff_services', 'staff_services.staff_id', 'staff.id')
    .select('staff.id')
    .where('staff.business_id', '=', input.businessId)
    .where('staff.active', '=', true)
    .where('staff_services.service_id', '=', input.serviceId)
    .$if(input.staffId !== undefined, (qb) => qb.where('staff.id', '=', input.staffId!))
    .orderBy('staff.id')
    .execute();
  const staffIds = staffRows.map((s) => s.id);
  if (staffIds.length === 0) return empty;

  // 2. Their working blocks for this weekday, and everything that blocks time on this day.
  const bounds = dayBounds(input.date, zone);
  const dayRange = sql`tstzrange(${new Date(bounds.start)}::timestamptz, ${new Date(bounds.end)}::timestamptz, '[)')`;
  const [hours, appointments, timeOff] = await Promise.all([
    db.selectFrom('working_hours')
      .select(['staff_id', 'start_time', 'end_time'])
      .where('staff_id', 'in', staffIds)
      .where('weekday', '=', isoWeekday(input.date, zone))
      .execute(),
    db.selectFrom('appointments')
      .select(['staff_id', sql<Date>`lower(period)`.as('start'), sql<Date>`upper(period)`.as('end')])
      .where('staff_id', 'in', staffIds)
      .where('status', '<>', 'cancelled')
      .where(sql<boolean>`period && ${dayRange}`)
      .execute(),
    db.selectFrom('time_off')
      .select(['staff_id', sql<Date>`lower(period)`.as('start'), sql<Date>`upper(period)`.as('end')])
      .where('staff_id', 'in', staffIds)
      .where(sql<boolean>`period && ${dayRange}`)
      .execute(),
  ]);

  // 3. Free time = working blocks - busy time - "too soon"; then cut it into slots.
  const tooSoon: Interval = { start: 0, end: now.getTime() + BOOKING_LEAD_MINUTES * MINUTE };
  const byStart = new Map<number, number[]>();
  for (const staffId of staffIds) {
    const working = blocksToIntervals(
      input.date,
      zone,
      hours.filter((h) => h.staff_id === staffId).map((h) => ({ start: h.start_time, end: h.end_time })),
    );
    const busy = [...appointments, ...timeOff]
      .filter((b) => b.staff_id === staffId)
      .map((b) => ({ start: b.start.getTime(), end: b.end.getTime() }));
    const free = subtractIntervals(working, [...busy, tooSoon]);
    for (const start of slotStarts(free, service.duration_minutes * MINUTE, SLOT_STEP_MINUTES * MINUTE)) {
      byStart.set(start, [...(byStart.get(start) ?? []), staffId]);
    }
  }

  const slots: Slot[] = [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, ids]) => ({ start: DateTime.fromMillis(start, { zone }).toISO({ suppressMilliseconds: true })!, staffIds: ids }));
  return { ...empty, slots };
}

const querySchema = z.object({
  serviceId: z.coerce.number().int().positive(),
  date: z.iso.date('Tarih YYYY-AA-GG biçiminde olmalı.'),
  staffId: z.coerce.number().int().positive().optional(),
});

export function registerAvailability(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/businesses/:id/availability', async (request) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), request.params);
    const query = parse(querySchema, request.query);
    if (!DateTime.fromISO(query.date).isValid) throw badRequest('Geçersiz tarih.');
    return computeAvailability(ctx.db, ctx.now(), { businessId: id, ...query });
  });
}
