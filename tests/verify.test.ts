import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { beforeAll, describe, it, expect } from 'vitest';
import { createDb } from '../src/db.js';
import { raiseDispute, addEvidence } from '../src/disputes.js';
import { insertUsers, tmpDbPath, users } from './helpers.js';

const verify = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/verify.ts', ...args], { encoding: 'utf8', timeout: 20_000 });

describe('npm run verify', () => {
  let path: string;

  beforeAll(() => {
    path = tmpDbPath();
    const db = createDb(path);
    insertUsers(db);
    const id = raiseDispute(db, users.sam, { orderReference: 'PO-1', description: 'damaged', respondentId: users.dana.id }).id;
    addEvidence(db, users.sam, id, { notes: 'photos' });
    db.close();
  });

  it('exits 0 and prints the event count and head for a clean database', () => {
    const run = verify('--db', path);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^OK 2 events, head [0-9a-f]{8}$/m);
  });

  it('exits 1 and names the reason and event for a tampered copy', () => {
    const copy = tmpDbPath();
    const db = createDb(path);
    db.exec(`VACUUM INTO '${copy}'`);
    db.close();
    const tampered = createDb(copy);
    tampered.prepare("UPDATE evidence SET notes = 'x'").run();
    tampered.close();

    const run = verify('--db', copy);
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/^ROW_MISMATCH at event #2 \(dispute [0-9a-f-]+\)$/m);
  });

  it('exits 2 for bad input', () => {
    expect(verify().status).toBe(2);
    expect(verify('--db', '/no/such/file.db').status).toBe(2);
    const notSqlite = tmpDbPath();
    writeFileSync(notSqlite, 'not a database');
    expect(verify('--db', notSqlite).status).toBe(2);
  });
});
