import DatabaseConstructor, { type Database } from 'better-sqlite3';
import type { DisputeStatus, UserRole } from './rules.js';

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

export function findDispute(db: Database, id: string): DisputeRow | undefined {
  return db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as DisputeRow | undefined;
}

export function createDb(dbPath: string = ':memory:'): Database {
  const db = new DatabaseConstructor(dbPath);
  // Off by default in SQLite, and the REFERENCES clauses below rely on it
  db.pragma('foreign_keys = ON');
  createSchema(db);
  return db;
}

function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      displayName TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('partner', 'arbiter'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS disputes (
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

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      disputeId TEXT NOT NULL REFERENCES disputes(id),
      submittedById TEXT NOT NULL REFERENCES users(id),
      notes TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      disputeId TEXT NOT NULL REFERENCES disputes(id),
      type TEXT NOT NULL CHECK(type IN ('DISPUTE_RAISED', 'EVIDENCE_ADDED', 'DISPUTE_RESOLVED')),
      actorId TEXT NOT NULL REFERENCES users(id),
      payload TEXT NOT NULL,
      occurredAt TEXT NOT NULL,
      prevHash TEXT NOT NULL UNIQUE CHECK(length(prevHash) = 64),
      hash TEXT NOT NULL UNIQUE CHECK(length(hash) = 64)
    );
  `);
}
