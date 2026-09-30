import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { UserRow } from './db.js';
import { AppError, type UserRole } from './rules.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
// Node's scrypt defaults, written out so they are visible
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString('hex');
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, key] = parts;
  const derivedKey = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString('hex');
  const bufA = Buffer.from(derivedKey, 'hex');
  const bufB = Buffer.from(key, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(db: Database, userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  db.prepare('INSERT INTO sessions (tokenHash, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    userId,
    createdAt,
    expiresAt
  );

  return { token, expiresAt };
}

export function deleteSession(db: Database, token: string): void {
  const tokenHash = hashToken(token);
  db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(tokenHash);
}

export function getSessionUser(db: Database, token: string): AuthUser | null {
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.displayName, u.role, s.expiresAt
       FROM sessions s
       JOIN users u ON s.userId = u.id
       WHERE s.tokenHash = ?`
    )
    .get(tokenHash) as (Omit<UserRow, 'passwordHash'> & { expiresAt: string }) | undefined;

  if (!row) {
    return null;
  }

  const now = new Date().toISOString();
  if (row.expiresAt <= now) {
    db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(tokenHash);
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
  };
}

export function loginUser(
  db: Database,
  username: string,
  password: string
): { token: string; user: AuthUser } {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;

  if (!row || !verifyPassword(password, row.passwordHash)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
  }

  const { token } = createSession(db, row.id);

  return {
    token,
    user: {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
    },
  };
}
