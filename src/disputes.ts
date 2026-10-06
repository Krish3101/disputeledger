import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { AuthUser } from './auth.js';
import { getLedgerKey } from './config.js';
import { findDispute, getLedgerId } from './db.js';
import {
  assertCanAddEvidence,
  assertCanResolve,
  assertUserCanRaiseDispute,
  canUserAddEvidence,
  canUserResolveDispute,
  canUserViewDispute,
  DisputeNotOpenError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from './domain.js';
import {
  formatDispute,
  formatDisputeList,
  formatEvents,
  type DisputeEvent,
  type DisputeRepresentation,
} from './format.js';
import { buildCanonicalPayload, computeEventHash, getGenesisHash, type EventType } from './ledger/chain.js';

// Every write below runs in one IMMEDIATE transaction: the checks, the row and its ledger event
// commit together or not at all, and no other connection can write in between.

// Never earlier than the newest event: a clock stepped backwards must not make the chain look
// tampered with (the integrity check flags any decrease). Call inside the write transaction.
function nextOccurredAt(db: Database): string {
  const now = new Date().toISOString();
  const last = db.prepare('SELECT occurredAt FROM events ORDER BY id DESC LIMIT 1').get() as
    | { occurredAt: string }
    | undefined;
  return last && last.occurredAt > now ? last.occurredAt : now;
}

function appendEvent(
  db: Database,
  disputeId: string,
  type: EventType,
  actorId: string,
  occurredAt: string,
  rawPayload: Record<string, string>
): void {
  const ledgerId = getLedgerId(db);
  const last = db.prepare('SELECT id, hash FROM events ORDER BY id DESC LIMIT 1').get() as
    | { id: number; hash: string }
    | undefined;
  const prevHash = last ? last.hash : getGenesisHash(ledgerId);
  const id = last ? last.id + 1 : 1;

  const payload = buildCanonicalPayload(type, rawPayload);
  const hash = computeEventHash(prevHash, { id, disputeId, type, actorId, occurredAt, payload }, getLedgerKey(), ledgerId);

  db.prepare(
    `INSERT INTO events (id, disputeId, type, actorId, payload, occurredAt, prevHash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, disputeId, type, actorId, JSON.stringify(payload), occurredAt, prevHash, hash);
}

export function raiseDispute(
  db: Database,
  user: AuthUser,
  input: { orderReference: string; description: string; respondentId: string }
): DisputeRepresentation {
  assertUserCanRaiseDispute(user.role);
  if (input.respondentId === user.id) {
    throw new ValidationError('Respondent cannot be the claimant.');
  }

  const disputeId = randomUUID();

  db.transaction(() => {
    const createdAt = nextOccurredAt(db);
    const respondent = db.prepare('SELECT role FROM users WHERE id = ?').get(input.respondentId) as
      | { role: string }
      | undefined;
    if (!respondent || respondent.role !== 'partner') {
      throw new ValidationError('Respondent must be an existing partner user.');
    }

    db.prepare(
      `INSERT INTO disputes (id, orderReference, description, status, claimantId, respondentId, createdAt)
       VALUES (?, ?, ?, 'OPEN', ?, ?, ?)`
    ).run(disputeId, input.orderReference, input.description, user.id, input.respondentId, createdAt);

    appendEvent(db, disputeId, 'DISPUTE_RAISED', user.id, createdAt, {
      orderReference: input.orderReference,
      description: input.description,
      respondentId: input.respondentId,
    });
  }).immediate();

  return formatDispute(db, disputeId);
}

export function addEvidence(
  db: Database,
  user: AuthUser,
  disputeId: string,
  input: { notes: string }
): DisputeRepresentation {
  const evidenceId = randomUUID();

  db.transaction(() => {
    const createdAt = nextOccurredAt(db);
    const dispute = findDispute(db, disputeId);
    if (!dispute) {
      throw new NotFoundError();
    }
    if (!canUserAddEvidence(user, dispute)) {
      if (canUserViewDispute(user, dispute)) {
        throw new ForbiddenError('Only the two parties can add evidence.');
      }
      throw new NotFoundError();
    }
    assertCanAddEvidence(dispute.status);

    db.prepare(
      `INSERT INTO evidence (id, disputeId, submittedById, notes, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(evidenceId, disputeId, user.id, input.notes, createdAt);

    appendEvent(db, disputeId, 'EVIDENCE_ADDED', user.id, createdAt, { evidenceId, notes: input.notes });
  }).immediate();

  return formatDispute(db, disputeId);
}

export function resolveDispute(
  db: Database,
  user: AuthUser,
  disputeId: string,
  input: { resolutionNote: string }
): DisputeRepresentation {
  if (!canUserResolveDispute(user)) {
    throw new ForbiddenError('Only an arbiter can resolve a dispute.');
  }
  db.transaction(() => {
    const resolvedAt = nextOccurredAt(db);
    const dispute = findDispute(db, disputeId);
    if (!dispute) {
      throw new NotFoundError();
    }
    assertCanResolve(dispute.status);

    const update = db
      .prepare(
        `UPDATE disputes
         SET status = 'RESOLVED', resolutionNote = ?, resolvedById = ?, resolvedAt = ?
         WHERE id = ? AND status = 'OPEN'`
      )
      .run(input.resolutionNote, user.id, resolvedAt, disputeId);
    if (update.changes !== 1) {
      throw new DisputeNotOpenError('Dispute is already resolved.');
    }

    appendEvent(db, disputeId, 'DISPUTE_RESOLVED', user.id, resolvedAt, { resolutionNote: input.resolutionNote });
  }).immediate();

  return formatDispute(db, disputeId);
}

function findVisibleDispute(db: Database, user: AuthUser, disputeId: string) {
  const dispute = findDispute(db, disputeId);
  // A dispute the user can't see looks the same as one that doesn't exist
  if (!dispute || !canUserViewDispute(user, dispute)) {
    throw new NotFoundError();
  }
  return dispute;
}

export function getDispute(db: Database, user: AuthUser, disputeId: string): DisputeRepresentation {
  findVisibleDispute(db, user, disputeId);
  return formatDispute(db, disputeId);
}

export function listDisputes(db: Database, user: AuthUser): DisputeRepresentation[] {
  return formatDisputeList(db, user);
}

export function getDisputeEvents(db: Database, user: AuthUser, disputeId: string): DisputeEvent[] {
  findVisibleDispute(db, user, disputeId);
  return formatEvents(db, disputeId);
}
