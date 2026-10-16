import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JOBS } from '../src/lib/queue.ts';
import { createTestEnv, istanbul, setupBusiness, type TestEnv } from './helpers.ts';

let env: TestEnv;
let shop: Awaited<ReturnType<typeof setupBusiness>>;
beforeAll(async () => (env = await createTestEnv()));
beforeEach(async () => {
  await env.reset();
  shop = await setupBusiness(env);
});
afterAll(async () => env.close());

const TUESDAY = '2030-01-08';

async function availability(query: string) {
  const res = await env.client().get(`/api/businesses/${shop.business.id}/availability?${query}`);
  expect(res.status).toBe(200);
  return res.body.slots as { start: string; staffIds: number[] }[];
}
const times = (slots: { start: string }[]) => slots.map((s) => s.start.slice(11, 16));

async function customer(email = 'customer@test.dev') {
  const client = env.client();
  await client.register(email, 'Müşteri Kişi');
  return client;
}

describe('availability', () => {
  it('follows working hours, skips the lunch break and fits the service duration', async () => {
    const slots = await availability(`serviceId=${shop.haircut.id}&date=${TUESDAY}`);
    const list = times(slots);
    expect(list[0]).toBe('09:00');
    expect(list).toContain('11:30'); // 11:30-12:00 fits before lunch
    expect(list).not.toContain('11:45'); // would run into the lunch break
    expect(list).not.toContain('12:00');
    expect(list).toContain('13:00');
    expect(list.at(-1)).toBe('17:30');
    expect(slots[0]!.staffIds).toEqual([shop.ali.id, shop.banu.id]);
  });

  it('only lists staff who offer the service', async () => {
    const slots = await availability(`serviceId=${shop.coloring.id}&date=${TUESDAY}`);
    expect(slots.every((s) => s.staffIds.length === 1 && s.staffIds[0] === shop.ali.id)).toBe(true);
    expect(times(slots)).not.toContain('11:15'); // 60 minutes would cross 12:00
  });

  it('is empty on days off, in the past and too far ahead', async () => {
    expect(await availability(`serviceId=${shop.haircut.id}&date=2030-01-12`)).toEqual([]); // Saturday
    expect(await availability(`serviceId=${shop.haircut.id}&date=2030-01-06`)).toEqual([]); // yesterday
    expect(await availability(`serviceId=${shop.haircut.id}&date=2030-04-01`)).toEqual([]); // > 60 days
  });

  it('does not offer times sooner than 30 minutes from now', async () => {
    env.clock.now = new Date(istanbul('2030-01-07', '10:05'));
    const list = times(await availability(`serviceId=${shop.haircut.id}&date=2030-01-07`));
    expect(list[0]).toBe('10:45'); // 10:05 + 30 min = 10:35, next grid point 10:45
  });

  it('removes time off and existing appointments', async () => {
    await shop.owner.post(`/api/staff/${shop.ali.id}/time-off`, {
      start: istanbul(TUESDAY, '09:00'), end: istanbul(TUESDAY, '10:00'), reason: 'Doktor',
    });
    const client = await customer();
    await client.post('/api/appointments', { serviceId: shop.haircut.id, staffId: shop.banu.id, start: istanbul(TUESDAY, '09:00') });

    const slots = await availability(`serviceId=${shop.haircut.id}&date=${TUESDAY}`);
    const nine = slots.find((s) => s.start.slice(11, 16) === '09:00');
    expect(nine).toBeUndefined(); // Ali is off, Banu is booked
    const quarterPast = slots.find((s) => s.start.slice(11, 16) === '09:30');
    expect(quarterPast?.staffIds).toEqual([shop.banu.id]); // Ali is still off until 10:00
  });
});

