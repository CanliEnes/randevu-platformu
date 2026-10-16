import { sql } from 'kysely';
import { inject } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { AppContext } from '../src/context.ts';
import { createDatabase, type Db } from '../src/db/index.ts';
import { MemoryQueue } from '../src/lib/queue.ts';
import type { Mail } from '../src/modules/notifications.ts';

/** Monday 7 January 2030, 08:00 in Istanbul. Every test starts at this frozen moment. */
export const START_TIME = new Date('2030-01-07T08:00:00+03:00');

export type TestEnv = Awaited<ReturnType<typeof createTestEnv>>;

export async function createTestEnv() {
  const { db, pool } = createDatabase(inject('databaseUrl'));
  const clock = { now: new Date(START_TIME) };
  const queue = new MemoryQueue();
  const mails: Mail[] = [];
  const ctx: AppContext = {
    db,
    pool,
    queue,
    mailer: { send: async (mail) => void mails.push(mail) },
    now: () => clock.now,
    appUrl: 'http://app.test',
  };
  const app = await buildApp(ctx, { rateLimit: false });
  await app.ready();

  return {
    app,
    ctx,
    db,
    clock,
    queue,
    mails,
    /** Empties every table and resets the clock, queue and mailbox. */
    async reset() {
      await resetDatabase(db);
      clock.now = new Date(START_TIME);
      queue.jobs.length = 0;
      mails.length = 0;
    },
    client: () => new TestClient(app),
    async close() {
      await app.close();
      await db.destroy();
    },
  };
}

export async function resetDatabase(db: Db) {
  await sql`TRUNCATE users, sessions, businesses, staff, services, staff_services, working_hours,
            time_off, appointments, reviews, sent_emails RESTART IDENTITY CASCADE`.execute(db);
}

type App = Awaited<ReturnType<typeof buildApp>>;

/** A tiny HTTP client that keeps the session cookie between requests, like a browser. */
export class TestClient {
  cookie: string | null = null;
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  async request(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown) {
    const response = await this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
    });
    const setCookie = response.headers['set-cookie'];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (first) this.cookie = first.split(';')[0]!;
    const json: any = response.body ? JSON.parse(response.body) : null;
    return { status: response.statusCode, body: json };
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body?: unknown) => this.request('POST', url, body);
  patch = (url: string, body?: unknown) => this.request('PATCH', url, body);
  put = (url: string, body?: unknown) => this.request('PUT', url, body);
  delete = (url: string) => this.request('DELETE', url);

  async register(email: string, fullName = 'Test Kullanıcı') {
    const res = await this.post('/api/auth/register', { email, password: 'gizli-sifre-123', fullName });
    if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    return res.body.user as { id: number; email: string };
  }
}

/** Monday-Friday, 09:00-12:00 and 13:00-18:00 (lunch break 12-13). */
export const WEEKDAY_HOURS = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, start: '09:00', end: '12:00' },
  { weekday, start: '13:00', end: '18:00' },
]);

/**
 * A business with an owner, two staff members (Ali with a login, Banu without)
 * and two services: a 30-minute haircut and a 60-minute coloring.
 */
export async function setupBusiness(env: TestEnv) {
  const owner = env.client();
  await owner.register('owner@test.dev', 'Owner Kişi');
  const aliClient = env.client();
  await aliClient.register('ali@test.dev', 'Ali Çalışan');

  const business = (await owner.post('/api/businesses', {
    name: 'Test Salon', slug: 'test-salon', category: 'Kuaför', ownerIsStaff: false,
  })).body.business;

  const ali = (await owner.post(`/api/businesses/${business.id}/staff`, { displayName: 'Ali', email: 'ali@test.dev' })).body.staff;
  const banu = (await owner.post(`/api/businesses/${business.id}/staff`, { displayName: 'Banu' })).body.staff;

  const haircut = (await owner.post(`/api/businesses/${business.id}/services`, {
    name: 'Saç kesimi', durationMinutes: 30, priceCents: 50_000, staffIds: [ali.id, banu.id],
  })).body.service;
  const coloring = (await owner.post(`/api/businesses/${business.id}/services`, {
    name: 'Boya', durationMinutes: 60, priceCents: 150_000, staffIds: [ali.id],
  })).body.service;

  for (const staff of [ali, banu]) {
    const res = await owner.put(`/api/staff/${staff.id}/working-hours`, { blocks: WEEKDAY_HOURS });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  }

  return { owner, aliClient, business, ali, banu, haircut, coloring };
}

/** ISO timestamp for a wall-clock time in Istanbul (UTC+3, no DST). */
export const istanbul = (date: string, time: string) => `${date}T${time}:00+03:00`;
