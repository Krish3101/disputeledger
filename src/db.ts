import { randomUUID } from 'node:crypto';
import DatabaseConstructor, { type Database } from 'better-sqlite3';
import type { DisputeStatus, UserRole } from './domain.js';

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
}

export interface DisputeRow {
  id: string;
  orderReference: string;
  description: string;
  status: DisputeStatus;
  claimantId: string;
  respondentId: string;
  createdAt: string;
  resolutionNote: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
}

export interface EvidenceRow {
  id: string;
  disputeId: string;
  submittedById: string;
  notes: string;
  createdAt: string;
}

export const SCHEMA_VERSION = 2;

export function findDispute(db: Database, id: string): DisputeRow | undefined {
  return db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as DisputeRow | undefined;
}

export function readLedgerId(db: Database): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'ledgerId'").get() as { value: string } | undefined;
  return row?.value;
}

export function getLedgerId(db: Database): string {
  const ledgerId = readLedgerId(db);
  if (!ledgerId) {
    throw new Error('The ledger id is missing from the meta table.');
  }
  return ledgerId;
}

export function createDb(dbPath: string = ':memory:'): Database {
  const db = new DatabaseConstructor(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
  }

  const version = db.pragma('user_version', { simple: true }) as number;
  const tableCount = (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'").get() as { c: number }).c;
  if (version === 0 && tableCount === 0) {
    db.transaction(() => {
      createSchema(db);
      db.prepare("INSERT INTO meta (key, value) VALUES ('ledgerId', ?)").run(randomUUID());
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  } else if (version !== SCHEMA_VERSION) {
    db.close();
    // No migrations: the only old databases are local demo files
    throw new Error(`${dbPath} was made by an older version: delete it and run npm run seed`);
  }
  return db;
}

function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      displayName TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('partner', 'arbiter'))
    );

    CREATE TABLE sessions (
      tokenHash TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );

    CREATE TABLE disputes (
      id TEXT PRIMARY KEY,
      orderReference TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('OPEN', 'RESOLVED')),
      claimantId TEXT NOT NULL REFERENCES users(id),
      respondentId TEXT NOT NULL REFERENCES users(id),
      createdAt TEXT NOT NULL,
      resolutionNote TEXT,
      resolvedById TEXT REFERENCES users(id),
      resolvedAt TEXT,
      CHECK (claimantId <> respondentId),
      CHECK (
        (status = 'OPEN' AND resolutionNote IS NULL AND resolvedById IS NULL AND resolvedAt IS NULL) OR
        (status = 'RESOLVED' AND resolutionNote IS NOT NULL AND resolvedById IS NOT NULL AND resolvedAt IS NOT NULL)
      )
    );

    CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      disputeId TEXT NOT NULL REFERENCES disputes(id),
      submittedById TEXT NOT NULL REFERENCES users(id),
      notes TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      disputeId TEXT NOT NULL REFERENCES disputes(id),
      type TEXT NOT NULL CHECK(type IN ('DISPUTE_RAISED', 'EVIDENCE_ADDED', 'DISPUTE_RESOLVED')),
      actorId TEXT NOT NULL REFERENCES users(id),
      payload TEXT NOT NULL,
      occurredAt TEXT NOT NULL,
      prevHash TEXT NOT NULL UNIQUE CHECK(length(prevHash) = 64),
      hash TEXT NOT NULL UNIQUE CHECK(length(hash) = 64)
    );

    CREATE INDEX idx_sessions_userId ON sessions(userId);
    CREATE INDEX idx_sessions_expiresAt ON sessions(expiresAt);
    CREATE INDEX idx_disputes_claimant ON disputes(claimantId);
    CREATE INDEX idx_disputes_respondent ON disputes(respondentId);
    CREATE INDEX idx_evidence_disputeId ON evidence(disputeId);
    CREATE INDEX idx_evidence_dispute_created ON evidence(disputeId, createdAt);
    CREATE INDEX idx_events_disputeId ON events(disputeId);
  `);
}
