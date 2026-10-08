import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Database } from 'better-sqlite3';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { insertUsers, login } from './helpers.js';

describe('API', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDb(':memory:');
    app = createApp(db);
    insertUsers(db);
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('a wrong password gets 401 "Invalid username or password."', async () => {
    const res = await request(app).post('/api/login').send({ username: 'supplier', password: 'wrongpassword' }).expect(401);
    expect(res.body.error).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
  });

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

  it('a resolved dispute takes no more evidence or resolutions (409)', async () => {
    const supplier = await login(app, 'supplier');
    const arbiter = await login(app, 'arbiter');
    const id = await raise(supplier);
    await request(app).post(`/api/disputes/${id}/resolution`).set(auth(arbiter)).send({ resolutionNote: 'Settled.' }).expect(200);

    const ev = await request(app).post(`/api/disputes/${id}/evidence`).set(auth(supplier)).send({ notes: 'late' }).expect(409);
    expect(ev.body.error.code).toBe('DISPUTE_NOT_OPEN');
    const again = await request(app).post(`/api/disputes/${id}/resolution`).set(auth(arbiter)).send({ resolutionNote: '2nd' }).expect(409);
    expect(again.body.error.code).toBe('DISPUTE_NOT_OPEN');
  });

  describe('verify endpoint', () => {
    it('is arbiter-only: supplier 403, arbiter 200', async () => {
      const supplier = await login(app, 'supplier');
      const arbiter = await login(app, 'arbiter');
      await raise(supplier);

      const denied = await request(app).get('/api/ledger/verify').set(auth(supplier)).expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
      const ok = await request(app).get('/api/ledger/verify').set(auth(arbiter)).expect(200);
      expect(ok.body).toMatchObject({ ok: true, eventsChecked: 1, head: { seq: 1 } });
    });

    it('names the event and dispute after a raw UPDATE, and recovers when it is undone', async () => {
      const supplier = await login(app, 'supplier');
      const arbiter = await login(app, 'arbiter');
      const id = await raise(supplier);
      await request(app).post(`/api/disputes/${id}/evidence`).set(auth(supplier)).send({ notes: 'Authentic photos' }).expect(201);

      db.prepare("UPDATE evidence SET notes = 'never happened'").run();
      const bad = await request(app).get('/api/ledger/verify').set(auth(arbiter)).expect(200);
      expect(bad.body).toMatchObject({ ok: false, reason: 'ROW_MISMATCH', eventId: 2, disputeId: id });
      expect(bad.body.head.seq).toBe(2);

      db.prepare("UPDATE evidence SET notes = 'Authentic photos'").run();
      const fixed = await request(app).get('/api/ledger/verify').set(auth(arbiter)).expect(200);
      expect(fixed.body.ok).toBe(true);
    });
  });
});
