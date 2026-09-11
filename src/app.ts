import express, { type Express } from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { createRouter } from './routes.js';

export function createApp(db: Database): Express {
  const app = express();

  app.use(express.json());

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const publicDir = resolve(currentDir, '../public');
  app.use(express.static(publicDir));

  app.use('/api', createRouter(db));

  return app;
}
