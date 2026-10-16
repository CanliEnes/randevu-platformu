import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load api/.env if present (Node 24 can read .env files without a library).
export const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

function required(name: string, hint: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set. ${hint}`);
  return value;
}

export const config = {
  isProduction,
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1'),
  get databaseUrl() {
    return required('DATABASE_URL', 'Run "npm run db" once (it creates api/.env) or see api/.env.example.');
  },
  // Public address of the web app, used in e-mail links.
  appUrl: env.APP_URL ?? 'http://localhost:5173',
  smtpUrl: env.SMTP_URL || null,
  mailFrom: env.MAIL_FROM ?? 'Randevu Platformu <noreply@randevu.test>',
  // Store every outgoing e-mail in the sent_emails table (demo mailbox).
  demoOutbox: env.DEMO_OUTBOX !== 'false',
};
