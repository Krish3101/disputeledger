import DatabaseConstructor, { type Database } from 'better-sqlite3';

export function createDb(dbPath: string = ':memory:'): Database {
  const db = new DatabaseConstructor(dbPath);
  db.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  initSchema(db);
  return db;
}

export function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      displayName TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('partner', 'arbiter'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id),
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      disputeId TEXT NOT NULL REFERENCES disputes(id),
      type TEXT NOT NULL,
      actorId TEXT NOT NULL REFERENCES users(id),
      payload TEXT NOT NULL,
      occurredAt TEXT NOT NULL,
      prevHash TEXT NOT NULL,
      hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_disputes_claimant ON disputes(claimantId);
    CREATE INDEX IF NOT EXISTS idx_disputes_respondent ON disputes(respondentId);
    CREATE INDEX IF NOT EXISTS idx_evidence_disputeId ON evidence(disputeId);
    CREATE INDEX IF NOT EXISTS idx_events_disputeId ON events(disputeId);
  `);
}
