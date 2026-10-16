// Runs once before all tests: provides a fresh PostgreSQL database with the schema applied.
// - In CI, TEST_DATABASE_URL points at a PostgreSQL service container.
// - Locally, a throw-away embedded PostgreSQL is started in a temp folder.
import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../src/db/index.ts';
import { migrate } from '../src/db/migrate.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  let databaseUrl = process.env.TEST_DATABASE_URL;
  let server: EmbeddedPostgres | null = null;

  if (!databaseUrl) {
    const port = 54331;
    const password = randomBytes(12).toString('hex');
    server = new EmbeddedPostgres({
      databaseDir: mkdtempSync(path.join(tmpdir(), 'randevu-test-pg-')),
      port,
      user: 'postgres',
      password,
      persistent: false, // data folder is deleted on stop
      initdbFlags: ['--locale=C', '--encoding=UTF8'],
      onLog: () => {},
    });
    await server.initialise();
    await server.start();
    await server.createDatabase('randevu_test');
    const url = new URL(`postgres://localhost:${port}/randevu_test`);
    url.username = 'postgres';
    url.password = password;
    databaseUrl = url.toString();
  }

  const { db, pool } = createDatabase(databaseUrl);
  await migrate(pool);
  await db.destroy();

  project.provide('databaseUrl', databaseUrl);

  return async () => {
    await server?.stop();
  };
}
