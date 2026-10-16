import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
beforeAll(async () => (env = await createTestEnv()));
beforeEach(async () => env.reset());
afterAll(async () => env.close());

describe('authentication', () => {
  it('registers, remembers the session and logs out', async () => {
    const client = env.client();
    const user = await client.register('Ayse@Test.dev', 'Ayşe Yılmaz');
    expect(user.email).toBe('ayse@test.dev'); // e-mails are stored in lower case

    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.fullName).toBe('Ayşe Yılmaz');

    expect((await client.post('/api/auth/logout')).status).toBe(204);
    expect((await client.get('/api/auth/me')).body.user).toBeNull();
  });

  it('stores only a hash of the session token and an argon2 hash of the password', async () => {
    const client = env.client();
    await client.register('hash@test.dev');
    const token = client.cookie!.split('=')[1]!;
    const session = await env.db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow();
    expect(session.token_hash).not.toContain(token);
    expect(session.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const user = await env.db.selectFrom('users').select('password_hash').executeTakeFirstOrThrow();
    expect(user.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('rejects a duplicate e-mail regardless of letter case', async () => {
    await env.client().register('same@test.dev');
    const res = await env.client().post('/api/auth/register', { email: 'SAME@test.dev', password: 'gizli-sifre-123', fullName: 'Başka' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('gives the same answer for an unknown e-mail and a wrong password', async () => {
    await env.client().register('known@test.dev');
    const wrongPassword = await env.client().post('/api/auth/login', { email: 'known@test.dev', password: 'yanlis-sifre' });
    const unknownEmail = await env.client().post('/api/auth/login', { email: 'nobody@test.dev', password: 'yanlis-sifre' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('logs in with the right password', async () => {
    await env.client().register('login@test.dev');
    const client = env.client();
    const res = await client.post('/api/auth/login', { email: 'login@test.dev', password: 'gizli-sifre-123' });
    expect(res.status).toBe(200);
    expect((await client.get('/api/auth/me')).body.user.email).toBe('login@test.dev');
  });

  it('expires sessions after 30 days', async () => {
    const client = env.client();
    await client.register('old@test.dev');
    env.clock.now = new Date(env.clock.now.getTime() + 31 * 86_400_000);
    expect((await client.get('/api/auth/me')).body.user).toBeNull();
    expect((await client.get('/api/me/appointments')).status).toBe(401);
  });

  it('validates input and lists every problem', async () => {
    const res = await env.client().post('/api/auth/register', { email: 'not-an-email', password: '123', fullName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['email', 'fullName', 'password']);
  });

  it('limits login attempts to 10 per minute', async () => {
    const limited = await createTestEnv({ rateLimit: true });
    try {
      const statuses = [];
      for (let i = 0; i < 11; i++) {
        statuses.push((await limited.client().post('/api/auth/login', { email: 'x@test.dev', password: 'yanlis' })).status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('only accepts JSON bodies', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: 'x', headers: { 'content-type': 'text/plain' } });
    expect(res.statusCode).toBe(415);
  });
});
