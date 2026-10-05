import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Database } from 'better-sqlite3';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { insertUsers, login } from './helpers.js';

describe('hardening', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDb(':memory:');
    app = createApp(db);
    insertUsers(db);
  });

  it('serves helmet headers and a CSP, without X-Powered-By', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('health check reports the database and key', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'healthy', db: true, ledgerKey: true });
  });

  it('serves the page at /', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('unknown API route returns 404 JSON', async () => {
    const res = await request(app).get('/api/unknown-endpoint').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('malformed JSON gets a JSON 400 with no stack trace', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('Content-Type', 'application/json')
      .send('{"username": "supplier", invalid_json')
      .expect(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(res.text).not.toContain('SyntaxError');
  });

  it('a null body gets a JSON 400', async () => {
    const res = await request(app).post('/api/login').set('Content-Type', 'application/json').send('null').expect(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toBeDefined();
  });

  it('a body over 100 kB gets a JSON 413', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ username: 'supplier', password: 'x'.repeat(110_000) }))
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('a lone surrogate is rejected with 400 VALIDATION_FAILED', async () => {
    const token = await login(app, 'supplier');
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderReference: 'PO-UNICODE', description: 'bad \ud800 string', respondentId: 'u-dana' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.message).toContain('invalid Unicode');
  });

  it('a database error is logged and returns a generic 500', async () => {
    const token = await login(app, 'supplier');
    db.exec('DROP TABLE disputes');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/disputes').set('Authorization', `Bearer ${token}`).expect(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL', message: 'An internal server error occurred.' });
    expect(res.text).not.toContain('SQLITE');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
