import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { canActOnStaff, getAccess, requireMember } from '../lib/access.ts';
import { AppError, conflict, isPgError, notFound, parse, PG } from '../lib/errors.ts';
import { publishAppointmentEvent } from '../lib/events.ts';
import { JOBS } from '../lib/queue.ts';
import { MINUTE } from '../lib/slots.ts';
import { requireUser } from './auth.ts';
import { computeAvailability } from './availability.ts';

/** Customers may cancel on their own until this many hours before the start. */
export const CANCEL_CUTOFF_HOURS = 2;
const REMINDER_HOURS_BEFORE = 24;

const idParams = z.object({ id: z.coerce.number().int().positive() });

const bookSchema = z.object({
  serviceId: z.number().int().positive(),
  staffId: z.number().int().positive().optional(), // omitted = "any available staff"
  start: z.iso.datetime({ offset: true, message: 'Başlangıç zamanı ISO 8601 biçiminde olmalı.' }),
  note: z.string().trim().max(500).default(''),
});

const rangeSchema = z
  .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
  .refine((r) => new Date(r.from) < new Date(r.to), 'from, to değerinden önce olmalı.')
  .refine((r) => new Date(r.to).getTime() - new Date(r.from).getTime() <= 62 * 86_400_000, 'En fazla 62 günlük aralık istenebilir.');

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).default(''),
});

/** One appointment with all the names a screen or an e-mail needs. */
export function appointmentDetails(db: Db) {
  return db
    .selectFrom('appointments as a')
    .innerJoin('businesses as b', 'b.id', 'a.business_id')
    .innerJoin('staff as st', 'st.id', 'a.staff_id')
    .innerJoin('services as sv', 'sv.id', 'a.service_id')
    .innerJoin('users as c', 'c.id', 'a.customer_id')
    .leftJoin('reviews as r', 'r.appointment_id', 'a.id')
    .select([
      'a.id', 'a.status', 'a.price_cents as priceCents', 'a.note',
      sql<Date>`lower(a.period)`.as('start'),
      sql<Date>`upper(a.period)`.as('end'),
      'b.id as businessId', 'b.name as businessName', 'b.slug as businessSlug', 'b.timezone', 'b.owner_id as ownerId',
      'st.id as staffId', 'st.display_name as staffName',
      'sv.id as serviceId', 'sv.name as serviceName',
      'c.id as customerId', 'c.full_name as customerName', 'c.email as customerEmail',
      'r.rating as reviewRating',
    ]);
}

export type AppointmentDetail = Awaited<ReturnType<ReturnType<typeof appointmentDetails>['executeTakeFirstOrThrow']>>;

