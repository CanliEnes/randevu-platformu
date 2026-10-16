import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, istanbul, setupBusiness, type TestClient, type TestEnv } from './helpers.ts';

let env: TestEnv;
let shop: Awaited<ReturnType<typeof setupBusiness>>;
let customer: TestClient;
beforeAll(async () => (env = await createTestEnv()));
beforeEach(async () => {
  await env.reset();
  shop = await setupBusiness(env);
  customer = env.client();
  await customer.register('customer@test.dev', 'Zeynep Ak');
});
afterAll(async () => env.close());

const book = async (start: string, serviceId = shop.haircut.id) =>
  (await customer.post('/api/appointments', { serviceId, start })).body.appointment;

describe('reviews', () => {
  it('can only be written after the appointment happened, once, by its customer', async () => {
    const appointment = await book(istanbul('2030-01-08', '10:00'));
    const review = { rating: 5, comment: 'Harika!' };

    expect((await customer.post(`/api/appointments/${appointment.id}/review`, review)).status).toBe(422);

    env.clock.now = new Date(istanbul('2030-01-08', '11:00'));
    const stranger = env.client();
    await stranger.register('stranger@test.dev');
    expect((await stranger.post(`/api/appointments/${appointment.id}/review`, review)).status).toBe(404);
    expect((await customer.post(`/api/appointments/${appointment.id}/review`, { rating: 6 })).status).toBe(400);
    expect((await customer.post(`/api/appointments/${appointment.id}/review`, review)).status).toBe(201);
    expect((await customer.post(`/api/appointments/${appointment.id}/review`, review)).status).toBe(409);

    const page = await env.client().get('/api/businesses/by-slug/test-salon');
    expect(page.body.rating).toEqual({ average: 5, count: 1 });
    expect(page.body.reviews[0]).toMatchObject({ rating: 5, comment: 'Harika!', author: 'Zeynep A.', serviceName: 'Saç kesimi' });
  });

  it('cannot review a cancelled or no-show appointment', async () => {
    const cancelled = await book(istanbul('2030-01-08', '10:00'));
    await customer.post(`/api/appointments/${cancelled.id}/cancel`);
    env.clock.now = new Date(istanbul('2030-01-09', '12:00'));
    expect((await customer.post(`/api/appointments/${cancelled.id}/review`, { rating: 1 })).status).toBe(422);
  });
});

describe('statistics', () => {
  it('summarises the last days in the business time zone', async () => {
    // Monday 7th: two haircuts and a coloring; one haircut is cancelled.
    env.clock.now = new Date(istanbul('2030-01-07', '06:00'));
    const a = await book(istanbul('2030-01-07', '09:00'));
    const b = await book(istanbul('2030-01-07', '13:00'));
    await book(istanbul('2030-01-07', '15:00'), shop.coloring.id);
    await customer.post(`/api/appointments/${b.id}/cancel`);
    // Tuesday 8th, 10:00: a haircut that ends up as a no-show.
    const c = await book(istanbul('2030-01-08', '10:00'));
    // Wednesday 9th: in the future when the report is made.
    await book(istanbul('2030-01-09', '10:00'));

    env.clock.now = new Date(istanbul('2030-01-08', '12:00'));
    await shop.owner.post(`/api/appointments/${c.id}/no-show`);
    env.clock.now = new Date(istanbul('2030-01-08', '20:00'));
    await customer.post(`/api/appointments/${a.id}/review`, { rating: 4 });

    const res = await shop.owner.get(`/api/businesses/${shop.business.id}/stats?days=7`);
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s.summary).toMatchObject({
      total: 4, completed: 2, cancelled: 1, noShow: 1, upcoming: 1,
      revenueCents: 50_000 + 150_000, cancellationRate: 25, averageRating: 4, reviewCount: 1,
    });
    expect(s.daily).toHaveLength(8); // 1st..8th, every day present even when empty
    expect(s.daily.find((d: { date: string }) => d.date === '2030-01-07')).toEqual({ date: '2030-01-07', count: 2, revenueCents: 200_000 });
    expect(s.byHour).toEqual([{ hour: 9, count: 1 }, { hour: 10, count: 1 }, { hour: 15, count: 1 }]);
    expect(s.byWeekday).toEqual([{ weekday: 1, count: 2 }, { weekday: 2, count: 1 }]);
    expect(s.topServices[0]).toEqual({ name: 'Saç kesimi', count: 2, revenueCents: 50_000 });
  });
});
