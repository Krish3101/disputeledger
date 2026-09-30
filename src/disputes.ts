import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { AuthUser } from './auth.js';
import { findDispute } from './db.js';
import { AppError, canAddEvidence, canResolve, canView } from './rules.js';
import {
  formatDispute,
  formatDisputeList,
  formatEvents,
  type DisputeEvent,
  type DisputeResponse,
} from './format.js';
import { appendEvent } from './ledger.js';

// Every write below runs in one transaction: the checks, the row and its ledger event
// commit together or not at all.

export function raiseDispute(
  db: Database,
  user: AuthUser,
  input: { orderReference: string; description: string; respondentId: string }
): DisputeResponse {
  if (user.role !== 'partner') {
    throw new AppError(403, 'FORBIDDEN', 'Only partners may raise a dispute.');
  }
  if (input.respondentId === user.id) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Respondent cannot be the claimant.');
  }

  const disputeId = randomUUID();

  db.transaction(() => {
    const createdAt = new Date().toISOString();
    const respondent = db.prepare('SELECT role FROM users WHERE id = ?').get(input.respondentId) as
      | { role: string }
      | undefined;
    if (!respondent || respondent.role !== 'partner') {
      throw new AppError(400, 'VALIDATION_FAILED', 'Respondent must be an existing partner user.');
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
  })();

  return formatDispute(db, disputeId);
}

export function addEvidence(
  db: Database,
  user: AuthUser,
  disputeId: string,
  input: { notes: string }
): DisputeResponse {
  const evidenceId = randomUUID();

  db.transaction(() => {
    const createdAt = new Date().toISOString();
    const dispute = findDispute(db, disputeId);
    if (!dispute) {
      throw new AppError(404, 'NOT_FOUND', 'Dispute not found.');
    }
    if (!canAddEvidence(user, dispute)) {
      if (canView(user, dispute)) {
        throw new AppError(403, 'FORBIDDEN', 'Only the two parties can add evidence.');
      }
      throw new AppError(404, 'NOT_FOUND', 'Dispute not found.');
    }
    if (dispute.status !== 'OPEN') {
      throw new AppError(409, 'DISPUTE_NOT_OPEN', 'Evidence cannot be added to a resolved dispute.');
    }

    db.prepare(
      `INSERT INTO evidence (id, disputeId, submittedById, notes, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(evidenceId, disputeId, user.id, input.notes, createdAt);

    appendEvent(db, disputeId, 'EVIDENCE_ADDED', user.id, createdAt, { evidenceId, notes: input.notes });
  })();

  return formatDispute(db, disputeId);
}

export function resolveDispute(
  db: Database,
  user: AuthUser,
  disputeId: string,
  input: { resolutionNote: string }
): DisputeResponse {
  if (!canResolve(user)) {
    throw new AppError(403, 'FORBIDDEN', 'Only an arbiter can resolve a dispute.');
  }
  db.transaction(() => {
    const resolvedAt = new Date().toISOString();
    const dispute = findDispute(db, disputeId);
    if (!dispute) {
      throw new AppError(404, 'NOT_FOUND', 'Dispute not found.');
    }
    if (dispute.status !== 'OPEN') {
      throw new AppError(409, 'DISPUTE_NOT_OPEN', 'Dispute is already resolved.');
    }

    db.prepare(
      `UPDATE disputes SET status = 'RESOLVED', resolutionNote = ?, resolvedById = ?, resolvedAt = ? WHERE id = ?`
    ).run(input.resolutionNote, user.id, resolvedAt, disputeId);

    appendEvent(db, disputeId, 'DISPUTE_RESOLVED', user.id, resolvedAt, { resolutionNote: input.resolutionNote });
  })();

  return formatDispute(db, disputeId);
}

function findVisibleDispute(db: Database, user: AuthUser, disputeId: string) {
  const dispute = findDispute(db, disputeId);
  // A dispute the user can't see looks the same as one that doesn't exist
  if (!dispute || !canView(user, dispute)) {
    throw new AppError(404, 'NOT_FOUND', 'Dispute not found.');
  }
  return dispute;
}

export function getDispute(db: Database, user: AuthUser, disputeId: string): DisputeResponse {
  findVisibleDispute(db, user, disputeId);
  return formatDispute(db, disputeId);
}

export function listDisputes(db: Database, user: AuthUser): DisputeResponse[] {
  return formatDisputeList(db, user);
}

export function getDisputeEvents(db: Database, user: AuthUser, disputeId: string): DisputeEvent[] {
  findVisibleDispute(db, user, disputeId);
  return formatEvents(db, disputeId);
}
