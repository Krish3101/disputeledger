import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Database } from 'better-sqlite3';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { raiseDispute, addEvidence, resolveDispute } from '../src/disputes.js';
import { verifyLedgerIntegrity } from '../src/ledger/reconcile.js';
import { computeEventHash, verifyChain, type StoredEventRow } from '../src/ledger/chain.js';
import { getLedgerKey } from '../src/config.js';
import { readLedgerId } from '../src/db.js';
import { insertUsers, login, users } from './helpers.js';

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

    // #1 raised, #2 and #3 evidence, #4 ruling
    disputeId = raiseDispute(db, users.sam, {
      orderReference: 'PO-TEST',
      description: 'Initial description',
      respondentId: users.dana.id,
    }).id;
    addEvidence(db, users.sam, disputeId, { notes: 'Supplier photos' });
    addEvidence(db, users.dana, disputeId, { notes: 'Buyer inspection report' });
    resolveDispute(db, users.ari, disputeId, { resolutionNote: 'Carrier liable' });

    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: true, eventsChecked: 4 });
  });

  it('1. edit: an evidence note changed in the database', () => {
    db.prepare("UPDATE evidence SET notes = 'tampered note' WHERE notes = 'Supplier photos'").run();
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'ROW_MISMATCH', eventId: 2, disputeId });
  });

  it('2. swap: two events trade places', () => {
    const ev2 = getEvent(2);
    const ev3 = getEvent(3);
    db.prepare('DELETE FROM events WHERE id IN (2, 3)').run();
    insertEvent(2, ev3);
    insertEvent(3, ev2);
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 2 });
  });

  it('3. mid-delete: event #3 is deleted and reported as #3', () => {
    db.prepare('DELETE FROM events WHERE id = 3').run();
    const result = verifyLedgerIntegrity(db);
    expect(result).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 3 });
  });

  it('4. orphan row: evidence inserted with no ledger event', () => {
    db.prepare(
      'INSERT INTO evidence (id, disputeId, submittedById, notes, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).run('ev-orphan', disputeId, users.sam.id, 'unlogged backdoor note', new Date().toISOString());
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'ORPHAN_ROW', rowId: 'ev-orphan', disputeId });
  });

  it('4b. orphan row: a dispute inserted with no ledger event', () => {
    db.prepare(
      `INSERT INTO disputes (id, orderReference, description, status, claimantId, respondentId, createdAt)
       VALUES ('d-forged', 'PO-X', 'forged', 'OPEN', 'u-sam', 'u-dana', '2026-01-01T00:00:00.000Z')`
    ).run();
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'ORPHAN_ROW', rowId: 'd-forged' });
  });

  it('5. rehash without the key: payload changed and a plain SHA-256 recomputed', () => {
    const ev2 = getEvent(2);
    const newPayload = JSON.stringify({ evidenceId: 'ev-tampered', notes: 'fake notes' });
    const fakeHash = createHash('sha256').update(ev2.prevHash + '\n' + newPayload).digest('hex');
    db.prepare('UPDATE events SET payload = ?, hash = ? WHERE id = 2').run(newPayload, fakeHash);
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 2 });
  });

  it('6. timestamp backdate: dispute createdAt moved to 2020', () => {
    db.prepare("UPDATE disputes SET createdAt = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(disputeId);
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'ROW_MISMATCH', eventId: 1 });
  });

  it('7. payload injection: an extra field added to a stored payload', () => {
    db.prepare("UPDATE events SET payload = json_set(payload, '$.injectedField', 'malicious') WHERE id = 1").run();
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'PAYLOAD_NOT_CANONICAL', eventId: 1 });
  });

  it('8. key reorder: same fields, different byte order', () => {
    const ev1 = getEvent(1);
    const p = JSON.parse(ev1.payload);
    const reordered = JSON.stringify({ respondentId: p.respondentId, description: p.description, orderReference: p.orderReference });
    db.prepare('UPDATE events SET payload = ? WHERE id = 1').run(reordered);
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'PAYLOAD_NOT_CANONICAL', eventId: 1 });
  });

  it('9. lone surrogate: rejected with 400 and the ledger stays verifiable', async () => {
    const app = createApp(db);
    const token = await login(app, 'supplier');
    const res = await request(app)
      .post(`/api/disputes/${disputeId}/evidence`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'bad \ud800 string' })
      .expect(400);
    expect(res.body.error.message).toContain('invalid Unicode');
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: true, eventsChecked: 4 });
  });

  it('10. tail truncation: deleting the newest event and its row is NOT detected (known limit)', () => {
    // Without an anchor held outside the server, a shorter valid chain looks like a real one
    db.prepare('DELETE FROM events WHERE id = 4').run();
    db.prepare(
      "UPDATE disputes SET status = 'OPEN', resolutionNote = NULL, resolvedById = NULL, resolvedAt = NULL WHERE id = ?"
    ).run(disputeId);
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: true, eventsChecked: 3 });
  });

  it('a deleted ledger id breaks the chain at #1', () => {
    db.prepare("DELETE FROM meta WHERE key = 'ledgerId'").run();
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 1 });
  });

  it('a ruling written without an event is an orphan', () => {
    const id = raiseDispute(db, users.sam, { orderReference: 'PO-2', description: 'x', respondentId: users.dana.id }).id;
    db.prepare(
      "UPDATE disputes SET status = 'RESOLVED', resolutionNote = 'forged', resolvedById = 'u-ari', resolvedAt = ? WHERE id = ?"
    ).run(new Date().toISOString(), id);
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'ORPHAN_ROW', rowId: id });
  });

  // A keyholder can re-sign events, so only the date order is left to give the rewrite away
  function rewriteSigned(id: number, occurredAt: string): void {
    const key = getLedgerKey();
    const ledgerId = readLedgerId(db) ?? '';
    let prevHash = getEvent(id - 1).hash;
    for (let n = id; n <= 4; n++) {
      const e = getEvent(n);
      const at = n === id ? occurredAt : e.occurredAt;
      const hash = computeEventHash(prevHash, { ...e, occurredAt: at, payload: e.payload }, key, ledgerId);
      db.prepare('UPDATE events SET occurredAt = ?, prevHash = ?, hash = ? WHERE id = ?').run(at, prevHash, hash, n);
      prevHash = hash;
    }
  }

  it('a re-signed event dated before the one ahead of it is a TIMESTAMP_REGRESSION', () => {
    rewriteSigned(3, '2020-01-01T00:00:00.000Z');
    expect(verifyLedgerIntegrity(db)).toMatchObject({ ok: false, reason: 'TIMESTAMP_REGRESSION', eventId: 3, disputeId });
  });

  // Checked on the chain alone: the full check would also flag the live row whose time no longer matches
  it('equal timestamps are allowed', () => {
    rewriteSigned(3, getEvent(2).occurredAt);
    const events = db.prepare('SELECT * FROM events ORDER BY id ASC').all() as StoredEventRow[];
    expect(verifyChain(events, getLedgerKey(), readLedgerId(db) ?? '')).toMatchObject({ ok: true, eventsChecked: 4 });
  });
});
