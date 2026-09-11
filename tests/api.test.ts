import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Database } from 'better-sqlite3';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';

describe('API End-to-End Tests', () => {
  let db: Database;
  let app: any;

  const password = 'password123';
  const passwordHash = hashPassword(password);

  beforeEach(() => {
    db = createDb(':memory:');
    app = createApp(db);

    const insertUser = db.prepare(
      'INSERT INTO users (id, username, displayName, passwordHash, role) VALUES (?, ?, ?, ?, ?)'
    );

    insertUser.run('u-sam', 'supplier', 'Sam Ortiz (Northwind Supply)', passwordHash, 'partner');
    insertUser.run('u-dana', 'buyer', 'Dana Reyes (Acme Retail)', passwordHash, 'partner');
    insertUser.run('u-chris', 'carrier', 'Chris Vance (Pacific Freight)', passwordHash, 'partner');
    insertUser.run('u-ari', 'arbiter', 'Ari Lund (Meridian Arbitration)', passwordHash, 'arbiter');
  });

  async function login(username: string): Promise<string> {
    const res = await request(app)
      .post('/api/login')
      .send({ username, password })
      .expect(200);
    return res.body.token;
  }

  describe('Authentication & Protection', () => {
    it('missing token returns 401 UNAUTHENTICATED', async () => {
      const res = await request(app).get('/api/disputes').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('unknown token returns 401 UNAUTHENTICATED', async () => {
      const res = await request(app)
        .get('/api/disputes')
        .set('Authorization', 'Bearer invalid-token-123')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('expired token returns 401 UNAUTHENTICATED', async () => {
      const token = 'expired-token';
      const pastDate = new Date(Date.now() - 1000).toISOString();
      db.prepare('INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)').run(
        token,
        'u-sam',
        pastDate
      );

      const res = await request(app)
        .get('/api/disputes')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('wrong password returns 401 and does not reveal if username exists', async () => {
      const resWrongPw = await request(app)
        .post('/api/login')
        .send({ username: 'supplier', password: 'wrongpassword' })
        .expect(401);

      const resNoSuchUser = await request(app)
        .post('/api/login')
        .send({ username: 'nonexistentuser', password: 'wrongpassword' })
        .expect(401);

      expect(resWrongPw.body).toEqual(resNoSuchUser.body);
      expect(resWrongPw.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('logout revokes session token immediately', async () => {
      const token = await login('supplier');

      // Verify token works
      await request(app)
        .get('/api/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Call logout
      const logoutRes = await request(app)
        .post('/api/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(logoutRes.body.ok).toBe(true);

      // Verify token is now invalid
      const res = await request(app)
        .get('/api/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('unknown API route returns 404 JSON', async () => {
      const res = await request(app)
        .get('/api/unknown-endpoint')
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Happy Path Workflow', () => {
    it('complete dispute lifecycle: raise, evidence from both sides, resolve, read back, and event chain', async () => {
      const supplierToken = await login('supplier');
      const buyerToken = await login('buyer');
      const arbiterToken = await login('arbiter');

      // 1. Supplier raises dispute
      const raiseRes = await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({
          orderReference: 'PO-8834',
          description: '5 of 40 pallets arrived water-damaged',
          respondentId: 'u-dana',
        })
        .expect(201);

      const disputeId = raiseRes.body.id;
      expect(raiseRes.body.status).toBe('OPEN');
      expect(raiseRes.body.claimant.id).toBe('u-sam');
      expect(raiseRes.body.respondent.id).toBe('u-dana');
      expect(raiseRes.body.resolution).toBeNull();

      // 2. Claimant adds evidence
      const ev1Res = await request(app)
        .post(`/api/disputes/${disputeId}/evidence`)
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({ notes: 'Carrier POD photos, ref PH-4471' })
        .expect(201);

      expect(ev1Res.body.evidence).toHaveLength(1);
      expect(ev1Res.body.evidence[0].submittedBy.id).toBe('u-sam');

      // 3. Respondent adds counter-evidence
      const ev2Res = await request(app)
        .post(`/api/disputes/${disputeId}/evidence`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ notes: 'Receiving dock inspection report confirms water damage' })
        .expect(201);

      expect(ev2Res.body.evidence).toHaveLength(2);
      expect(ev2Res.body.evidence[1].submittedBy.id).toBe('u-dana');

      // 4. Arbiter resolves dispute
      const resolveRes = await request(app)
        .post(`/api/disputes/${disputeId}/resolution`)
        .set('Authorization', `Bearer ${arbiterToken}`)
        .send({
          resolutionNote: 'Carrier liable under clause 4. Supplier credited for 5 pallets.',
        })
        .expect(200);

      expect(resolveRes.body.status).toBe('RESOLVED');
      expect(resolveRes.body.resolution.note).toContain('Carrier liable');
      expect(resolveRes.body.resolution.by.id).toBe('u-ari');

      // 5. Read back dispute
      const getRes = await request(app)
        .get(`/api/disputes/${disputeId}`)
        .set('Authorization', `Bearer ${supplierToken}`)
        .expect(200);

      expect(getRes.body.status).toBe('RESOLVED');
      expect(getRes.body.evidence).toHaveLength(2);

      // 6. Verify 4 events were written in order to the hash chain (raise, 2x evidence, resolve)
      const eventsRes = await request(app)
        .get(`/api/disputes/${disputeId}/events`)
        .set('Authorization', `Bearer ${supplierToken}`)
        .expect(200);

      expect(eventsRes.body.items).toHaveLength(4);
      expect(eventsRes.body.items[0].type).toBe('DISPUTE_RAISED');
      expect(eventsRes.body.items[1].type).toBe('EVIDENCE_ADDED');
      expect(eventsRes.body.items[2].type).toBe('EVIDENCE_ADDED');
      expect(eventsRes.body.items[3].type).toBe('DISPUTE_RESOLVED');

      // Check event hash linking across the whole chain
      expect(eventsRes.body.items[1].prevHash).toBe(eventsRes.body.items[0].hash);
      expect(eventsRes.body.items[2].prevHash).toBe(eventsRes.body.items[1].hash);
      expect(eventsRes.body.items[3].prevHash).toBe(eventsRes.body.items[2].hash);
    });
  });

  describe('Authorisation Rules', () => {
    it('enforces partner and arbiter boundaries correctly', async () => {
      const supplierToken = await login('supplier');
      const buyerToken = await login('buyer');
      const carrierToken = await login('carrier');
      const arbiterToken = await login('arbiter');

      // Arbiter cannot raise dispute (403)
      await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${arbiterToken}`)
        .send({
          orderReference: 'PO-9999',
          description: 'test description',
          respondentId: 'u-dana',
        })
        .expect(403);

      // Supplier raises dispute with buyer
      const raiseRes = await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({
          orderReference: 'PO-1234',
          description: 'damaged cargo',
          respondentId: 'u-dana',
        })
        .expect(201);
      const disputeId = raiseRes.body.id;

      // Arbiter cannot add evidence (403)
      await request(app)
        .post(`/api/disputes/${disputeId}/evidence`)
        .set('Authorization', `Bearer ${arbiterToken}`)
        .send({ notes: 'Arbiter notes' })
        .expect(403);

      // Partner cannot resolve dispute (403)
      await request(app)
        .post(`/api/disputes/${disputeId}/resolution`)
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({ resolutionNote: 'Supplier self ruling' })
        .expect(403);

      // Uninvolved partner gets 404 on read and evidence (never confirms existence)
      await request(app)
        .get(`/api/disputes/${disputeId}`)
        .set('Authorization', `Bearer ${carrierToken}`)
        .expect(404);

      await request(app)
        .post(`/api/disputes/${disputeId}/evidence`)
        .set('Authorization', `Bearer ${carrierToken}`)
        .send({ notes: 'Carrier trying to peek' })
        .expect(404);

      // Respondent CAN add evidence
      await request(app)
        .post(`/api/disputes/${disputeId}/evidence`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ notes: 'Respondent evidence accepted' })
        .expect(201);
    });
  });

  describe('Terminal State & Mutability', () => {
    it('evidence and second resolution on RESOLVED dispute return 409 DISPUTE_NOT_OPEN', async () => {
      const supplierToken = await login('supplier');
      const arbiterToken = await login('arbiter');

      const raiseRes = await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({
          orderReference: 'PO-5555',
          description: 'broken parts',
          respondentId: 'u-dana',
        })
        .expect(201);
      const disputeId = raiseRes.body.id;

      // Resolve dispute
      await request(app)
        .post(`/api/disputes/${disputeId}/resolution`)
        .set('Authorization', `Bearer ${arbiterToken}`)
        .send({ resolutionNote: 'Case settled.' })
        .expect(200);

      // Subsequent evidence attempt gives 409
      const evRes = await request(app)
        .post(`/api/disputes/${disputeId}/evidence`)
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({ notes: 'late evidence' })
        .expect(409);
      expect(evRes.body.error.code).toBe('DISPUTE_NOT_OPEN');

      // Second resolution attempt gives 409
      const resRes = await request(app)
        .post(`/api/disputes/${disputeId}/resolution`)
        .set('Authorization', `Bearer ${arbiterToken}`)
        .send({ resolutionNote: 'second ruling' })
        .expect(409);
      expect(resRes.body.error.code).toBe('DISPUTE_NOT_OPEN');
    });
  });

  describe('Attribution', () => {
    it('ignores client-supplied claimantId, createdAt, and status', async () => {
      const supplierToken = await login('supplier');

      const res = await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
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
  });

  describe('Validation', () => {
    it('validates order reference, text lengths, and respondent', async () => {
      const supplierToken = await login('supplier');

      // Bad order reference characters
      await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({
          orderReference: 'BAD REF #$%@',
          description: 'valid desc',
          respondentId: 'u-dana',
        })
        .expect(400);

      // Empty description
      await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({
          orderReference: 'PO-VALID',
          description: '   ',
          respondentId: 'u-dana',
        })
        .expect(400);

      // Over-long description (>2000 chars)
      await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({
          orderReference: 'PO-VALID',
          description: 'x'.repeat(2001),
          respondentId: 'u-dana',
        })
        .expect(400);

      // Respondent equal to caller
      await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({
          orderReference: 'PO-VALID',
          description: 'valid desc',
          respondentId: 'u-sam',
        })
        .expect(400);

      // Unknown respondent
      await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({
          orderReference: 'PO-VALID',
          description: 'valid desc',
          respondentId: 'u-ghost',
        })
        .expect(400);

      // Respondent is arbiter (not partner)
      await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({
          orderReference: 'PO-VALID',
          description: 'valid desc',
          respondentId: 'u-ari',
        })
        .expect(400);
    });
  });

  describe('Integrity Verification Endpoint', () => {
    it('returns ok on valid run, and names firstBadEventId after raw SQL UPDATE on evidence or events', async () => {
      const supplierToken = await login('supplier');
      const arbiterToken = await login('arbiter');

      // Create dispute and evidence
      const raiseRes = await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({
          orderReference: 'PO-INTEGRITY',
          description: 'damaged shipment',
          respondentId: 'u-dana',
        })
        .expect(201);
      const disputeId = raiseRes.body.id;

      await request(app)
        .post(`/api/disputes/${disputeId}/evidence`)
        .set('Authorization', `Bearer ${supplierToken}`)
        .send({ notes: 'Authentic photos' })
        .expect(201);

      // Check integrity -> should be OK
      const integrityOk = await request(app)
        .get('/api/integrity')
        .set('Authorization', `Bearer ${supplierToken}`)
        .expect(200);

      expect(integrityOk.body.ok).toBe(true);
      expect(integrityOk.body.eventsChecked).toBe(2);

      // Tamper test 1: Raw UPDATE on evidence table
      db.prepare("UPDATE evidence SET notes = 'never happened' WHERE disputeId = ?").run(disputeId);

      const integrityEvidenceTampered = await request(app)
        .get('/api/integrity')
        .set('Authorization', `Bearer ${arbiterToken}`)
        .expect(200);

      expect(integrityEvidenceTampered.body.ok).toBe(false);
      expect(integrityEvidenceTampered.body.firstBadEventId).toBe(2);

      // Restore evidence notes and verify OK again
      db.prepare("UPDATE evidence SET notes = 'Authentic photos' WHERE disputeId = ?").run(disputeId);
      const integrityRestored = await request(app)
        .get('/api/integrity')
        .set('Authorization', `Bearer ${supplierToken}`)
        .expect(200);
      expect(integrityRestored.body.ok).toBe(true);

      // Tamper test 2: Raw UPDATE on events table
      db.prepare("UPDATE events SET payload = '{\"orderReference\":\"PO-HACKED\"}' WHERE id = 1").run();

      const integrityEventTampered = await request(app)
        .get('/api/integrity')
        .set('Authorization', `Bearer ${supplierToken}`)
        .expect(200);

      expect(integrityEventTampered.body.ok).toBe(false);
      expect(integrityEventTampered.body.firstBadEventId).toBe(1);
    });
  });
});