export function registerAppointments(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  // ---------- Booking ----------
  app.post('/api/appointments', async (request, reply) => {
    const user = requireUser(request);
    const body = parse(bookSchema, request.body);
    const now = ctx.now();

    const service = await db
      .selectFrom('services')
      .innerJoin('businesses', 'businesses.id', 'services.business_id')
      .select(['services.id', 'services.business_id', 'services.duration_minutes', 'services.price_cents', 'businesses.timezone'])
      .where('services.id', '=', body.serviceId)
      .where('services.active', '=', true)
      .executeTakeFirst();
    if (!service) throw notFound('Hizmet');

    // Step 1: is the requested start one of the free slots right now?
    const startMs = Date.parse(body.start);
    const date = DateTime.fromMillis(startMs, { zone: service.timezone }).toISODate()!;
    const availability = await computeAvailability(db, now, {
      businessId: service.business_id, serviceId: service.id, date, staffId: body.staffId,
    });
    const slot = availability.slots.find((s) => Date.parse(s.start) === startMs);
    if (!slot) throw conflict('SLOT_UNAVAILABLE', 'Seçilen saat artık müsait değil. Lütfen başka bir saat seçin.');

    // Step 2: insert. If another request booked the same time a moment ago,
    // the exclusion constraint rejects this insert; try the next free staff member.
    const start = new Date(startMs);
    const end = new Date(startMs + service.duration_minutes * MINUTE);
    let appointmentId: number | null = null;
    for (const staffId of slot.staffIds) {
      try {
        appointmentId = await db.transaction().execute(async (trx) => {
          const created = await trx
            .insertInto('appointments')
            .values({
              business_id: service.business_id, staff_id: staffId, service_id: service.id, customer_id: user.id,
              period: sql`tstzrange(${start}::timestamptz, ${end}::timestamptz, '[)')`,
              price_cents: service.price_cents, note: body.note,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await publishAppointmentEvent(trx, { type: 'created', businessId: service.business_id, staffId, appointmentId: created.id });
          return created.id;
        });
        break;
      } catch (error) {
        if (!isPgError(error, PG.EXCLUSION_VIOLATION)) throw error;
        if (error.constraint === 'appointments_customer_no_overlap') {
          throw conflict('CUSTOMER_BUSY', 'Bu saatte başka bir randevunuz var.');
        }
        // appointments_staff_no_overlap: someone was faster; try the next staff member.
      }
    }
    if (appointmentId === null) throw conflict('SLOT_TAKEN', 'Bu saat az önce başka biri tarafından alındı.');

    // Step 3: background work. The response does not wait for any e-mail.
    await ctx.queue.send(JOBS.confirmation, { appointmentId });
    const remindAt = new Date(startMs - REMINDER_HOURS_BEFORE * 60 * MINUTE);
    if (remindAt > now) await ctx.queue.send(JOBS.reminder, { appointmentId }, { startAfter: remindAt });

    const appointment = await appointmentDetails(db).where('a.id', '=', appointmentId).executeTakeFirstOrThrow();
    return reply.status(201).send({ appointment: present(appointment, now) });
  });

  // ---------- Lists ----------
  app.get('/api/me/appointments', async (request) => {
    const user = requireUser(request);
    const now = ctx.now();
    const rows = await appointmentDetails(db)
      .where('a.customer_id', '=', user.id)
      .orderBy(sql`lower(a.period)`, 'desc')
      .limit(200)
      .execute();
    return { appointments: rows.map((row) => present(row, now)) };
  });

  app.get('/api/businesses/:id/appointments', async (request) => {
    const user = requireUser(request);
    const { id: businessId } = parse(idParams, request.params);
    const access = await requireMember(db, user.id, businessId);
    const range = parse(rangeSchema, request.query);
    const now = ctx.now();
    const rows = await appointmentDetails(db)
      .where('a.business_id', '=', businessId)
      .where(sql<boolean>`a.period && tstzrange(${range.from}::timestamptz, ${range.to}::timestamptz, '[)')`)
      .$if(access.role === 'staff', (qb) => qb.where('a.staff_id', '=', access.ownStaffId!))
      .orderBy(sql`lower(a.period)`)
      .execute();
    return { appointments: rows.map((row) => ({ ...present(row, now), customerEmail: row.customerEmail })) };
  });

  // ---------- Changing an appointment ----------
  async function loadForChange(id: number) {
    const row = await appointmentDetails(db).where('a.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Randevu');
    return row;
  }

  app.post('/api/appointments/:id/cancel', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParams, request.params);
    const appointment = await loadForChange(id);
    const now = ctx.now();

    const isCustomer = appointment.customerId === user.id;
    const access = await getAccess(db, user.id, appointment.businessId);
    const isManager = access !== null && canActOnStaff(access, appointment.staffId);
    if (!isCustomer && !isManager) throw notFound('Randevu'); // do not reveal other people's appointments

    if (appointment.status !== 'booked') throw conflict('NOT_CANCELLABLE', 'Bu randevu zaten iptal edilmiş veya tamamlanmış.');
    if (appointment.start <= now) throw conflict('NOT_CANCELLABLE', 'Başlamış bir randevu iptal edilemez.');
    if (!isManager && appointment.start.getTime() - now.getTime() < CANCEL_CUTOFF_HOURS * 60 * MINUTE) {
      throw conflict('TOO_LATE_TO_CANCEL', `Randevuya ${CANCEL_CUTOFF_HOURS} saatten az kaldığı için iptal edilemez. Lütfen işletmeyi arayın.`);
    }

    const changed = await db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('appointments')
        .set({ status: 'cancelled', cancelled_at: now, cancelled_by: user.id })
        .where('id', '=', id)
        .where('status', '=', 'booked') // guards against two cancellations racing
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n) return false;
      await publishAppointmentEvent(trx, { type: 'cancelled', businessId: appointment.businessId, staffId: appointment.staffId, appointmentId: id });
      return true;
    });
    if (!changed) throw conflict('NOT_CANCELLABLE', 'Bu randevu zaten iptal edilmiş.');

    await ctx.queue.send(JOBS.cancellation, { appointmentId: id });
    return { appointment: present(await loadForChange(id), now) };
  });

  app.post('/api/appointments/:id/no-show', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParams, request.params);
    const appointment = await loadForChange(id);
    const access = await getAccess(db, user.id, appointment.businessId);
    if (!access || !canActOnStaff(access, appointment.staffId)) throw notFound('Randevu');
    const now = ctx.now();
    if (appointment.status !== 'booked' || appointment.start > now) {
      throw conflict('NOT_ALLOWED', 'Yalnızca başlamış ve iptal edilmemiş randevular "gelmedi" olarak işaretlenebilir.');
    }
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('appointments').set({ status: 'no_show' }).where('id', '=', id).execute();
      await publishAppointmentEvent(trx, { type: 'updated', businessId: appointment.businessId, staffId: appointment.staffId, appointmentId: id });
    });
    return { appointment: present(await loadForChange(id), now) };
  });

  // ---------- Reviews ----------
  app.post('/api/appointments/:id/review', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParams, request.params);
    const body = parse(reviewSchema, request.body);
    const appointment = await loadForChange(id);
    if (appointment.customerId !== user.id) throw notFound('Randevu');
    // Only people who actually had the appointment can review it.
    if (appointment.status !== 'booked' || appointment.end > ctx.now()) {
      throw new AppError(422, 'NOT_REVIEWABLE', 'Yalnızca gerçekleşmiş randevular değerlendirilebilir.');
    }
    try {
      const review = await db
        .insertInto('reviews')
        .values({ appointment_id: id, business_id: appointment.businessId, customer_id: user.id, rating: body.rating, comment: body.comment })
        .returning(['id', 'rating', 'comment'])
        .executeTakeFirstOrThrow();
      return reply.status(201).send({ review });
    } catch (error) {
      if (isPgError(error, PG.UNIQUE_VIOLATION)) throw conflict('ALREADY_REVIEWED', 'Bu randevuyu zaten değerlendirdiniz.');
      throw error;
    }
  });
}

/** Shapes a row for the client and adds what the customer is allowed to do next. */
function present(row: AppointmentDetail, now: Date) {
  const { ownerId: _owner, customerEmail: _email, reviewRating, ...rest } = row;
  const started = row.start <= now;
  const finished = row.end <= now;
  return {
    ...rest,
    // "completed" is not stored: a booked appointment whose end has passed is completed.
    displayStatus: row.status === 'booked' ? (finished ? 'completed' : started ? 'in_progress' : 'upcoming') : row.status,
    reviewRating,
    canCancel: row.status === 'booked' && row.start.getTime() - now.getTime() >= CANCEL_CUTOFF_HOURS * 60 * MINUTE,
    canReview: row.status === 'booked' && finished && reviewRating === null,
  };
}

