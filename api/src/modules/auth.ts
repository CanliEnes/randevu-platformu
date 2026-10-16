import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { AppError, conflict, isPgError, parse, PG, unauthorized } from '../lib/errors.ts';

export interface SessionUser {
  id: number;
  email: string;
  fullName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw unauthorized();
  return request.user;
}

const email = z.email('Geçerli bir e-posta adresi girin.').max(254).transform((v) => v.toLowerCase());
const registerSchema = z.object({
  email,
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı.').max(128),
  fullName: z.string().trim().min(2, 'Ad en az 2 karakter olmalı.').max(80),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });

export function registerAuth(app: FastifyInstance, ctx: AppContext, opts: { rateLimit: boolean; cookieSecure: boolean }) {
  const { db } = ctx;

  // Runs before every request: turns the session cookie into request.user.
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const row = await db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .select(['users.id', 'users.email', 'users.full_name'])
      .where('sessions.token_hash', '=', hashToken(token))
      .where('sessions.expires_at', '>', ctx.now())
      .executeTakeFirst();
    if (row) request.user = { id: row.id, email: row.email, fullName: row.full_name };
  });

  async function startSession(reply: FastifyReply, userId: number) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(ctx.now().getTime() + SESSION_DAYS * 86_400_000);
    await db.insertInto('sessions').values({ token_hash: hashToken(token), user_id: userId, expires_at: expiresAt }).execute();
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true, // JavaScript in the page cannot read it, so XSS cannot steal it
      sameSite: 'lax', // not sent with cross-site POSTs, which blocks CSRF
      secure: opts.cookieSecure,
      expires: expiresAt,
    });
  }

  // Brute-force protection: at most 10 attempts per minute per IP.
  const limited = { rateLimit: opts.rateLimit ? { max: 10, timeWindow: '1 minute' } : (false as const) };

  app.post('/api/auth/register', { config: limited }, async (request, reply) => {
    const body = parse(registerSchema, request.body);
    const passwordHash = await argon2.hash(body.password); // argon2id with a random salt
    try {
      const user = await db
        .insertInto('users')
        .values({ email: body.email, password_hash: passwordHash, full_name: body.fullName })
        .returning(['id', 'email', 'full_name'])
        .executeTakeFirstOrThrow();
      await startSession(reply, user.id);
      return reply.status(201).send({ user: { id: user.id, email: user.email, fullName: user.full_name } });
    } catch (error) {
      if (isPgError(error, PG.UNIQUE_VIOLATION)) throw conflict('EMAIL_TAKEN', 'Bu e-posta adresiyle zaten bir hesap var.');
      throw error;
    }
  });

  app.post('/api/auth/login', { config: limited }, async (request, reply) => {
    const body = parse(loginSchema, request.body);
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'full_name', 'password_hash'])
      .where('email', '=', body.email)
      .executeTakeFirst();
    // Same message whether the e-mail or the password is wrong: do not reveal which accounts exist.
    const ok = user ? await argon2.verify(user.password_hash, body.password) : false;
    if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'E-posta veya şifre hatalı.');
    await startSession(reply, user.id);
    return { user: { id: user.id, email: user.email, fullName: user.full_name } };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await db.deleteFrom('sessions').where('token_hash', '=', hashToken(token)).execute();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  // Who am I, and which businesses can I manage?
  app.get('/api/auth/me', async (request) => {
    const user = requireUser(request);
    const owned = await db
      .selectFrom('businesses')
      .select(['id', 'name', 'slug'])
      .where('owner_id', '=', user.id)
      .orderBy('name')
      .execute();
    const staffOf = await db
      .selectFrom('staff')
      .innerJoin('businesses', 'businesses.id', 'staff.business_id')
      .select(['businesses.id', 'businesses.name', 'businesses.slug', 'staff.id as staffId'])
      .where('staff.user_id', '=', user.id)
      .where('staff.active', '=', true)
      .where('businesses.owner_id', '<>', user.id)
      .orderBy('businesses.name')
      .execute();
    return {
      user,
      memberships: [
        ...owned.map((b) => ({ businessId: b.id, name: b.name, slug: b.slug, role: 'owner' as const })),
        ...staffOf.map((b) => ({ businessId: b.id, name: b.name, slug: b.slug, role: 'staff' as const, staffId: b.staffId })),
      ],
    };
  });
}
