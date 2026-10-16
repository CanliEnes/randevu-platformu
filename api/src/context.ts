import type pg from 'pg';
import type { Db } from './db/index.ts';
import type { JobQueue } from './lib/queue.ts';
import type { Mailer } from './modules/notifications.ts';

/** Everything the route handlers depend on. Tests build one with fakes. */
export interface AppContext {
  db: Db;
  pool: pg.Pool;
  queue: JobQueue;
  mailer: Mailer;
  /** The current time. Injected so tests can freeze the clock. */
  now: () => Date;
  appUrl: string;
}
