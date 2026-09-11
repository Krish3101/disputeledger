import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { InvalidCredentialsError, UnauthenticatedError, type UserRole } from './domain.js';

const DUMMY_SALT = '0123456789abcdef0123456789abcdef';
const DUMMY_HASH = scryptSync('dummy-password', DUMMY_SALT, 64).toString('hex');

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, key] = parts;
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  const bufA = Buffer.from(derivedKey, 'hex');
  const bufB = Buffer.from(key, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function createSession(db: Database, userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt
  );

  return { token, expiresAt };
}

export function deleteSession(db: Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getSessionUser(db: Database, token: string): AuthUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.displayName, u.role, s.expiresAt
       FROM sessions s
       JOIN users u ON s.userId = u.id
       WHERE s.token = ?`
    )
    .get(token) as any;

  if (!row) {
    return null;
  }

  const now = new Date().toISOString();
  if (row.expiresAt <= now) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role as UserRole,
  };
}

export function loginUser(
  db: Database,
  username: string,
  password: string
): { token: string; user: AuthUser } {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

  if (!row) {
    // Constant-time dummy verification to prevent timing attack enumeration
    verifyPassword(password, `${DUMMY_SALT}:${DUMMY_HASH}`);
    throw new InvalidCredentialsError();
  }

  const isValid = verifyPassword(password, row.passwordHash);
  if (!isValid) {
    throw new InvalidCredentialsError();
  }

  const { token } = createSession(db, row.id);

  return {
    token,
    user: {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      role: row.role as UserRole,
    },
  };
}
