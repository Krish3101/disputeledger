import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import request from 'supertest';
import type { Express } from 'express';
import { hashPassword } from '../src/auth.js';

export const PASSWORD = 'password123';
const passwordHash = hashPassword(PASSWORD);

export const users = {
  sam: { id: 'u-sam', username: 'supplier', displayName: 'Sam Ortiz (Northwind Supply)', role: 'partner' as const },
  dana: { id: 'u-dana', username: 'buyer', displayName: 'Dana Reyes (Acme Retail)', role: 'partner' as const },
  chris: { id: 'u-chris', username: 'carrier', displayName: 'Chris Vance (Pacific Freight)', role: 'partner' as const },
  ari: { id: 'u-ari', username: 'arbiter', displayName: 'Ari Lund (Meridian Arbitration)', role: 'arbiter' as const },
};

export function insertUsers(db: Database): void {
  const insert = db.prepare(
    'INSERT INTO users (id, username, displayName, passwordHash, role) VALUES (?, ?, ?, ?, ?)'
  );
  for (const u of Object.values(users)) {
    insert.run(u.id, u.username, u.displayName, passwordHash, u.role);
  }
}

export function tmpDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dl-test-')), 'dispute.db');
}

export async function login(app: Express, username: string): Promise<string> {
  const res = await request(app).post('/api/login').send({ username, password: PASSWORD }).expect(200);
  return res.body.token;
}
