import { config } from '../config.ts';
import { createDatabase } from '../db/index.ts';
import { migrate } from '../db/migrate.ts';

const { db, pool } = createDatabase(config.databaseUrl);
const applied = await migrate(pool);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
await db.destroy();
