import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('roles and permissions', () => {
  it('a stranger cannot manage the business', async () => {
    const stranger = env.client();
    await stranger.register('stranger@test.dev');
    const id = shop.business.id;
    expect((await stranger.patch(`/api/businesses/${id}`, { name: 'Hacked' })).status).toBe(403);
    expect((await stranger.post(`/api/businesses/${id}/services`, { name: 'X', durationMinutes: 30, priceCents: 1 })).status).toBe(403);
    expect((await stranger.get(`/api/businesses/${id}/manage`)).status).toBe(403);
    expect((await stranger.get(`/api/businesses/${id}/stats`)).status).toBe(403);
  });

  it('staff can see the panel but not change services, hours or stats', async () => {
    const id = shop.business.id;
    const panel = await shop.aliClient.get(`/api/businesses/${id}/manage`);
    expect(panel.status).toBe(200);
    expect(panel.body.role).toBe('staff');
    expect(panel.body.staff.every((s: { email: string | null }) => s.email === null)).toBe(true);

    expect((await shop.aliClient.post(`/api/businesses/${id}/services`, { name: 'X', durationMinutes: 30, priceCents: 1 })).status).toBe(403);
    expect((await shop.aliClient.put(`/api/staff/${shop.ali.id}/working-hours`, { blocks: [] })).status).toBe(403);
    expect((await shop.aliClient.get(`/api/businesses/${id}/stats`)).status).toBe(403);
  });

  it('staff manage only their own time off', async () => {
    const body = { start: istanbul(TUESDAY, '09:00'), end: istanbul(TUESDAY, '12:00') };
    expect((await shop.aliClient.post(`/api/staff/${shop.ali.id}/time-off`, body)).status).toBe(201);
    expect((await shop.aliClient.post(`/api/staff/${shop.banu.id}/time-off`, body)).status).toBe(403);
    expect((await shop.owner.post(`/api/staff/${shop.banu.id}/time-off`, body)).status).toBe(201);
  });

  it('staff only see their own calendar; the owner sees everyone', async () => {
    const customer = env.client();
    await customer.register('c@test.dev');
    await customer.post('/api/appointments', { serviceId: shop.haircut.id, staffId: shop.ali.id, start: istanbul(TUESDAY, '10:00') });
    await customer.post('/api/appointments', { serviceId: shop.haircut.id, staffId: shop.banu.id, start: istanbul(TUESDAY, '11:00') });

    const range = `from=${encodeURIComponent(istanbul(TUESDAY, '00:00'))}&to=${encodeURIComponent(istanbul('2030-01-09', '00:00'))}`;
    const ownerView = await shop.owner.get(`/api/businesses/${shop.business.id}/appointments?${range}`);
    const aliView = await shop.aliClient.get(`/api/businesses/${shop.business.id}/appointments?${range}`);
    expect(ownerView.body.appointments).toHaveLength(2);
    expect(aliView.body.appointments).toHaveLength(1);
    expect(aliView.body.appointments[0].staffName).toBe('Ali');
    expect(aliView.body.appointments[0].customerEmail).toBe('c@test.dev'); // staff can contact their customer
  });

  it('cannot attach another business\' staff to a service', async () => {
    const other = env.client();
    await other.register('other-owner@test.dev');
    const otherBusiness = (await other.post('/api/businesses', { name: 'Diğer', slug: 'diger', category: 'Kuaför' })).body.business;
    const res = await other.post(`/api/businesses/${otherBusiness.id}/services`, {
      name: 'Kesim', durationMinutes: 30, priceCents: 100, staffIds: [shop.ali.id],
    });
    expect(res.status).toBe(400);
  });
});

describe('business management', () => {
  it('rejects overlapping working hours on the same day', async () => {
    const res = await shop.owner.put(`/api/staff/${shop.ali.id}/working-hours`, {
      blocks: [{ weekday: 1, start: '09:00', end: '13:00' }, { weekday: 1, start: '12:00', end: '18:00' }],
    });
    expect(res.status).toBe(400);
    // The old schedule is untouched because the replacement ran in a transaction.
    const panel = await shop.owner.get(`/api/businesses/${shop.business.id}/manage`);
    const ali = panel.body.staff.find((s: { id: number }) => s.id === shop.ali.id);
    expect(ali.workingHours).toHaveLength(10);
  });

  it('rejects a slug that is already taken', async () => {
    const other = env.client();
    await other.register('x@test.dev');
    const res = await other.post('/api/businesses', { name: 'Kopya', slug: 'test-salon', category: 'Kuaför' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLUG_TAKEN');
  });

  it('a deactivated service disappears from the public page and cannot be booked', async () => {
    await shop.owner.patch(`/api/services/${shop.coloring.id}`, { active: false });
    const page = await env.client().get('/api/businesses/by-slug/test-salon');
    expect(page.body.services.map((s: { name: string }) => s.name)).toEqual(['Saç kesimi']);
    const c = env.client();
    await c.register('c@test.dev');
    expect((await c.post('/api/appointments', { serviceId: shop.coloring.id, start: istanbul(TUESDAY, '10:00') })).status).toBe(404);
  });

  it('searches businesses by name or category, treating % literally', async () => {
    const all = await env.client().get('/api/businesses?q=salon');
    expect(all.body.businesses).toHaveLength(1);
    const none = await env.client().get('/api/businesses?q=%25');
    expect(none.body.businesses).toHaveLength(0);
  });
});
