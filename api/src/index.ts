import { fileURLToPath } from 'node:url';
import { PgBoss } from 'pg-boss';
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { createDatabase, waitForDatabase } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { JOBS, pgBossQueue, type AppointmentJob } from './lib/queue.ts';
import { createJobHandlers, createMailer } from './modules/notifications.ts';
import type { AppContext } from './context.ts';

const { db, pool } = createDatabase(config.databaseUrl);
await waitForDatabase(pool);
const applied = await migrate(pool);
if (applied.length) console.log(`Migrations applied: ${applied.join(', ')}`);

// Job queue (stored in PostgreSQL, schema "pgboss").
const boss = new PgBoss(config.databaseUrl);
boss.on('error', (error) => console.error('[pg-boss]', error));
await boss.start();
for (const name of Object.values(JOBS)) await boss.createQueue(name);

const ctx: AppContext = {
  db,
  pool,
  queue: pgBossQueue(boss),
  mailer: createMailer(db, { smtpUrl: config.smtpUrl, from: config.mailFrom, demoOutbox: config.demoOutbox }),
  now: () => new Date(),
  appUrl: config.appUrl,
};

// Workers: run the background jobs in this same process.
const handlers = createJobHandlers(ctx);
for (const name of Object.values(JOBS)) {
  await boss.work<AppointmentJob>(name, async (jobs) => {
    for (const job of jobs) await handlers[name](job.data);
  });
}

const app = await buildApp(ctx, {
  logger: true,
  cookieSecure: config.isProduction,
  webDist: fileURLToPath(new URL('../../web/dist', import.meta.url)),
});
await app.listen({ port: config.port, host: config.host });

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await boss.stop({ graceful: true });
  await db.destroy();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
