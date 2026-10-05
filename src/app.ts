import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { createRouter } from './routes.js';

export function createApp(db: Database): Express {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
        },
      },
    })
  );

  app.use(express.json());

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const publicDir = resolve(currentDir, '../public');
  app.use(express.static(publicDir));

  app.use('/api', createRouter(db));

  // App-level error handler for body-parser syntax errors, 413s, and uncaught errors
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Malformed JSON payload in request body.',
        },
      });
    }
    if (err.type === 'entity.too.large' || err.status === 413) {
      return res.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request payload exceeds maximum allowed size.',
        },
      });
    }
    const status = typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) {
      console.error(err);
    }
    // Never echo driver codes like SQLITE_ERROR back to the client
    return res.status(status).json({
      error: {
        code: status < 500 ? 'BAD_REQUEST' : 'INTERNAL',
        message: status < 500 ? err.message : 'An internal server error occurred.',
      },
    });
  });

  return app;
}
