// npm run setup — one-time local setup: database + schema + demo data.
// Starts the local PostgreSQL, runs the seed script against it, then stops it again.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startDevDatabase } from '../db/dev-server.ts';

const { server, databaseUrl } = await startDevDatabase();
try {
  const seed = fileURLToPath(new URL('./seed.ts', import.meta.url));
  // Asynchronous on purpose: this process must keep its event loop running to drain
  // PostgreSQL's log pipes. A blocking spawnSync here deadlocks once that pipe fills up.
  const child = spawn(process.execPath, [seed], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl } });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error('Seeding failed.');
  console.log('\nSetup complete. Start everything with: npm run dev');
} finally {
  await server.stop();
}
