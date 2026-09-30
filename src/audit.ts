import { createHmac } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { countRows, findDispute, type EvidenceRow } from './db.js';

export const GENESIS_PREV_HASH = '0'.repeat(64);

export type CanonicalPayload = Record<string, unknown>;

export interface DisputeRaisedPayload {
  orderReference: string;
  description: string;
  respondentId: string;
}

export interface EvidenceAddedPayload {
  evidenceId: string;
  notes: string;
}

export interface DisputeResolvedPayload {
  resolutionNote: string;
}

export type EventPayload =
  | DisputeRaisedPayload
  | EvidenceAddedPayload
  | DisputeResolvedPayload;

export interface EventInput {
  id: number;
  disputeId: string;
  type: string;
  actorId: string;
  occurredAt: string;
  payload: EventPayload | CanonicalPayload | string;
}

export interface StoredEventRow {
  id: number;
  disputeId: string;
  type: string;
  actorId: string;
  payload: string;
  occurredAt: string;
  prevHash: string;
  hash: string;
}

export function buildCanonicalPayload(type: string, rawPayload: EventInput['payload']): CanonicalPayload {
  const parsed = (typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload) as CanonicalPayload;
  switch (type) {
    case 'DISPUTE_RAISED':
      return {
        orderReference: parsed.orderReference,
        description: parsed.description,
        respondentId: parsed.respondentId,
      };
    case 'EVIDENCE_ADDED':
      return {
        evidenceId: parsed.evidenceId,
        notes: parsed.notes,
      };
    case 'DISPUTE_RESOLVED':
      return {
        resolutionNote: parsed.resolutionNote,
      };
    default:
      return parsed;
  }
}

export function buildCanonicalEventString(event: EventInput): string {
  const payload = buildCanonicalPayload(event.type, event.payload);
  return JSON.stringify({
    id: event.id,
    disputeId: event.disputeId,
    type: event.type,
    actorId: event.actorId,
    occurredAt: event.occurredAt,
    payload,
  });
}

// The key lives outside the database, so someone who can edit the database file
// still can't recompute a valid chain after changing a row.
export function ledgerKey(): string {
  const key = process.env.LEDGER_KEY;
  if (!key) {
    throw new Error('LEDGER_KEY is not set. Run ./scripts/start.sh once, or add it to .env.');
  }
  return key;
}

export function computeEventHash(prevHash: string, event: EventInput): string {
  const canonical = buildCanonicalEventString(event);
  return createHmac('sha256', ledgerKey()).update(prevHash + '\n' + canonical).digest('hex');
}

export type VerifyChainResult =
  | { ok: true; eventsChecked: number }
  | { ok: false; firstBadEventId: number | null };

export function verifyChain(events: (StoredEventRow | (EventInput & { prevHash: string; hash: string }))[]): VerifyChainResult {
  let expectedPrevHash = GENESIS_PREV_HASH;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.prevHash !== expectedPrevHash) {
      return { ok: false, firstBadEventId: event.id };
    }

    const calculatedHash = computeEventHash(event.prevHash, event);
    if (event.hash !== calculatedHash) {
      return { ok: false, firstBadEventId: event.id };
    }

    expectedPrevHash = event.hash;
  }

  return { ok: true, eventsChecked: events.length };
}

export function verifyLedgerIntegrity(db: Database): VerifyChainResult {
  const events = db.prepare('SELECT * FROM events ORDER BY id ASC').all() as StoredEventRow[];

  const chainResult = verifyChain(events);
  if (!chainResult.ok) {
    return chainResult;
  }

  for (const event of events) {
    const payload = buildCanonicalPayload(event.type, event.payload);

    if (event.type === 'DISPUTE_RAISED') {
      const dispute = findDispute(db, event.disputeId);
      if (
        !dispute ||
        dispute.orderReference !== payload.orderReference ||
        dispute.description !== payload.description ||
        dispute.claimantId !== event.actorId ||
        dispute.respondentId !== payload.respondentId
      ) {
        return { ok: false, firstBadEventId: event.id };
      }
    } else if (event.type === 'EVIDENCE_ADDED') {
      const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(payload.evidenceId) as
        | EvidenceRow
        | undefined;
      if (
        !evidence ||
        evidence.disputeId !== event.disputeId ||
        evidence.submittedById !== event.actorId ||
        evidence.notes !== payload.notes
      ) {
        return { ok: false, firstBadEventId: event.id };
      }
    } else if (event.type === 'DISPUTE_RESOLVED') {
      const dispute = findDispute(db, event.disputeId);
      if (
        !dispute ||
        dispute.status !== 'RESOLVED' ||
        dispute.resolvedById !== event.actorId ||
        dispute.resolutionNote !== payload.resolutionNote
      ) {
        return { ok: false, firstBadEventId: event.id };
      }
    }
  }

  // A dispute, evidence note or ruling with no event was written outside the app. There
  // is no event to point at, so firstBadEventId is null.
  const disputesCount = countRows(db, 'SELECT COUNT(*) as c FROM disputes');
  const raisedEventsCount = events.filter((e) => e.type === 'DISPUTE_RAISED').length;
  if (disputesCount !== raisedEventsCount) {
    return { ok: false, firstBadEventId: null };
  }

  const evidenceCount = countRows(db, 'SELECT COUNT(*) as c FROM evidence');
  const evidenceEventsCount = events.filter((e) => e.type === 'EVIDENCE_ADDED').length;
  if (evidenceCount !== evidenceEventsCount) {
    return { ok: false, firstBadEventId: null };
  }

  const resolvedCount = countRows(db, "SELECT COUNT(*) as c FROM disputes WHERE status = 'RESOLVED'");
  const resolvedEventsCount = events.filter((e) => e.type === 'DISPUTE_RESOLVED').length;
  if (resolvedCount !== resolvedEventsCount) {
    return { ok: false, firstBadEventId: null };
  }

  return { ok: true, eventsChecked: events.length };
}
