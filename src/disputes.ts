import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { AuthUser } from './auth.js';
import {
  assertCanAddEvidence,
  assertCanResolve,
  assertUserCanRaiseDispute,
  canUserAddEvidence,
  canUserViewDispute,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type DisputeStatus,
} from './domain.js';
import {
  computeEventHash,
  GENESIS_PREV_HASH,
  type EventPayload,
  buildCanonicalPayload,
} from './audit.js';

export interface UserSummary {
  id: string;
  displayName: string;
}

export interface EvidenceRepresentation {
  id: string;
  submittedBy: UserSummary;
  notes: string;
  createdAt: string;
}

export interface ResolutionRepresentation {
  note: string;
  by: UserSummary;
  at: string;
}

export interface DisputeRepresentation {
  id: string;
  orderReference: string;
  description: string;
  status: DisputeStatus;
  claimant: UserSummary;
  respondent: UserSummary;
  createdAt: string;
  evidence?: EvidenceRepresentation[];
  resolution: ResolutionRepresentation | null;
}

function appendEvent(
  db: Database,
  disputeId: string,
  type: 'DISPUTE_RAISED' | 'EVIDENCE_ADDED' | 'DISPUTE_RESOLVED',
  actorId: string,
  occurredAt: string,
  rawPayload: EventPayload
): void {
  const lastEvent = db
    .prepare('SELECT hash FROM events ORDER BY id DESC LIMIT 1')
    .get() as { hash: string } | undefined;

  const prevHash = lastEvent ? lastEvent.hash : GENESIS_PREV_HASH;

  const rowIdResult = db
    .prepare('SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM events')
    .get() as { nextId: number };
  const nextId = rowIdResult.nextId;

  const payload = buildCanonicalPayload(type, rawPayload);

  const hash = computeEventHash(prevHash, {
    id: nextId,
    disputeId,
    type,
    actorId,
    occurredAt,
    payload,
  });

  db.prepare(
    `INSERT INTO events (id, disputeId, type, actorId, payload, occurredAt, prevHash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(nextId, disputeId, type, actorId, JSON.stringify(payload), occurredAt, prevHash, hash);
}

function formatDispute(
  db: Database,
  dispute: any,
  includeEvidence: boolean
): DisputeRepresentation {
  const claimant = db
    .prepare('SELECT id, displayName FROM users WHERE id = ?')
    .get(dispute.claimantId) as UserSummary;

  const respondent = db
    .prepare('SELECT id, displayName FROM users WHERE id = ?')
    .get(dispute.respondentId) as UserSummary;

  let resolution: ResolutionRepresentation | null = null;
  if (dispute.status === 'RESOLVED' && dispute.resolvedById) {
    const resolver = db
      .prepare('SELECT id, displayName FROM users WHERE id = ?')
      .get(dispute.resolvedById) as UserSummary;
    resolution = {
      note: dispute.resolutionNote,
      by: resolver,
      at: dispute.resolvedAt,
    };
  }

  const result: DisputeRepresentation = {
    id: dispute.id,
    orderReference: dispute.orderReference,
    description: dispute.description,
    status: dispute.status as DisputeStatus,
    claimant,
    respondent,
    createdAt: dispute.createdAt,
    resolution,
  };

  if (includeEvidence) {
    const evidenceRows = db
      .prepare(
        `SELECT e.id, e.submittedById, e.notes, e.createdAt, u.displayName
         FROM evidence e
         JOIN users u ON e.submittedById = u.id
         WHERE e.disputeId = ?
         ORDER BY e.createdAt ASC`
      )
      .all(dispute.id) as any[];

    result.evidence = evidenceRows.map((row) => ({
      id: row.id,
      submittedBy: {
        id: row.submittedById,
        displayName: row.displayName,
      },
      notes: row.notes,
      createdAt: row.createdAt,
    }));
  }

  return result;
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

  const respondent = db
    .prepare('SELECT id, role FROM users WHERE id = ?')
    .get(input.respondentId) as { id: string; role: string } | undefined;

  if (!respondent || respondent.role !== 'partner') {
    throw new ValidationError('Respondent must be an existing partner user.');
  }

  const disputeId = randomUUID();
  const createdAt = new Date().toISOString();

  const insertDisputeTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO disputes (id, orderReference, description, status, claimantId, respondentId, createdAt)
       VALUES (?, ?, ?, 'OPEN', ?, ?, ?)`
    ).run(disputeId, input.orderReference, input.description, user.id, input.respondentId, createdAt);

    appendEvent(db, disputeId, 'DISPUTE_RAISED', user.id, createdAt, {
      orderReference: input.orderReference,
      description: input.description,
      respondentId: input.respondentId,
    });
  });

  insertDisputeTx();

  const created = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId);
  return formatDispute(db, created, true);
}

