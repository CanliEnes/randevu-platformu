import { z } from 'zod';

/** An error that is safe to show to the client: it carries an HTTP status and a stable code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Bu işlem için giriş yapmalısınız.');
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'Bu işlem için yetkiniz yok.');
export const notFound = (what = 'Kayıt') => new AppError(404, 'NOT_FOUND', `${what} bulunamadı.`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);

/** Validates untrusted input against a Zod schema; throws a 400 AppError listing every problem. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  throw new AppError(400, 'VALIDATION_FAILED', 'Gönderilen bilgiler geçersiz.', issues);
}

/** PostgreSQL error codes we turn into friendly responses. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
} as const;

export function isPgError(error: unknown, code: string): error is { code: string; constraint?: string } {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
