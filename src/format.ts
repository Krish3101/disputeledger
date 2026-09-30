import type { Database } from 'better-sqlite3';
import type { DisputeStatus } from './rules.js';
import type { StoredEventRow } from './ledger.js';

// The JSON shapes the API returns, and the queries that build them.

export interface UserSummary {
  id: string;
  displayName: string;
}

export interface EvidenceResponse {
  id: string;
  submittedBy: UserSummary;
  notes: string;
  createdAt: string;
}

export interface ResolutionResponse {
  note: string;
  by: UserSummary;
  at: string;
}

export interface DisputeResponse {
  id: string;
  orderReference: string;
  description: string;
  status: DisputeStatus;
  claimant: UserSummary;
  respondent: UserSummary;
  createdAt: string;
  evidence?: EvidenceResponse[];
  resolution: ResolutionResponse | null;
}

export interface DisputeEvent {
  id: number;
  disputeId: string;
  type: string;
  actor: UserSummary;
  payload: unknown;
  occurredAt: string;
  prevHash: string;
  hash: string;
}

interface JoinedDisputeRow {
  id: string;
  orderReference: string;
  description: string;
  status: DisputeStatus;
  createdAt: string;
  claimantId: string;
  claimantName: string;
  respondentId: string;
  respondentName: string;
  resolutionNote: string | null;
  resolvedById: string | null;
  resolverName: string | null;
  resolvedAt: string | null;
}

const DISPUTE_SELECT = `
  SELECT
    d.id, d.orderReference, d.description, d.status, d.createdAt,
    d.claimantId, c.displayName AS claimantName,
    d.respondentId, r.displayName AS respondentName,
    d.resolutionNote, d.resolvedById, res.displayName AS resolverName, d.resolvedAt
  FROM disputes d
  JOIN users c ON d.claimantId = c.id
  JOIN users r ON d.respondentId = r.id
  LEFT JOIN users res ON d.resolvedById = res.id`;

function toResponse(row: JoinedDisputeRow): DisputeResponse {
  return {
    id: row.id,
    orderReference: row.orderReference,
    description: row.description,
    status: row.status,
    claimant: { id: row.claimantId, displayName: row.claimantName },
    respondent: { id: row.respondentId, displayName: row.respondentName },
    createdAt: row.createdAt,
    resolution:
      row.status === 'RESOLVED' && row.resolvedById
        ? {
            note: row.resolutionNote as string,
            by: { id: row.resolvedById, displayName: row.resolverName as string },
            at: row.resolvedAt as string,
          }
        : null,
  };
}

export function formatDispute(db: Database, disputeId: string): DisputeResponse {
  const row = db.prepare(`${DISPUTE_SELECT} WHERE d.id = ?`).get(disputeId) as JoinedDisputeRow;
  const evidence = db
    .prepare(
      `SELECT e.id, e.submittedById, e.notes, e.createdAt, u.displayName
       FROM evidence e
       JOIN users u ON e.submittedById = u.id
       WHERE e.disputeId = ?
       ORDER BY e.createdAt ASC`
    )
    .all(disputeId) as { id: string; submittedById: string; notes: string; createdAt: string; displayName: string }[];

  return {
    ...toResponse(row),
    evidence: evidence.map((e) => ({
      id: e.id,
      submittedBy: { id: e.submittedById, displayName: e.displayName },
      notes: e.notes,
      createdAt: e.createdAt,
    })),
  };
}

// Partners only see disputes they are a party to; the arbiter sees all of them.
export function formatDisputeList(db: Database, user: { id: string; role: string }): DisputeResponse[] {
  const rows =
    user.role === 'partner'
      ? db
          .prepare(`${DISPUTE_SELECT} WHERE d.claimantId = ? OR d.respondentId = ? ORDER BY d.createdAt DESC`)
          .all(user.id, user.id)
      : db.prepare(`${DISPUTE_SELECT} ORDER BY d.createdAt DESC`).all();
  return (rows as JoinedDisputeRow[]).map(toResponse);
}

export function formatEvents(db: Database, disputeId: string): DisputeEvent[] {
  const rows = db
    .prepare(
      `SELECT e.*, u.displayName
       FROM events e
       JOIN users u ON e.actorId = u.id
       WHERE e.disputeId = ?
       ORDER BY e.id ASC`
    )
    .all(disputeId) as (StoredEventRow & { displayName: string })[];

  // A tampered payload may not even be JSON; show it as stored so the arbiter can still see it
  const parse = (payload: string): unknown => {
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  };

  return rows.map((ev) => ({
    id: ev.id,
    disputeId: ev.disputeId,
    type: ev.type,
    actor: { id: ev.actorId, displayName: ev.displayName },
    payload: parse(ev.payload),
    occurredAt: ev.occurredAt,
    prevHash: ev.prevHash,
    hash: ev.hash,
  }));
}
