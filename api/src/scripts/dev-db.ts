// npm run db — keeps the local development PostgreSQL running until Ctrl+C.
import { startDevDatabase } from '../db/dev-server.ts';

const { server, port } = await startDevDatabase();
console.log(`PostgreSQL is ready on port ${port} (data: api/.pgdata). Press Ctrl+C to stop.`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30); // keep the process alive
