import { createHmac } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getLedgerKey } from './config.js';
import type { DisputeRow, EvidenceRow } from './db.js';

// What a ledger event is, how it is hashed, and how the chain is checked against the live rows.

export type EventType = 'DISPUTE_RAISED' | 'EVIDENCE_ADDED' | 'DISPUTE_RESOLVED';

export interface EventInput {
  id: number;
  disputeId: string;
  type: string;
  actorId: string;
  occurredAt: string;
  payload: string;
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

export type VerifyReason = 'CHAIN_BROKEN' | 'ROW_MISMATCH' | 'ORPHAN_ROW';

export interface Head {
  seq: number;
  hash: string;
}

export type VerifyResult =
  | { ok: true; eventsChecked: number; head: Head }
  | {
      ok: false;
      reason: VerifyReason;
      eventId?: number;
      rowId?: string;
      disputeId?: string;
      detail: string;
      head: Head;
    };

// The prevHash of event #1
export const FIRST_PREV_HASH = '0'.repeat(64);

export function computeEventHash(prevHash: string, event: EventInput, key: string): string {
  // The stored payload string itself is hashed, so any change to its bytes breaks the chain
  const fields = JSON.stringify({
    id: event.id,
    type: event.type,
    disputeId: event.disputeId,
    actorId: event.actorId,
    occurredAt: event.occurredAt,
    payload: event.payload,
  });
  return createHmac('sha256', key).update(`${prevHash}\n${fields}`).digest('hex');
}

// Adds the next event to the chain. Call it inside the transaction that writes the row.
export function appendEvent(
  db: Database,
  disputeId: string,
  type: EventType,
  actorId: string,
  occurredAt: string,
  rawPayload: Record<string, string>
): void {
  const last = db.prepare('SELECT id, hash FROM events ORDER BY id DESC LIMIT 1').get() as
    | { id: number; hash: string }
    | undefined;
  const prevHash = last ? last.hash : FIRST_PREV_HASH;
  const id = last ? last.id + 1 : 1;

  const payload = JSON.stringify(rawPayload);
  const hash = computeEventHash(prevHash, { id, disputeId, type, actorId, occurredAt, payload }, getLedgerKey());

  db.prepare(
    `INSERT INTO events (id, disputeId, type, actorId, payload, occurredAt, prevHash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, disputeId, type, actorId, payload, occurredAt, prevHash, hash);
}

export function verifyChain(events: StoredEventRow[], key: string): VerifyResult {
  const last = events[events.length - 1];
  const head: Head = last ? { seq: last.id, hash: last.hash } : { seq: 0, hash: FIRST_PREV_HASH };

  let expectedPrevHash = FIRST_PREV_HASH;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const fail = (reason: VerifyReason, detail: string): VerifyResult => ({
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

    if (event.prevHash !== expectedPrevHash) {
      return fail('CHAIN_BROKEN', `Event #${event.id} does not point at the event before it`);
    }
    if (event.hash !== computeEventHash(event.prevHash, event, key)) {
      return fail('CHAIN_BROKEN', `Event #${event.id} hash does not match its contents`);
    }

    expectedPrevHash = event.hash;
  }

  return { ok: true, eventsChecked: events.length, head };
}

// Replays the chain, then checks that every event matches its row and every row has its event.
export function verifyLedger(db: Database, key: string = getLedgerKey()): VerifyResult {
  const findDispute = db.prepare('SELECT * FROM disputes WHERE id = ?');
  const findEvidence = db.prepare('SELECT * FROM evidence WHERE id = ?');

  // One read transaction, so a write in the middle can't make the check flaky
  return db.transaction((): VerifyResult => {
    const events = db.prepare('SELECT * FROM events ORDER BY id ASC').all() as StoredEventRow[];

    const chain = verifyChain(events, key);
    if (!chain.ok) {
      return chain;
    }
    const head = chain.head;

    for (const event of events) {
      // The chain check passed, so this is the exact string the app wrote
      const payload = JSON.parse(event.payload) as Record<string, string>;
      let matches = false;

      if (event.type === 'DISPUTE_RAISED') {
        const d = findDispute.get(event.disputeId) as DisputeRow | undefined;
        matches =
          !!d &&
          d.orderReference === payload.orderReference &&
          d.description === payload.description &&
          d.claimantId === event.actorId &&
          d.respondentId === payload.respondentId &&
          d.createdAt === event.occurredAt;
      } else if (event.type === 'EVIDENCE_ADDED') {
        const e = findEvidence.get(payload.evidenceId) as EvidenceRow | undefined;
        matches =
          !!e &&
          e.disputeId === event.disputeId &&
          e.submittedById === event.actorId &&
          e.notes === payload.notes &&
          e.createdAt === event.occurredAt;
      } else if (event.type === 'DISPUTE_RESOLVED') {
        const d = findDispute.get(event.disputeId) as DisputeRow | undefined;
        matches =
          !!d &&
          d.status === 'RESOLVED' &&
          d.resolvedById === event.actorId &&
          d.resolutionNote === payload.resolutionNote &&
          d.resolvedAt === event.occurredAt;
      }

      if (!matches) {
        return {
          ok: false,
          reason: 'ROW_MISMATCH',
          eventId: event.id,
          disputeId: event.disputeId,
          detail: `The row for event #${event.id} (${event.type}) no longer matches it`,
          head,
        };
      }
    }

    // Rows that were written straight into the database, with no event
    const orphanChecks: [string, string][] = [
      [
        `SELECT d.id AS rowId, d.id AS disputeId FROM disputes d WHERE NOT EXISTS
           (SELECT 1 FROM events v WHERE v.type = 'DISPUTE_RAISED' AND v.disputeId = d.id)`,
        'Dispute',
      ],
      [
        `SELECT e.id AS rowId, e.disputeId FROM evidence e WHERE NOT EXISTS
           (SELECT 1 FROM events v WHERE v.type = 'EVIDENCE_ADDED' AND json_extract(v.payload, '$.evidenceId') = e.id)`,
        'Evidence',
      ],
      [
        `SELECT d.id AS rowId, d.id AS disputeId FROM disputes d WHERE d.status = 'RESOLVED' AND NOT EXISTS
           (SELECT 1 FROM events v WHERE v.type = 'DISPUTE_RESOLVED' AND v.disputeId = d.id)`,
        'Resolution of dispute',
      ],
    ];
    for (const [sql, label] of orphanChecks) {
      const orphan = db.prepare(`${sql} LIMIT 1`).get() as { rowId: string; disputeId: string } | undefined;
      if (orphan) {
        return {
          ok: false,
          reason: 'ORPHAN_ROW',
          rowId: orphan.rowId,
          disputeId: orphan.disputeId,
          detail: `${label} ${orphan.rowId} has no ledger event`,
          head,
        };
      }
    }

    return chain;
  })();
}
