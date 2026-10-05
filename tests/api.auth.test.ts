import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Database } from 'better-sqlite3';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/auth.js';
import { insertUsers, login, PASSWORD } from './helpers.js';

describe('authentication', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDb(':memory:');
    app = createApp(db);
    insertUsers(db);
  });

  it('missing token returns 401 UNAUTHENTICATED', async () => {
    const res = await request(app).get('/api/disputes').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('unknown token returns 401 UNAUTHENTICATED', async () => {
    const res = await request(app).get('/api/disputes').set('Authorization', 'Bearer invalid-token-123').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('expired token returns 401 UNAUTHENTICATED', async () => {
    const token = 'expired-token';
    const past = new Date(Date.now() - 1000).toISOString();
    db.prepare('INSERT INTO sessions (tokenHash, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)').run(
      hashToken(token),
      'u-sam',
      past,
      past
    );
    const res = await request(app).get('/api/disputes').set('Authorization', `Bearer ${token}`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('wrong password and unknown user get the same 401', async () => {
    const wrongPw = await request(app).post('/api/login').send({ username: 'supplier', password: 'wrongpassword' }).expect(401);
    const noUser = await request(app).post('/api/login').send({ username: 'nobody', password: 'wrongpassword' }).expect(401);
    expect(wrongPw.body).toEqual(noUser.body);
    expect(wrongPw.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('stores only the hash of the session token', async () => {
    const token = await login(app, 'supplier');
    const rows = db.prepare('SELECT tokenHash FROM sessions').all() as { tokenHash: string }[];
    expect(rows.map((r) => r.tokenHash)).toEqual([hashToken(token)]);
  });

  it('logout revokes the token immediately', async () => {
    const token = await login(app, 'supplier');
    await request(app).get('/api/me').set('Authorization', `Bearer ${token}`).expect(200);
    const out = await request(app).post('/api/logout').set('Authorization', `Bearer ${token}`).expect(200);
    expect(out.body.ok).toBe(true);
    await request(app).get('/api/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('partners list leaves out usernames', async () => {
    const token = await login(app, 'supplier');
    const res = await request(app).get('/api/partners').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.items).toHaveLength(3);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(['displayName', 'id', 'role']);
    }
  });
});

describe('login rate limit', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const db = createDb(':memory:');
    app = createApp(db);
    insertUsers(db);
  });

  const attempt = (ip: string, username: string, password = 'wrongpassword') =>
    request(app).post('/api/login').set('X-Forwarded-For', ip).send({ username, password });

  it('the 11th attempt from one IP for one username gets a JSON 429', async () => {
    for (let i = 0; i < 10; i++) {
      await attempt('203.0.113.1', 'supplier').expect(401);
    }
    const res = await attempt('203.0.113.1', 'supplier', PASSWORD).expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('two forwarded IPs are limited independently', async () => {
    for (let i = 0; i < 10; i++) {
      await attempt('203.0.113.1', 'supplier').expect(401);
    }
    await attempt('203.0.113.1', 'supplier').expect(429);
    await attempt('198.51.100.7', 'supplier', PASSWORD).expect(200);
  });

  it('another username from the same IP is not blocked', async () => {
    for (let i = 0; i < 10; i++) {
      await attempt('203.0.113.1', 'supplier').expect(401);
    }
    await attempt('203.0.113.1', 'buyer', PASSWORD).expect(200);
  });
});