describe('booking', () => {
  it('books a free slot, snapshots the price and schedules e-mails', async () => {
    const client = await customer();
    const res = await client.post('/api/appointments', { serviceId: shop.haircut.id, staffId: shop.ali.id, start: istanbul(TUESDAY, '10:00') });
    expect(res.status).toBe(201);
    expect(res.body.appointment).toMatchObject({ staffName: 'Ali', serviceName: 'Saç kesimi', priceCents: 50_000, displayStatus: 'upcoming' });
    expect(new Date(res.body.appointment.end).getTime() - new Date(res.body.appointment.start).getTime()).toBe(30 * 60_000);

    const id = res.body.appointment.id;
    expect(env.queue.jobs).toEqual([
      { name: JOBS.confirmation, data: { appointmentId: id }, startAfter: undefined },
      { name: JOBS.reminder, data: { appointmentId: id }, startAfter: new Date(istanbul('2030-01-07', '10:00')) }, // 24h before
    ]);
  });

  it('does not schedule a reminder when the appointment is less than 24 hours away', async () => {
    const client = await customer();
    await client.post('/api/appointments', { serviceId: shop.haircut.id, start: istanbul('2030-01-07', '15:00') });
    expect(env.queue.jobs.map((j) => j.name)).toEqual([JOBS.confirmation]);
  });

  it('requires login', async () => {
    const res = await env.client().post('/api/appointments', { serviceId: shop.haircut.id, start: istanbul(TUESDAY, '10:00') });
    expect(res.status).toBe(401);
  });

  it('rejects times outside the free slots', async () => {
    const client = await customer();
    for (const start of [istanbul(TUESDAY, '12:15'), istanbul(TUESDAY, '10:05'), istanbul('2030-01-07', '07:00')]) {
      const res = await client.post('/api/appointments', { serviceId: shop.haircut.id, start });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
    }
  });

  it('refuses a second booking for the same staff and time', async () => {
    const body = { serviceId: shop.haircut.id, staffId: shop.ali.id, start: istanbul(TUESDAY, '10:00') };
    expect((await (await customer('a@test.dev')).post('/api/appointments', body)).status).toBe(201);
    const second = await (await customer('b@test.dev')).post('/api/appointments', body);
    expect(second.status).toBe(409);
  });

  it('with "any staff", gives the next free person', async () => {
    const body = { serviceId: shop.haircut.id, start: istanbul(TUESDAY, '10:00') };
    const first = await (await customer('a@test.dev')).post('/api/appointments', body);
    const second = await (await customer('b@test.dev')).post('/api/appointments', body);
    const third = await (await customer('c@test.dev')).post('/api/appointments', body);
    expect(first.body.appointment.staffId).toBe(shop.ali.id);
    expect(second.body.appointment.staffId).toBe(shop.banu.id);
    expect(third.status).toBe(409);
  });

  it('does not let one customer be in two places at once', async () => {
    const client = await customer();
    await client.post('/api/appointments', { serviceId: shop.coloring.id, start: istanbul(TUESDAY, '10:00') }); // Ali 10-11
    const res = await client.post('/api/appointments', { serviceId: shop.haircut.id, staffId: shop.banu.id, start: istanbul(TUESDAY, '10:30') });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOMER_BUSY');
  });

  it('creates exactly one appointment when 10 customers click the same slot at the same moment', async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, (_, i) => customer(`racer${i}@test.dev`)));
    const body = { serviceId: shop.haircut.id, staffId: shop.ali.id, start: istanbul(TUESDAY, '14:00') };

    const results = await Promise.all(clients.map((c) => c.post('/api/appointments', body)));

    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    const count = await env.db.selectFrom('appointments').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(count.n).toBe(1);
  });

  it('the database itself rejects overlapping rows, even without the API checks', async () => {
    const c = await customer();
    const { id: customerId } = (await c.get('/api/auth/me')).body.user;
    const insert = (start: string, end: string) =>
      env.ctx.pool.query(
        `INSERT INTO appointments (business_id, staff_id, service_id, customer_id, period, price_cents)
         VALUES ($1, $2, $3, $4, tstzrange($5, $6, '[)'), 0)`,
        [shop.business.id, shop.ali.id, shop.haircut.id, customerId, start, end],
      );
    await insert(istanbul(TUESDAY, '10:00'), istanbul(TUESDAY, '10:30'));
    await expect(insert(istanbul(TUESDAY, '10:15'), istanbul(TUESDAY, '10:45'))).rejects.toMatchObject({ code: '23P01' });
    // Back-to-back is fine: ranges are half-open [start, end).
    const other = await customer('other@test.dev');
    const otherId = (await other.get('/api/auth/me')).body.user.id;
    await expect(
      env.ctx.pool.query(
        `INSERT INTO appointments (business_id, staff_id, service_id, customer_id, period, price_cents)
         VALUES ($1, $2, $3, $4, tstzrange($5, $6, '[)'), 0)`,
        [shop.business.id, shop.ali.id, shop.haircut.id, otherId, istanbul(TUESDAY, '10:30'), istanbul(TUESDAY, '11:00')],
      ),
    ).resolves.toBeDefined();
  });
});

describe('cancelling', () => {
  async function book(client: Awaited<ReturnType<typeof customer>>, start = istanbul(TUESDAY, '10:00')) {
    return (await client.post('/api/appointments', { serviceId: shop.haircut.id, staffId: shop.ali.id, start })).body.appointment;
  }

  it('frees the slot again', async () => {
    const client = await customer();
    const appointment = await book(client);
    const res = await client.post(`/api/appointments/${appointment.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('cancelled');
    expect(env.queue.jobs.at(-1)).toMatchObject({ name: JOBS.cancellation });

    const again = await (await customer('next@test.dev')).post('/api/appointments', {
      serviceId: shop.haircut.id, staffId: shop.ali.id, start: istanbul(TUESDAY, '10:00'),
    });
    expect(again.status).toBe(201);
  });

  it('customers cannot cancel within 2 hours, but the business can', async () => {
    const client = await customer();
    const appointment = await book(client);
    env.clock.now = new Date(istanbul(TUESDAY, '08:30'));
    const res = await client.post(`/api/appointments/${appointment.id}/cancel`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_LATE_TO_CANCEL');
    expect((await shop.owner.post(`/api/appointments/${appointment.id}/cancel`)).status).toBe(200);
  });

  it('cannot cancel twice or cancel someone else\'s appointment', async () => {
    const client = await customer();
    const appointment = await book(client);
    expect((await (await customer('stranger@test.dev')).post(`/api/appointments/${appointment.id}/cancel`)).status).toBe(404);
    expect((await client.post(`/api/appointments/${appointment.id}/cancel`)).status).toBe(200);
    expect((await client.post(`/api/appointments/${appointment.id}/cancel`)).status).toBe(409);
  });

  it('marks a no-show only after the start time', async () => {
    const client = await customer();
    const appointment = await book(client);
    expect((await shop.owner.post(`/api/appointments/${appointment.id}/no-show`)).status).toBe(409);
    env.clock.now = new Date(istanbul(TUESDAY, '10:20'));
    const res = await shop.aliClient.post(`/api/appointments/${appointment.id}/no-show`);
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('no_show');
  });
});

describe('my appointments', () => {
  it('lists my appointments with what I can do next', async () => {
    const client = await customer();
    await client.post('/api/appointments', { serviceId: shop.haircut.id, start: istanbul(TUESDAY, '10:00') });
    const res = await client.get('/api/me/appointments');
    expect(res.body.appointments).toHaveLength(1);
    expect(res.body.appointments[0]).toMatchObject({ canCancel: true, canReview: false, businessSlug: 'test-salon' });
    expect(res.body.appointments[0].customerEmail).toBeUndefined();
  });
});
