// npm run setup — one-time local setup: database + schema + demo data.
// Starts the local PostgreSQL, runs the seed script against it, then stops it again.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startDevDatabase } from '../db/dev-server.ts';

const { server, databaseUrl } = await startDevDatabase();
try {
  const seed = fileURLToPath(new URL('./seed.ts', import.meta.url));
  const result = spawnSync(process.execPath, [seed], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl } });
  if (result.status !== 0) throw new Error('Seeding failed.');
  console.log('\nSetup complete. Start everything with: npm run dev');
} finally {
  await server.stop();
}
