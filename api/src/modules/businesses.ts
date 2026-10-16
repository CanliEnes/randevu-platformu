import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { IANAZone } from 'luxon';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { canActOnStaff, requireMember, requireOwner } from '../lib/access.ts';
import { badRequest, conflict, forbidden, isPgError, notFound, parse, PG } from '../lib/errors.ts';
import { requireUser } from './auth.ts';

const id = z.coerce.number().int().positive();
const idParams = z.object({ id });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Saat SS:DD biçiminde olmalı.');
const timezone = z.string().refine((tz) => IANAZone.isValidZone(tz), 'Geçersiz saat dilimi.');

const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Adres yalnızca küçük harf, rakam ve tire içerebilir.').max(60),
  category: z.string().trim().min(2).max(40),
  description: z.string().trim().max(1000).default(''),
  address: z.string().trim().max(200).default(''),
  timezone: timezone.default('Europe/Istanbul'),
  ownerIsStaff: z.boolean().default(true),
});
const updateBusinessSchema = createBusinessSchema.omit({ slug: true, ownerIsStaff: true }).partial();

const serviceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(''),
  durationMinutes: z.number().int().min(5).max(480).multipleOf(5, 'Süre 5 dakikanın katı olmalı.'),
  priceCents: z.number().int().min(0).max(10_000_000),
  staffIds: z.array(id).max(100).optional(),
});
const updateServiceSchema = serviceSchema.omit({ staffIds: true }).partial().extend({ active: z.boolean().optional() });

const staffSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  title: z.string().trim().max(60).default(''),
  email: z.email().transform((v) => v.toLowerCase()).optional(),
  serviceIds: z.array(id).max(100).default([]),
});
const updateStaffSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  title: z.string().trim().max(60).optional(),
  active: z.boolean().optional(),
  serviceIds: z.array(id).max(100).optional(),
});

const workingHoursSchema = z.object({
  blocks: z
    .array(
      z
        .object({ weekday: z.number().int().min(1).max(7), start: time, end: time })
        .refine((b) => b.start < b.end, 'Başlangıç saati bitişten önce olmalı.'),
    )
    .max(50),
});

const timeOffSchema = z
  .object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(200).default(''),
  })
  .refine((t) => new Date(t.start) < new Date(t.end), 'Başlangıç bitişten önce olmalı.');

