import { createHash, createHmac } from 'node:crypto';

// What a ledger event is, how it is hashed, and how a list of events is checked.

export type EventType = 'DISPUTE_RAISED' | 'EVIDENCE_ADDED' | 'DISPUTE_RESOLVED';

export type CanonicalPayload = Record<string, string>;

export interface EventInput {
  id: number;
  disputeId: string;
  type: string;
  actorId: string;
  occurredAt: string;
  payload: unknown;
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

export type IntegrityReason = 'CHAIN_BROKEN' | 'PAYLOAD_NOT_CANONICAL' | 'ROW_MISMATCH' | 'ORPHAN_ROW' | 'TIMESTAMP_REGRESSION';

export interface Head {
  seq: number;
  hash: string;
}

export type IntegrityResult =
  | { ok: true; eventsChecked: number; head: Head }
  | {
      ok: false;
      reason: IntegrityReason;
      eventId?: number;
      rowId?: string;
      disputeId?: string;
      detail: string;
      head: Head;
    };

// Only the known fields of each event type are kept, in a fixed order.
export function buildCanonicalPayload(type: string, rawPayload: unknown): CanonicalPayload {
  const p = (typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload) as Record<string, unknown>;
  if (!p || typeof p !== 'object') {
    throw new Error(`Invalid payload for event type ${type}`);
  }

  const pick = (fields: string[]): CanonicalPayload => {
    const out: CanonicalPayload = {};
    for (const f of fields) {
      if (typeof p[f] !== 'string') {
        throw new Error(`${type} payload missing required fields`);
      }
      out[f] = p[f] as string;
    }
    return out;
  };

  switch (type) {
    case 'DISPUTE_RAISED':
      return pick(['orderReference', 'description', 'respondentId']);
    case 'EVIDENCE_ADDED':
      return pick(['evidenceId', 'notes']);
    case 'DISPUTE_RESOLVED':
      return pick(['resolutionNote']);
    default:
      throw new Error(`Unknown event type: ${type}`);
  }
}

export function canonicalJson(type: string, rawPayload: unknown): string {
  return JSON.stringify(buildCanonicalPayload(type, rawPayload));
}

export function keyIdFor(key: string): string {
  return createHmac('sha256', key).update('dl.keyid').digest('hex').slice(0, 8);
}

export function buildCanonicalEventString(event: EventInput, ledgerId: string, keyId: string): string {
  return JSON.stringify({
    v: 1,
    ledger: ledgerId,
    id: event.id,
    type: event.type,
    disputeId: event.disputeId,
    actorId: event.actorId,
    occurredAt: event.occurredAt,
    keyId,
    payload: buildCanonicalPayload(event.type, event.payload),
  });
}

export function getGenesisHash(ledgerId: string): string {
  return createHash('sha256').update('dl.genesis.v1\n' + ledgerId).digest('hex');
}

export function computeEventHash(prevHash: string, event: EventInput, key: string, ledgerId: string): string {
  const canonical = buildCanonicalEventString(event, ledgerId, keyIdFor(key));
  return createHmac('sha256', key).update(`dl.event.v1\n${prevHash}\n${canonical}`).digest('hex');
}

export function verifyChain(events: StoredEventRow[], key: string, ledgerId: string): IntegrityResult {
  const genesis = getGenesisHash(ledgerId);
  const last = events[events.length - 1];
  const head: Head = last ? { seq: last.id, hash: last.hash } : { seq: 0, hash: genesis };

  let expectedPrevHash = genesis;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const fail = (reason: IntegrityReason, detail: string): IntegrityResult => ({
      ok: false,
      reason,
      eventId: event.id,
      disputeId: event.disputeId,
      detail,
      head,
    });

    // Ids have no gaps, so a missing id is the deleted event itself (no disputeId: it is gone)
    if (event.id !== i + 1) {
      return { ok: false, reason: 'CHAIN_BROKEN', eventId: i + 1, detail: `Event #${i + 1} is missing`, head };
    }

    // The stored bytes must be exactly the canonical form, so no extra fields can hide in them
    let expected: string;
    try {
      expected = canonicalJson(event.type, event.payload);
    } catch (err: unknown) {
      return fail('PAYLOAD_NOT_CANONICAL', (err as Error).message);
    }
    if (event.payload !== expected) {
      return fail('PAYLOAD_NOT_CANONICAL', 'Stored payload is not in canonical form');
    }

    if (event.prevHash !== expectedPrevHash) {
      return fail('CHAIN_BROKEN', `Event #${event.id} does not point at the event before it`);
    }
    if (event.hash !== computeEventHash(event.prevHash, event, key, ledgerId)) {
      return fail('CHAIN_BROKEN', `Event #${event.id} hash does not match its contents`);
    }

    // Timestamps are server-generated in write order, so equal is fine but going back is not
    if (i > 0 && event.occurredAt < events[i - 1].occurredAt) {
      return fail('TIMESTAMP_REGRESSION', `Event #${event.id} is dated before the event ahead of it`);
    }
    expectedPrevHash = event.hash;
  }

  return { ok: true, eventsChecked: events.length, head };
}
