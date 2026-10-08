import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { ZodError } from 'zod';
import { createRouter } from './routes.js';
import { AppError } from './rules.js';

export function createApp(db: Database): Express {
  const app = express();

  app.use(express.json());

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const publicDir = resolve(currentDir, '../public');
  app.use(express.static(publicDir));

  app.use('/api', createRouter(db));

  // The one error handler: every failure leaves as {"error": {"code", "message"}}
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, code, message } = toAppError(err);
    if (status >= 500) {
      console.error(err);
    }
    res.status(status).json({ error: { code, message } });
  });

  return app;
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const path = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return new AppError(400, 'VALIDATION_FAILED', issue ? `${path}${issue.message}` : 'Validation failed');
  }
  const type = (err as { type?: string }).type;
  if (type === 'entity.parse.failed') {
    return new AppError(400, 'INVALID_JSON', 'Malformed JSON payload in request body.');
  }
  if (type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request payload exceeds maximum allowed size.');
  }
  // Never echo driver codes like SQLITE_ERROR back to the client
  return new AppError(500, 'INTERNAL', 'An internal server error occurred.');
}
