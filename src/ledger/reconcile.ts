import type { Database } from 'better-sqlite3';
import { getLedgerKey } from '../config.js';
import { readLedgerId, type DisputeRow, type EvidenceRow } from '../db.js';
import { buildCanonicalPayload, verifyChain, type IntegrityResult, type StoredEventRow } from './chain.js';

// Replays the chain, then checks that every event matches its row and every row has its event.
export function verifyLedgerIntegrity(db: Database, key: string = getLedgerKey()): IntegrityResult {
  const findDispute = db.prepare('SELECT * FROM disputes WHERE id = ?');
  const findEvidence = db.prepare('SELECT * FROM evidence WHERE id = ?');

  // One read transaction, so a write in the middle can't make the check flaky
  return db.transaction((): IntegrityResult => {
    // A deleted ledger id gives a different genesis, so the chain fails at #1
    const ledgerId = readLedgerId(db) ?? '';
    const events = db.prepare('SELECT * FROM events ORDER BY id ASC').all() as StoredEventRow[];

    const chain = verifyChain(events, key, ledgerId);
    if (!chain.ok) {
      return chain;
    }
    const head = chain.head;

    for (const event of events) {
      const payload = buildCanonicalPayload(event.type, event.payload);
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
        'Ruling on dispute',
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
