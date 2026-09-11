import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';

export const GENESIS_PREV_HASH = '0'.repeat(64);

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
  payload: EventPayload | string;
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

export function buildCanonicalPayload(type: string, rawPayload: any): any {
  const parsed = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
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

export function computeSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function computeEventHash(prevHash: string, event: EventInput): string {
  const canonical = buildCanonicalEventString(event);
  return computeSha256(prevHash + '\n' + canonical);
}

export type VerifyChainResult =
  | { ok: true; eventsChecked: number }
  | { ok: false; firstBadEventId: number };

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
      const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(event.disputeId) as any;
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
      const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(payload.evidenceId) as any;
      if (
        !evidence ||
        evidence.disputeId !== event.disputeId ||
        evidence.submittedById !== event.actorId ||
        evidence.notes !== payload.notes
      ) {
        return { ok: false, firstBadEventId: event.id };
      }
    } else if (event.type === 'DISPUTE_RESOLVED') {
      const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(event.disputeId) as any;
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

  // Ensure no unlogged disputes or evidence exist
  const disputesCount = (db.prepare('SELECT COUNT(*) as c FROM disputes').get() as any).c;
  const raisedEventsCount = events.filter((e) => e.type === 'DISPUTE_RAISED').length;
  if (disputesCount !== raisedEventsCount) {
    return { ok: false, firstBadEventId: events.length > 0 ? events[0].id : 0 };
  }

  const evidenceCount = (db.prepare('SELECT COUNT(*) as c FROM evidence').get() as any).c;
  const evidenceEventsCount = events.filter((e) => e.type === 'EVIDENCE_ADDED').length;
  if (evidenceCount !== evidenceEventsCount) {
    return { ok: false, firstBadEventId: events.length > 0 ? events[0].id : 0 };
  }

  return { ok: true, eventsChecked: events.length };
}