/** Escapes % and _ so user input is matched literally inside ILIKE. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

async function ensureSameBusiness(db: Db, table: 'services' | 'staff', ids: number[], businessId: number) {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const rows = await db.selectFrom(table).select('id').where('id', 'in', unique).where('business_id', '=', businessId).execute();
  if (rows.length !== unique.length) throw badRequest('Seçilen kayıtlardan bazıları bu işletmeye ait değil.');
}

async function loadStaff(db: Db, staffId: number) {
  const staff = await db.selectFrom('staff').select(['id', 'business_id']).where('id', '=', staffId).executeTakeFirst();
  if (!staff) throw notFound('Çalışan');
  return staff;
}

export function registerBusinesses(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  // ---------- Public ----------

  app.get('/api/businesses', async (request) => {
    const { q } = parse(z.object({ q: z.string().trim().max(60).optional() }), request.query);
    const rows = await sql<{
      id: number; name: string; slug: string; category: string; description: string; address: string;
      rating: number | null; reviewCount: number; minPriceCents: number | null;
    }>`
      SELECT b.id, b.name, b.slug, b.category, b.description, b.address,
             round(avg(r.rating), 1)  AS rating,
             count(r.id)              AS "reviewCount",
             (SELECT min(s.price_cents) FROM services s WHERE s.business_id = b.id AND s.active AND s.price_cents > 0) AS "minPriceCents"
      FROM businesses b
      LEFT JOIN reviews r ON r.business_id = b.id
      WHERE ${q ? sql`(b.name ILIKE ${likePattern(q)} OR b.category ILIKE ${likePattern(q)})` : sql`TRUE`}
      GROUP BY b.id
      ORDER BY count(r.id) DESC, b.name
      LIMIT 50`.execute(db);
    return { businesses: rows.rows };
  });

  app.get('/api/businesses/by-slug/:slug', async (request) => {
    const { slug } = parse(z.object({ slug: z.string().max(60) }), request.params);
    const business = await db
      .selectFrom('businesses')
      .select(['id', 'name', 'slug', 'category', 'description', 'address', 'timezone'])
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (!business) throw notFound('İşletme');

    const [services, staff, links, rating, reviews] = await Promise.all([
      db.selectFrom('services')
        .select(['id', 'name', 'description', 'duration_minutes as durationMinutes', 'price_cents as priceCents'])
        .where('business_id', '=', business.id).where('active', '=', true).orderBy('name').execute(),
      db.selectFrom('staff')
        .select(['id', 'display_name as displayName', 'title'])
        .where('business_id', '=', business.id).where('active', '=', true).orderBy('display_name').execute(),
      db.selectFrom('staff_services').innerJoin('staff', 'staff.id', 'staff_services.staff_id')
        .select(['staff_services.staff_id as staffId', 'staff_services.service_id as serviceId'])
        .where('staff.business_id', '=', business.id).execute(),
      db.selectFrom('reviews')
        .select((eb) => [sql<number | null>`round(avg(rating), 1)`.as('average'), eb.fn.countAll<number>().as('count')])
        .where('business_id', '=', business.id).executeTakeFirstOrThrow(),
      // Only first name + initial of the reviewer is public.
      sql<{ id: number; rating: number; comment: string; createdAt: Date; author: string; serviceName: string }>`
        SELECT r.id, r.rating, r.comment, r.created_at AS "createdAt",
               split_part(u.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(u.full_name, ' ', 2), ''), 1) || '.', '') AS author,
               s.name AS "serviceName"
        FROM reviews r
        JOIN users u ON u.id = r.customer_id
        JOIN appointments a ON a.id = r.appointment_id
        JOIN services s ON s.id = a.service_id
        WHERE r.business_id = ${business.id}
        ORDER BY r.created_at DESC
        LIMIT 20`.execute(db),
    ]);

    return {
      business,
      services: services.map((s) => ({ ...s, staffIds: links.filter((l) => l.serviceId === s.id).map((l) => l.staffId) })),
      staff: staff.map((s) => ({ ...s, serviceIds: links.filter((l) => l.staffId === s.id).map((l) => l.serviceId) })),
      rating,
      reviews: reviews.rows,
    };
  });

  // ---------- Owner / staff management ----------

  app.post('/api/businesses', async (request, reply) => {
    const user = requireUser(request);
    const body = parse(createBusinessSchema, request.body);
    try {
      const business = await db.transaction().execute(async (trx) => {
        const created = await trx
          .insertInto('businesses')
          .values({
            owner_id: user.id, name: body.name, slug: body.slug, category: body.category,
            description: body.description, address: body.address, timezone: body.timezone,
          })
          .returning(['id', 'name', 'slug'])
          .executeTakeFirstOrThrow();
        if (body.ownerIsStaff) {
          await trx.insertInto('staff').values({ business_id: created.id, user_id: user.id, display_name: user.fullName }).execute();
        }
        return created;
      });
      return reply.status(201).send({ business });
    } catch (error) {
      if (isPgError(error, PG.UNIQUE_VIOLATION)) throw conflict('SLUG_TAKEN', 'Bu adres başka bir işletme tarafından kullanılıyor.');
      throw error;
    }
  });

  app.patch('/api/businesses/:id', async (request) => {
    const user = requireUser(request);
    const { id: businessId } = parse(idParams, request.params);
    await requireOwner(db, user.id, businessId);
    const body = parse(updateBusinessSchema, request.body);
    const business = await db
      .updateTable('businesses')
      .set(body)
      .where('id', '=', businessId)
      .returning(['id', 'name', 'slug', 'category', 'description', 'address', 'timezone'])
      .executeTakeFirstOrThrow();
    return { business };
  });

  /** Everything the management panel needs in one request. */
  app.get('/api/businesses/:id/manage', async (request) => {
    const user = requireUser(request);
    const { id: businessId } = parse(idParams, request.params);
    const access = await requireMember(db, user.id, businessId);

    const [business, services, staff, links, hours, timeOff] = await Promise.all([
      db.selectFrom('businesses')
        .select(['id', 'name', 'slug', 'category', 'description', 'address', 'timezone'])
        .where('id', '=', businessId).executeTakeFirstOrThrow(),
      db.selectFrom('services')
        .select(['id', 'name', 'description', 'duration_minutes as durationMinutes', 'price_cents as priceCents', 'active'])
        .where('business_id', '=', businessId).orderBy('active', 'desc').orderBy('name').execute(),
      db.selectFrom('staff')
        .leftJoin('users', 'users.id', 'staff.user_id')
        .select(['staff.id', 'staff.display_name as displayName', 'staff.title', 'staff.active', 'users.email'])
        .where('staff.business_id', '=', businessId).orderBy('staff.active', 'desc').orderBy('staff.display_name').execute(),
      db.selectFrom('staff_services').innerJoin('staff', 'staff.id', 'staff_services.staff_id')
        .select(['staff_services.staff_id as staffId', 'staff_services.service_id as serviceId'])
        .where('staff.business_id', '=', businessId).execute(),
      db.selectFrom('working_hours').innerJoin('staff', 'staff.id', 'working_hours.staff_id')
        .select([
          'working_hours.staff_id as staffId', 'working_hours.weekday',
          sql<string>`to_char(working_hours.start_time, 'HH24:MI')`.as('start'),
          sql<string>`to_char(working_hours.end_time, 'HH24:MI')`.as('end'),
        ])
        .where('staff.business_id', '=', businessId)
        .orderBy('working_hours.weekday').orderBy('working_hours.start_time').execute(),
      db.selectFrom('time_off').innerJoin('staff', 'staff.id', 'time_off.staff_id')
        .select([
          'time_off.id', 'time_off.staff_id as staffId', 'time_off.reason',
          sql<Date>`lower(time_off.period)`.as('start'), sql<Date>`upper(time_off.period)`.as('end'),
        ])
        .where('staff.business_id', '=', businessId)
        .where(sql<boolean>`upper(time_off.period) > ${ctx.now()}`)
        .$if(access.role === 'staff', (qb) => qb.where('time_off.staff_id', '=', access.ownStaffId!))
        .orderBy(sql`lower(time_off.period)`).execute(),
    ]);

    return {
      role: access.role,
      ownStaffId: access.ownStaffId,
      business,
      services: services.map((s) => ({ ...s, staffIds: links.filter((l) => l.serviceId === s.id).map((l) => l.staffId) })),
      staff: staff.map((s) => ({
        ...s,
        // Staff members do not see each other's e-mail addresses.
        email: access.role === 'owner' ? s.email : null,
        serviceIds: links.filter((l) => l.staffId === s.id).map((l) => l.serviceId),
        workingHours: hours.filter((h) => h.staffId === s.id).map(({ weekday, start, end }) => ({ weekday, start, end })),
      })),
      timeOff,
    };
  });

  app.post('/api/businesses/:id/services', async (request, reply) => {
    const user = requireUser(request);
    const { id: businessId } = parse(idParams, request.params);
    await requireOwner(db, user.id, businessId);
    const body = parse(serviceSchema, request.body);
    await ensureSameBusiness(db, 'staff', body.staffIds ?? [], businessId);
    const service = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('services')
        .values({
          business_id: businessId, name: body.name, description: body.description,
          duration_minutes: body.durationMinutes, price_cents: body.priceCents,
        })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();
      const staffIds = [...new Set(body.staffIds ?? [])];
      if (staffIds.length) {
        await trx.insertInto('staff_services').values(staffIds.map((staffId) => ({ staff_id: staffId, service_id: created.id }))).execute();
      }
      return created;
    });
    return reply.status(201).send({ service });
  });

  app.patch('/api/services/:id', async (request) => {
    const user = requireUser(request);
    const { id: serviceId } = parse(idParams, request.params);
    const existing = await db.selectFrom('services').select(['id', 'business_id']).where('id', '=', serviceId).executeTakeFirst();
    if (!existing) throw notFound('Hizmet');
    await requireOwner(db, user.id, existing.business_id);
    const body = parse(updateServiceSchema, request.body);
    const service = await db
      .updateTable('services')
      .set({
        name: body.name, description: body.description, duration_minutes: body.durationMinutes,
        price_cents: body.priceCents, active: body.active,
      })
      .where('id', '=', serviceId)
      .returning(['id', 'name', 'active'])
      .executeTakeFirstOrThrow();
    return { service };
  });

  app.post('/api/businesses/:id/staff', async (request, reply) => {
    const user = requireUser(request);
    const { id: businessId } = parse(idParams, request.params);
    await requireOwner(db, user.id, businessId);
    const body = parse(staffSchema, request.body);
    await ensureSameBusiness(db, 'services', body.serviceIds, businessId);

    let userId: number | null = null;
    if (body.email) {
      const account = await db.selectFrom('users').select('id').where('email', '=', body.email).executeTakeFirst();
      if (!account) throw badRequest('Bu e-postayla kayıtlı bir kullanıcı yok. Çalışan önce kayıt olmalı.');
      userId = account.id;
    }
    try {
      const staff = await db.transaction().execute(async (trx) => {
        const created = await trx
          .insertInto('staff')
          .values({ business_id: businessId, user_id: userId, display_name: body.displayName, title: body.title })
          .returning(['id', 'display_name as displayName'])
          .executeTakeFirstOrThrow();
        const serviceIds = [...new Set(body.serviceIds)];
        if (serviceIds.length) {
          await trx.insertInto('staff_services').values(serviceIds.map((serviceId) => ({ staff_id: created.id, service_id: serviceId }))).execute();
        }
        return created;
      });
      return reply.status(201).send({ staff });
    } catch (error) {
      if (isPgError(error, PG.UNIQUE_VIOLATION)) throw conflict('ALREADY_STAFF', 'Bu kullanıcı zaten bu işletmede çalışan olarak kayıtlı.');
      throw error;
    }
  });

  app.patch('/api/staff/:id', async (request) => {
    const user = requireUser(request);
    const { id: staffId } = parse(idParams, request.params);
    const staff = await loadStaff(db, staffId);
    await requireOwner(db, user.id, staff.business_id);
    const body = parse(updateStaffSchema, request.body);
    if (body.serviceIds) await ensureSameBusiness(db, 'services', body.serviceIds, staff.business_id);

    await db.transaction().execute(async (trx) => {
      const { serviceIds, displayName, title, active } = body;
      if (displayName !== undefined || title !== undefined || active !== undefined) {
        await trx.updateTable('staff').set({ display_name: displayName, title, active }).where('id', '=', staffId).execute();
      }
      if (serviceIds) {
        await trx.deleteFrom('staff_services').where('staff_id', '=', staffId).execute();
        const unique = [...new Set(serviceIds)];
        if (unique.length) {
          await trx.insertInto('staff_services').values(unique.map((serviceId) => ({ staff_id: staffId, service_id: serviceId }))).execute();
        }
      }
    });
    return { ok: true };
  });

  // Replaces the whole weekly schedule of a staff member in one transaction.
  app.put('/api/staff/:id/working-hours', async (request) => {
    const user = requireUser(request);
    const { id: staffId } = parse(idParams, request.params);
    const staff = await loadStaff(db, staffId);
    await requireOwner(db, user.id, staff.business_id);
    const { blocks } = parse(workingHoursSchema, request.body);
    try {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('working_hours').where('staff_id', '=', staffId).execute();
        if (blocks.length) {
          await trx
            .insertInto('working_hours')
            .values(blocks.map((b) => ({ staff_id: staffId, weekday: b.weekday, start_time: b.start, end_time: b.end })))
            .execute();
        }
      });
    } catch (error) {
      if (isPgError(error, PG.EXCLUSION_VIOLATION)) throw badRequest('Aynı gün içindeki çalışma saatleri çakışıyor.');
      throw error;
    }
    return { ok: true };
  });

  app.post('/api/staff/:id/time-off', async (request, reply) => {
    const user = requireUser(request);
    const { id: staffId } = parse(idParams, request.params);
    const staff = await loadStaff(db, staffId);
    const access = await requireMember(db, user.id, staff.business_id);
    if (!canActOnStaff(access, staffId)) throw forbidden();
    const body = parse(timeOffSchema, request.body);
    const timeOff = await db
      .insertInto('time_off')
      .values({ staff_id: staffId, period: sql`tstzrange(${body.start}::timestamptz, ${body.end}::timestamptz, '[)')`, reason: body.reason })
      .returning('id')
      .executeTakeFirstOrThrow();
    return reply.status(201).send({ timeOff });
  });

  app.delete('/api/time-off/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id: timeOffId } = parse(idParams, request.params);
    const row = await db
      .selectFrom('time_off').innerJoin('staff', 'staff.id', 'time_off.staff_id')
      .select(['time_off.id', 'time_off.staff_id', 'staff.business_id'])
      .where('time_off.id', '=', timeOffId)
      .executeTakeFirst();
    if (!row) throw notFound('İzin');
    const access = await requireMember(db, user.id, row.business_id);
    if (!canActOnStaff(access, row.staff_id)) throw forbidden();
    await db.deleteFrom('time_off').where('id', '=', timeOffId).execute();
    return reply.status(204).send();
  });
}
