import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Database } from 'better-sqlite3';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { addEvidence, raiseDispute, resolveDispute } from '../src/disputes.js';
import { verifyLedgerIntegrity } from '../src/ledger/reconcile.js';
import { insertUsers, login, tmpDbPath, users } from './helpers.js';

describe('disputes API', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDb(':memory:');
    app = createApp(db);
    insertUsers(db);
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function raise(token: string, orderReference = 'PO-8834'): Promise<string> {
    const res = await request(app)
      .post('/api/disputes')
      .set(auth(token))
      .send({ orderReference, description: '5 of 40 pallets arrived water-damaged', respondentId: 'u-dana' })
      .expect(201);
    return res.body.id;
  }

  it('full lifecycle: raise, evidence from both sides, resolve, read back, chained events', async () => {
    const supplier = await login(app, 'supplier');
    const buyer = await login(app, 'buyer');
    const arbiter = await login(app, 'arbiter');

    const raised = await request(app)
      .post('/api/disputes')
      .set(auth(supplier))
      .send({ orderReference: 'PO-8834', description: 'water damage', respondentId: 'u-dana' })
      .expect(201);
    const id = raised.body.id;
    expect(raised.body).toMatchObject({ status: 'OPEN', claimant: { id: 'u-sam' }, respondent: { id: 'u-dana' }, resolution: null });

    const ev1 = await request(app).post(`/api/disputes/${id}/evidence`).set(auth(supplier)).send({ notes: 'POD photos' }).expect(201);
    expect(ev1.body.evidence).toHaveLength(1);
    const ev2 = await request(app).post(`/api/disputes/${id}/evidence`).set(auth(buyer)).send({ notes: 'Dock report' }).expect(201);
    expect(ev2.body.evidence[1].submittedBy.id).toBe('u-dana');

    const resolved = await request(app)
      .post(`/api/disputes/${id}/resolution`)
      .set(auth(arbiter))
      .send({ resolutionNote: 'Carrier liable under clause 4.' })
      .expect(200);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolution.by.id).toBe('u-ari');

    const read = await request(app).get(`/api/disputes/${id}`).set(auth(supplier)).expect(200);
    expect(read.body.evidence).toHaveLength(2);

    const events = await request(app).get(`/api/disputes/${id}/events`).set(auth(supplier)).expect(200);
    const items = events.body.items;
    expect(items.map((e: { type: string }) => e.type)).toEqual([
      'DISPUTE_RAISED',
      'EVIDENCE_ADDED',
      'EVIDENCE_ADDED',
      'DISPUTE_RESOLVED',
    ]);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].prevHash).toBe(items[i - 1].hash);
    }
  });

  it('enforces partner and arbiter boundaries', async () => {
    const supplier = await login(app, 'supplier');
    const buyer = await login(app, 'buyer');
    const carrier = await login(app, 'carrier');
    const arbiter = await login(app, 'arbiter');

    await request(app)
      .post('/api/disputes')
      .set(auth(arbiter))
      .send({ orderReference: 'PO-9999', description: 'x', respondentId: 'u-dana' })
      .expect(403);
    const id = await raise(supplier);

    await request(app).post(`/api/disputes/${id}/evidence`).set(auth(arbiter)).send({ notes: 'n' }).expect(403);
    await request(app).post(`/api/disputes/${id}/resolution`).set(auth(supplier)).send({ resolutionNote: 'n' }).expect(403);
    // An uninvolved partner never learns the dispute exists
    await request(app).get(`/api/disputes/${id}`).set(auth(carrier)).expect(404);
    await request(app).get(`/api/disputes/${id}/events`).set(auth(carrier)).expect(404);
    await request(app).post(`/api/disputes/${id}/evidence`).set(auth(carrier)).send({ notes: 'n' }).expect(404);
    await request(app).post(`/api/disputes/${id}/evidence`).set(auth(buyer)).send({ notes: 'n' }).expect(201);

    const carrierList = await request(app).get('/api/disputes').set(auth(carrier)).expect(200);
    expect(carrierList.body.items).toHaveLength(0);
    const arbiterList = await request(app).get('/api/disputes').set(auth(arbiter)).expect(200);
    expect(arbiterList.body.items).toHaveLength(1);
  });

  it('a resolved dispute takes no more evidence or rulings (409)', async () => {
    const supplier = await login(app, 'supplier');
    const arbiter = await login(app, 'arbiter');
    const id = await raise(supplier);
    await request(app).post(`/api/disputes/${id}/resolution`).set(auth(arbiter)).send({ resolutionNote: 'Settled.' }).expect(200);

    const ev = await request(app).post(`/api/disputes/${id}/evidence`).set(auth(supplier)).send({ notes: 'late' }).expect(409);
    expect(ev.body.error.code).toBe('DISPUTE_NOT_OPEN');
    const again = await request(app).post(`/api/disputes/${id}/resolution`).set(auth(arbiter)).send({ resolutionNote: '2nd' }).expect(409);
    expect(again.body.error.code).toBe('DISPUTE_NOT_OPEN');
  });

  it('ignores client-supplied claimantId, createdAt and status', async () => {
    const supplier = await login(app, 'supplier');
    const res = await request(app)
      .post('/api/disputes')
      .set(auth(supplier))
      .send({
        orderReference: 'PO-ATTRIB',
        description: 'attribution test',
        respondentId: 'u-dana',
        claimantId: 'u-hacked',
        createdAt: '1990-01-01T00:00:00.000Z',
        status: 'RESOLVED',
      })
      .expect(201);
    expect(res.body.claimant.id).toBe('u-sam');
    expect(res.body.status).toBe('OPEN');
    expect(res.body.createdAt).not.toBe('1990-01-01T00:00:00.000Z');
  });

  it('validates the order reference, text length and respondent', async () => {
    const supplier = await login(app, 'supplier');
    const bad = [
      { orderReference: 'BAD REF #$%@', description: 'valid', respondentId: 'u-dana' },
      { orderReference: 'PO-VALID', description: '   ', respondentId: 'u-dana' },
      { orderReference: 'PO-VALID', description: 'x'.repeat(2001), respondentId: 'u-dana' },
      { orderReference: 'PO-VALID', description: 'valid', respondentId: 'u-sam' },
      { orderReference: 'PO-VALID', description: 'valid', respondentId: 'u-ghost' },
      { orderReference: 'PO-VALID', description: 'valid', respondentId: 'u-ari' },
    ];
    for (const body of bad) {
      await request(app).post('/api/disputes').set(auth(supplier)).send(body).expect(400);
    }
    expect((db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c).toBe(0);
  });

  describe('integrity endpoint', () => {
    it('is arbiter-only: supplier 403, arbiter 200', async () => {
      const supplier = await login(app, 'supplier');
      const arbiter = await login(app, 'arbiter');
      await raise(supplier);

      const denied = await request(app).get('/api/integrity').set(auth(supplier)).expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
      const ok = await request(app).get('/api/integrity').set(auth(arbiter)).expect(200);
      expect(ok.body).toMatchObject({ ok: true, eventsChecked: 1, head: { seq: 1 } });
    });

    it('names the event and dispute after a raw UPDATE, and recovers when it is undone', async () => {
      const supplier = await login(app, 'supplier');
      const arbiter = await login(app, 'arbiter');
      const id = await raise(supplier);
      await request(app).post(`/api/disputes/${id}/evidence`).set(auth(supplier)).send({ notes: 'Authentic photos' }).expect(201);

      db.prepare("UPDATE evidence SET notes = 'never happened'").run();
      const bad = await request(app).get('/api/integrity').set(auth(arbiter)).expect(200);
      expect(bad.body).toMatchObject({ ok: false, reason: 'ROW_MISMATCH', eventId: 2, disputeId: id });
      expect(bad.body.head.seq).toBe(2);

      db.prepare("UPDATE evidence SET notes = 'Authentic photos'").run();
      const fixed = await request(app).get('/api/integrity').set(auth(arbiter)).expect(200);
      expect(fixed.body.ok).toBe(true);
    });

    it('reports a deleted event #3 as #3', async () => {
      const supplier = await login(app, 'supplier');
      const arbiter = await login(app, 'arbiter');
      const id = await raise(supplier);
      for (const notes of ['one', 'two', 'three']) {
        await request(app).post(`/api/disputes/${id}/evidence`).set(auth(supplier)).send({ notes }).expect(201);
      }
      db.prepare('DELETE FROM events WHERE id = 3').run();
      const res = await request(app).get('/api/integrity').set(auth(arbiter)).expect(200);
      expect(res.body).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 3 });
    });

    it('returns the rowId of forged evidence', async () => {
      const supplier = await login(app, 'supplier');
      const arbiter = await login(app, 'arbiter');
      const id = await raise(supplier);
      db.prepare(
        'INSERT INTO evidence (id, disputeId, submittedById, notes, createdAt) VALUES (?, ?, ?, ?, ?)'
      ).run('ev-forged', id, 'u-sam', 'added by hand', new Date().toISOString());
      const res = await request(app).get('/api/integrity').set(auth(arbiter)).expect(200);
      expect(res.body).toMatchObject({ ok: false, reason: 'ORPHAN_ROW', rowId: 'ev-forged', disputeId: id });
    });
  });

  it('race: two connections resolve the same dispute, one gets 409 and only one event is written', async () => {
    const path = tmpDbPath();
    const dbA = createDb(path);
    insertUsers(dbA);
    const dbB = createDb(path);
    const appA = createApp(dbA);
    const appB = createApp(dbB);

    const supplier = await login(appA, 'supplier');
    const res = await request(appA)
      .post('/api/disputes')
      .set(auth(supplier))
      .send({ orderReference: 'PO-RACE', description: 'race', respondentId: 'u-dana' })
      .expect(201);
    const id = res.body.id;
    const arbiterA = await login(appA, 'arbiter');
    const arbiterB = await login(appB, 'arbiter');

    const [r1, r2] = await Promise.all([
      request(appA).post(`/api/disputes/${id}/resolution`).set(auth(arbiterA)).send({ resolutionNote: 'A rules' }),
      request(appB).post(`/api/disputes/${id}/resolution`).set(auth(arbiterB)).send({ resolutionNote: 'B rules' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);

    const resolvedEvents = dbA.prepare("SELECT COUNT(*) AS c FROM events WHERE type = 'DISPUTE_RESOLVED'").get() as { c: number };
    expect(resolvedEvents.c).toBe(1);
    const integrity = await request(appB).get('/api/integrity').set(auth(arbiterB)).expect(200);
    expect(integrity.body.ok).toBe(true);
    dbA.close();
    dbB.close();
  });
});

describe('a clock that steps backwards', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps event times non-decreasing and the ledger verifiable', () => {
    const db = createDb(':memory:');
    insertUsers(db);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    const dispute = raiseDispute(db, users.sam, {
      orderReference: 'PO-1',
      description: 'Damaged pallets',
      respondentId: users.dana.id,
    });

    vi.setSystemTime(new Date('2026-03-01T11:59:00.000Z'));
    addEvidence(db, users.sam, dispute.id, { notes: 'Photos' });

    vi.setSystemTime(new Date('2026-03-01T11:00:00.000Z'));
    resolveDispute(db, users.ari, dispute.id, { resolutionNote: 'Carrier liable' });

    const times = (db.prepare('SELECT occurredAt FROM events ORDER BY id').all() as { occurredAt: string }[]).map(
      (e) => e.occurredAt
    );
    expect(times).toHaveLength(3);
    expect([...times].sort()).toEqual(times);
    expect(verifyLedgerIntegrity(db).ok).toBe(true);
  });
});
