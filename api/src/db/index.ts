import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from './types.ts';

// PostgreSQL returns bigint (int8) and numeric as strings because they can
// exceed JavaScript's safe integer range. Our ids and counts never will.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

export type Db = Kysely<Database>;

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // An idle connection can be dropped by the server (restart, network). Without this
  // listener that would be an unhandled 'error' event and crash the whole process;
  // the pool simply opens a new connection on the next query.
  pool.on('error', (error) => console.error('[pg] idle client error:', error.message));
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return { db, pool };
}

/** Wait until PostgreSQL accepts connections (useful while the dev database is still starting). */
export async function waitForDatabase(pool: pg.Pool, attempts = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (i >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
