import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError } from 'fastify';
import type { AppContext } from './context.ts';
import { AppError } from './lib/errors.ts';
import { registerAppointments } from './modules/appointments.ts';
import { registerAuth } from './modules/auth.ts';
import { registerAvailability } from './modules/availability.ts';
import { registerBusinesses } from './modules/businesses.ts';
import { registerNotifications } from './modules/notifications.ts';
import { registerRealtime } from './modules/realtime.ts';
import { registerStats } from './modules/stats.ts';

export interface AppOptions {
  logger?: boolean;
  rateLimit?: boolean;
  cookieSecure?: boolean;
  /** Folder with the built React app; served with an SPA fallback when set. */
  webDist?: string | null;
}

export async function buildApp(ctx: AppContext, options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });

  // Only JSON request bodies are accepted. HTML forms on other sites cannot
  // send JSON, which closes one more door for cross-site request forgery.
  app.removeContentTypeParser('text/plain');

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: { 'connect-src': ["'self'"], 'img-src': ["'self'", 'data:'] },
    },
  });
  if (options.rateLimit ?? true) await app.register(rateLimit, { global: false });
  await app.register(websocket);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    // Errors raised by Fastify itself (bad JSON, 415, 429 ...) already carry a 4xx status.
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: { code: error.code ?? 'BAD_REQUEST', message: error.message } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Beklenmeyen bir hata oluştu.' } });
  });

  app.get('/api/health', async () => ({ ok: true }));

  registerAuth(app, ctx, { rateLimit: options.rateLimit ?? true, cookieSecure: options.cookieSecure ?? false });
  registerBusinesses(app, ctx);
  registerAvailability(app, ctx);
  registerAppointments(app, ctx);
  registerStats(app, ctx);
  registerNotifications(app, ctx);
  await registerRealtime(app, ctx);

  const webDist = options.webDist;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
  }
  app.setNotFoundHandler((request, reply) => {
    // Unknown /api/* paths are real 404s; every other path belongs to the React router.
    if (request.url.startsWith('/api/') || !webDist || !existsSync(webDist) || request.method !== 'GET') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Adres bulunamadı.' } });
    }
    return reply.sendFile('index.html');
  });

  return app;
}
