// A real PostgreSQL server inside the project folder (api/.pgdata).
// No installation, no admin rights, no Docker: the binaries come from npm.
//
// On first run it generates a random database password and writes the
// connection string to api/.env, so no credential ever lives in the code.
import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENV_FILE } from '../config.ts';

const DATA_DIR = fileURLToPath(new URL('../../.pgdata', import.meta.url));
const PORT = 54329;
const DATABASE = 'randevu';

export async function startDevDatabase() {
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    if (existsSync(DATA_DIR)) {
      throw new Error('api/.pgdata exists but DATABASE_URL is missing from api/.env. Delete api/.pgdata to start fresh.');
    }
    const url = new URL(`postgres://localhost:${PORT}/${DATABASE}`);
    url.username = 'postgres';
    url.password = randomBytes(16).toString('hex');
    databaseUrl = url.toString();
    appendFileSync(ENV_FILE, `\n# Local development database (created by "npm run db")\nDATABASE_URL=${databaseUrl}\n`);
    process.env.DATABASE_URL = databaseUrl;
    console.log('Created api/.env with a random local database password.');
  }
  const { username, password } = new URL(databaseUrl);

  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: username,
    password: decodeURIComponent(password),
    persistent: true,
    // Windows may report a localized locale name that initdb rejects, so pin a neutral one.
    initdbFlags: ['--locale=C', '--encoding=UTF8'],
    onLog: () => {},
  });

  if (!existsSync(DATA_DIR)) await server.initialise();
  await server.start();

  const client = server.getPgClient();
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE ${DATABASE}`);
  await client.end();

  return { server, databaseUrl, port: PORT };
}