export function getDispute(
  db: Database,
  user: AuthUser,
  disputeId: string
): DisputeRepresentation {
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as any;
  if (!dispute) {
    throw new NotFoundError();
  }

  if (!canUserViewDispute(user, dispute)) {
    throw new NotFoundError();
  }

  return formatDispute(db, dispute, true);
}

export function listDisputes(
  db: Database,
  user: AuthUser,
  statusFilter?: string
): DisputeRepresentation[] {
  let query = 'SELECT * FROM disputes WHERE 1=1';
  const params: any[] = [];

  if (user.role === 'partner') {
    query += ' AND (claimantId = ? OR respondentId = ?)';
    params.push(user.id, user.id);
  }

  if (statusFilter) {
    query += ' AND status = ?';
    params.push(statusFilter);
  }

  query += ' ORDER BY createdAt DESC';

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map((row) => formatDispute(db, row, false));
}

export function addEvidence(
  db: Database,
  user: AuthUser,
  disputeId: string,
  input: { notes: string }
): DisputeRepresentation {
  if (user.role === 'arbiter') {
    throw new ForbiddenError('Arbiters cannot add evidence.');
  }

  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as any;
  if (!dispute) {
    throw new NotFoundError();
  }

  if (!canUserAddEvidence(user, dispute)) {
    throw new NotFoundError();
  }

  assertCanAddEvidence(dispute.status);

  const evidenceId = randomUUID();
  const createdAt = new Date().toISOString();

  const addEvidenceTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO evidence (id, disputeId, submittedById, notes, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(evidenceId, disputeId, user.id, input.notes, createdAt);

    appendEvent(db, disputeId, 'EVIDENCE_ADDED', user.id, createdAt, {
      evidenceId,
      notes: input.notes,
    });
  });

  addEvidenceTx();

  const updated = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId);
  return formatDispute(db, updated, true);
}

export function resolveDispute(
  db: Database,
  user: AuthUser,
  disputeId: string,
  input: { resolutionNote: string }
): DisputeRepresentation {
  if (user.role !== 'arbiter') {
    throw new ForbiddenError('Only arbiters can resolve disputes.');
  }

  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as any;
  if (!dispute) {
    throw new NotFoundError();
  }

  assertCanResolve(dispute.status);

  const resolvedAt = new Date().toISOString();

  const resolveTx = db.transaction(() => {
    db.prepare(
      `UPDATE disputes
       SET status = 'RESOLVED', resolutionNote = ?, resolvedById = ?, resolvedAt = ?
       WHERE id = ? AND status = 'OPEN'`
    ).run(input.resolutionNote, user.id, resolvedAt, disputeId);

    appendEvent(db, disputeId, 'DISPUTE_RESOLVED', user.id, resolvedAt, {
      resolutionNote: input.resolutionNote,
    });
  });

  resolveTx();

  const updated = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId);
  return formatDispute(db, updated, true);
}

export function getDisputeEvents(
  db: Database,
  user: AuthUser,
  disputeId: string
): any[] {
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as any;
  if (!dispute) {
    throw new NotFoundError();
  }

  if (!canUserViewDispute(user, dispute)) {
    throw new NotFoundError();
  }

  const events = db
    .prepare(
      `SELECT e.id, e.disputeId, e.type, e.actorId, e.payload, e.occurredAt, e.prevHash, e.hash, u.displayName
       FROM events e
       JOIN users u ON e.actorId = u.id
       WHERE e.disputeId = ?
       ORDER BY e.id ASC`
    )
    .all(disputeId) as any[];

  return events.map((ev) => ({
    id: ev.id,
    disputeId: ev.disputeId,
    type: ev.type,
    actor: {
      id: ev.actorId,
      displayName: ev.displayName,
    },
    payload: JSON.parse(ev.payload),
    occurredAt: ev.occurredAt,
    prevHash: ev.prevHash,
    hash: ev.hash,
  }));
}
