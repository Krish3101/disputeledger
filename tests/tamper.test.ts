import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createDb } from '../src/db.js';
import { raiseDispute, addEvidence, resolveDispute } from '../src/disputes.js';
import { verifyLedger } from '../src/ledger.js';
import { insertUsers, users } from './helpers.js';

// Each attack edits the database directly, the way someone with the file (but not LEDGER_KEY) could.
describe('tamper matrix', () => {
  let db: Database;
  let disputeId: string;

  type Row = { id: number; disputeId: string; type: string; actorId: string; payload: string; occurredAt: string; prevHash: string; hash: string };
  const getEvent = (id: number) => db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Row;
  const insertEvent = (id: number, e: Row) =>
    db
      .prepare(
        'INSERT INTO events (id, disputeId, type, actorId, payload, occurredAt, prevHash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, e.disputeId, e.type, e.actorId, e.payload, e.occurredAt, e.prevHash, e.hash);

  beforeEach(() => {
    db = createDb(':memory:');
    insertUsers(db);

    // #1 raised, #2 and #3 evidence, #4 resolution
    disputeId = raiseDispute(db, users.sam, {
      orderReference: 'PO-TEST',
      description: 'Initial description',
      respondentId: users.dana.id,
    }).id;
    addEvidence(db, users.sam, disputeId, { notes: 'Supplier photos' });
    addEvidence(db, users.dana, disputeId, { notes: 'Buyer inspection report' });
    resolveDispute(db, users.ari, disputeId, { resolutionNote: 'Carrier liable' });

    expect(verifyLedger(db)).toMatchObject({ ok: true, eventsChecked: 4 });
  });

  it('1. edit: an evidence note changed in the database', () => {
    db.prepare("UPDATE evidence SET notes = 'tampered note' WHERE notes = 'Supplier photos'").run();
    expect(verifyLedger(db)).toMatchObject({ ok: false, reason: 'ROW_MISMATCH', eventId: 2, disputeId });
  });

  it('2. swap: two events trade places', () => {
    const ev2 = getEvent(2);
    const ev3 = getEvent(3);
    db.prepare('DELETE FROM events WHERE id IN (2, 3)').run();
    insertEvent(2, ev3);
    insertEvent(3, ev2);
    expect(verifyLedger(db)).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 2 });
  });

  it('3. mid-delete: event #3 is deleted and reported as #3', () => {
    db.prepare('DELETE FROM events WHERE id = 3').run();
    const result = verifyLedger(db);
    expect(result).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 3 });
  });

  it('4. orphan row: evidence inserted with no ledger event', () => {
    db.prepare(
      'INSERT INTO evidence (id, disputeId, submittedById, notes, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).run('ev-orphan', disputeId, users.sam.id, 'unlogged backdoor note', new Date().toISOString());
    expect(verifyLedger(db)).toMatchObject({ ok: false, reason: 'ORPHAN_ROW', rowId: 'ev-orphan', disputeId });
  });

  it('5. rehash without the key: payload changed and a plain SHA-256 recomputed', () => {
    const ev2 = getEvent(2);
    const newPayload = JSON.stringify({ evidenceId: 'ev-tampered', notes: 'fake notes' });
    const fakeHash = createHash('sha256').update(ev2.prevHash + '\n' + newPayload).digest('hex');
    db.prepare('UPDATE events SET payload = ?, hash = ? WHERE id = 2').run(newPayload, fakeHash);
    expect(verifyLedger(db)).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 2 });
  });

});
