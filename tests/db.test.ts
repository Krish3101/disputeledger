import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, it, expect } from 'vitest';
import DatabaseConstructor from 'better-sqlite3';
import { createDb, SCHEMA_VERSION } from '../src/db.js';
import { getLedgerKey } from '../src/config.js';
import { tmpDbPath } from './helpers.js';

// The schema from before the ledger rework (commit c1e92d9)
const OLD_SCHEMA = `
  CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, displayName TEXT NOT NULL,
    passwordHash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('partner', 'arbiter')));
  CREATE TABLE sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt TEXT NOT NULL);
  CREATE TABLE disputes (id TEXT PRIMARY KEY, orderReference TEXT NOT NULL, description TEXT NOT NULL,
    status TEXT NOT NULL, claimantId TEXT NOT NULL, respondentId TEXT NOT NULL, createdAt TEXT NOT NULL,
    resolutionNote TEXT, resolvedById TEXT, resolvedAt TEXT);
  CREATE TABLE evidence (id TEXT PRIMARY KEY, disputeId TEXT NOT NULL, submittedById TEXT NOT NULL,
    notes TEXT NOT NULL, createdAt TEXT NOT NULL);
  CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, disputeId TEXT NOT NULL, type TEXT NOT NULL,
    actorId TEXT NOT NULL, payload TEXT NOT NULL, occurredAt TEXT NOT NULL, prevHash TEXT NOT NULL, hash TEXT NOT NULL);
`;

describe('database setup', () => {
  it('creates the schema on an empty file and sets the version and pragmas', () => {
    const path = tmpDbPath();
    const db = createDb(path);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(2);
    expect(db.prepare("SELECT value FROM meta WHERE key = 'ledgerId'").get()).toBeDefined();
    db.close();

    // Opening it again keeps the same ledger id
    const before = new DatabaseConstructor(path).prepare('SELECT value FROM meta').get();
    const again = createDb(path);
    expect(again.prepare('SELECT value FROM meta').get()).toEqual(before);
    again.close();
  });

  it('refuses a database from the old schema with a clear message', () => {
    const path = tmpDbPath();
    const old = new DatabaseConstructor(path);
    old.exec(OLD_SCHEMA);
    old.close();
    expect(() => createDb(path)).toThrow('was made by an older version: delete it and run npm run seed');
  });

  it('refuses a database with a different schema version', () => {
    const path = tmpDbPath();
    const db = createDb(path);
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => createDb(path)).toThrow('delete it and run npm run seed');
  });
});

describe('config', () => {
  const saved = process.env.LEDGER_KEY;
  afterEach(() => {
    process.env.LEDGER_KEY = saved;
  });

  it('rejects a missing or short LEDGER_KEY', () => {
    delete process.env.LEDGER_KEY;
    expect(() => getLedgerKey()).toThrow('LEDGER_KEY is not set');
    process.env.LEDGER_KEY = 'short-key';
    expect(() => getLedgerKey()).toThrow('at least 32 characters');
  });

  it('accepts a key of 32 characters', () => {
    process.env.LEDGER_KEY = 'k'.repeat(32);
    expect(getLedgerKey()).toBe('k'.repeat(32));
  });

  it('the server refuses to start with a short key', () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      env: { ...process.env, LEDGER_KEY: 'short-key', DB_PATH: tmpDbPath(), PORT: '0' },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('at least 32 characters');
  });
});

describe('seed', () => {
  const seed = (dbPath: string, extraEnv: Record<string, string> = {}) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/seed.ts'], {
      env: { ...process.env, DB_PATH: dbPath, ...extraEnv },
      encoding: 'utf8',
      timeout: 20_000,
    });

  it('seeds a new database and verifies it', () => {
    const path = tmpDbPath();
    const run = seed(path);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('OK (7 events verified)');
  });

  it('refuses to overwrite an existing file without DEMO_RESEED=1', () => {
    const path = tmpDbPath();
    writeFileSync(path, 'keep me');
    const run = seed(path);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('DEMO_RESEED=1');
    expect(readFileSync(path, 'utf8')).toBe('keep me');
  });

  it('replaces an existing file with DEMO_RESEED=1', () => {
    const path = tmpDbPath();
    writeFileSync(path, 'old');
    const run = seed(path, { DEMO_RESEED: '1' });
    expect(run.status).toBe(0);
    expect(existsSync(path)).toBe(true);
  });
});
