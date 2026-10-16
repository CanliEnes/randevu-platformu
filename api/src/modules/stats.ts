import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { requireOwner } from '../lib/access.ts';
import { parse } from '../lib/errors.ts';
import { requireUser } from './auth.ts';

// Reporting queries. Every number is computed in SQL; times are grouped in the
// business' own time zone so "busiest hour" means local hours, not UTC.

export function registerStats(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/businesses/:id/stats', async (request) => {
    const user = requireUser(request);
    const { id: businessId } = parse(z.object({ id: z.coerce.number().int().positive() }), request.params);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }), request.query);
    const access = await requireOwner(db, user.id, businessId);
    const tz = access.timezone;
    const now = ctx.now();
    const from = new Date(now.getTime() - days * 86_400_000);

    // The appointments that started inside the window.
    const windowed = sql`
      SELECT a.*, lower(a.period) AS starts_at, upper(a.period) AS ends_at,
             (a.status = 'booked' AND upper(a.period) <= ${now}) AS completed
      FROM appointments a
      WHERE a.business_id = ${businessId}
        AND lower(a.period) >= ${from} AND lower(a.period) < ${now}`;

    const [summary, upcoming, daily, byHour, byWeekday, services, staff, rating] = await Promise.all([
      sql<{ total: number; completed: number; cancelled: number; noShow: number; revenueCents: number }>`
        SELECT count(*)                                         AS total,
               count(*) FILTER (WHERE completed)                AS completed,
               count(*) FILTER (WHERE status = 'cancelled')     AS cancelled,
               count(*) FILTER (WHERE status = 'no_show')       AS "noShow",
               coalesce(sum(price_cents) FILTER (WHERE completed), 0) AS "revenueCents"
        FROM (${windowed}) w`.execute(db),

      sql<{ upcoming: number }>`
        SELECT count(*) AS upcoming FROM appointments
        WHERE business_id = ${businessId} AND status = 'booked' AND lower(period) >= ${now}`.execute(db),

      // generate_series produces every day, so days without appointments show up as 0.
      sql<{ date: string; count: number; revenueCents: number }>`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
               count(w.id) FILTER (WHERE w.status <> 'cancelled') AS count,
               coalesce(sum(w.price_cents) FILTER (WHERE w.completed), 0) AS "revenueCents"
        FROM generate_series(
               (${from}::timestamptz AT TIME ZONE ${tz})::date,
               (${now}::timestamptz AT TIME ZONE ${tz})::date,
               interval '1 day') AS d(day)
        LEFT JOIN (${windowed}) w ON (w.starts_at AT TIME ZONE ${tz})::date = d.day::date
        GROUP BY d.day ORDER BY d.day`.execute(db),

      sql<{ hour: number; count: number }>`
        SELECT extract(hour FROM starts_at AT TIME ZONE ${tz})::int AS hour, count(*) AS count
        FROM (${windowed}) w WHERE status <> 'cancelled'
        GROUP BY 1 ORDER BY 1`.execute(db),

      sql<{ weekday: number; count: number }>`
        SELECT extract(isodow FROM starts_at AT TIME ZONE ${tz})::int AS weekday, count(*) AS count
        FROM (${windowed}) w WHERE status <> 'cancelled'
        GROUP BY 1 ORDER BY 1`.execute(db),

      sql<{ name: string; count: number; revenueCents: number }>`
        SELECT s.name, count(*) AS count, coalesce(sum(w.price_cents) FILTER (WHERE w.completed), 0) AS "revenueCents"
        FROM (${windowed}) w JOIN services s ON s.id = w.service_id
        WHERE w.status <> 'cancelled'
        GROUP BY s.name ORDER BY count DESC, s.name LIMIT 10`.execute(db),

      sql<{ name: string; count: number; revenueCents: number; noShow: number }>`
        SELECT st.display_name AS name,
               count(*) FILTER (WHERE w.status <> 'cancelled') AS count,
               coalesce(sum(w.price_cents) FILTER (WHERE w.completed), 0) AS "revenueCents",
               count(*) FILTER (WHERE w.status = 'no_show') AS "noShow"
        FROM (${windowed}) w JOIN staff st ON st.id = w.staff_id
        GROUP BY st.display_name ORDER BY count DESC, st.display_name`.execute(db),

      sql<{ average: number | null; count: number }>`
        SELECT round(avg(rating), 2) AS average, count(*) AS count
        FROM reviews WHERE business_id = ${businessId}`.execute(db),
    ]);

    const s = summary.rows[0]!;
    return {
      days,
      summary: {
        ...s,
        upcoming: upcoming.rows[0]!.upcoming,
        cancellationRate: s.total ? Math.round((s.cancelled / s.total) * 1000) / 10 : 0,
        averageRating: rating.rows[0]!.average,
        reviewCount: rating.rows[0]!.count,
      },
      daily: daily.rows,
      byHour: byHour.rows,
      byWeekday: byWeekday.rows,
      topServices: services.rows,
      staff: staff.rows,
    };
  });
}
