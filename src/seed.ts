import { existsSync, unlinkSync } from 'node:fs';
import { createDb } from './db.js';
import { hashPassword } from './auth.js';
import { raiseDispute, addEvidence, resolveDispute } from './disputes.js';
import { verifyLedger } from './ledger.js';
import { DB_PATH, getLedgerKey } from './config.js';

try {
  getLedgerKey();
} catch (err) {
  console.error(`Cannot seed: ${(err as Error).message}`);
  process.exit(1);
}

// Always rebuilds: the demo data is small, and Render's free plan has no disk to keep anyway.
for (const file of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(file)) {
    unlinkSync(file);
  }
}

const db = createDb(DB_PATH);

const defaultPassword = 'password123';
const passwordHash = hashPassword(defaultPassword);

const seedUsers = [
  {
    id: 'u-sam',
    username: 'supplier',
    displayName: 'Sam Ortiz (Northwind Supply)',
    passwordHash,
    role: 'partner' as const,
  },
  {
    id: 'u-dana',
    username: 'buyer',
    displayName: 'Dana Reyes (Acme Retail)',
    passwordHash,
    role: 'partner' as const,
  },
  {
    id: 'u-chris',
    username: 'carrier',
    displayName: 'Chris Vance (Pacific Freight)',
    passwordHash,
    role: 'partner' as const,
  },
  {
    id: 'u-ari',
    username: 'arbiter',
    displayName: 'Ari Lund (Meridian Arbitration)',
    passwordHash,
    role: 'arbiter' as const,
  },
];

const insertUser = db.prepare(
  'INSERT INTO users (id, username, displayName, passwordHash, role) VALUES (?, ?, ?, ?, ?)'
);

for (const u of seedUsers) {
  insertUser.run(u.id, u.username, u.displayName, u.passwordHash, u.role);
}

const [sam, dana, chris, ari] = seedUsers;

// 1. OPEN dispute: Supplier vs Buyer with evidence from both sides
const dispute1 = raiseDispute(
  db,
  sam,
  {
    orderReference: 'PO-8834',
    description: '5 of 40 pallets arrived water-damaged upon arrival at receiving dock.',
    respondentId: dana.id,
  }
);

addEvidence(
  db,
  sam,
  dispute1.id,
  { notes: 'Carrier POD photos, ref PH-4471 showing water ingress on delivery.' }
);

addEvidence(
  db,
  dana,
  dispute1.id,
  { notes: 'Receiving dock inspection report DR-202 confirmed package dampness and box deformation.' }
);

// 2. RESOLVED dispute: Buyer vs Carrier with evidence and resolution
const dispute2 = raiseDispute(
  db,
  dana,
  {
    orderReference: 'PO-7712',
    description: 'Short shipment: invoice billed 100 cartons, only 90 received.',
    respondentId: chris.id,
  }
);

addEvidence(
  db,
  dana,
  dispute2.id,
  { notes: 'Delivery receipt marked with shortage exception on line 3.' }
);

addEvidence(
  db,
  chris,
  dispute2.id,
  { notes: 'Transfer manifest TM-903 indicates only 90 cartons were received from origin warehouse.' }
);

resolveDispute(
  db,
  ari,
  dispute2.id,
  {
    resolutionNote:
      'Carrier liable under clause 4. Supplier credited buyer for 10 missing cartons based on transfer manifest records.',
  }
);

const verified = verifyLedger(db);

console.log('---------------------------------------------------------');
console.log(`Database seeded at: ${DB_PATH}`);
const verifyMsg = verified.ok
  ? `OK (${verified.eventsChecked} events verified)`
  : `FAILED (${verified.reason}: ${verified.detail})`;
console.log(`Ledger check: ${verifyMsg}`);
console.log('---------------------------------------------------------');
console.log('Seeded Users (Password: password123):');
for (const u of seedUsers) {
  console.log(`- [${u.role.toUpperCase()}] ${u.displayName}`);
  console.log(`  Username: ${u.username} | Password: ${defaultPassword}`);
}
console.log('---------------------------------------------------------');
console.log('Seeded Disputes:');
console.log(`1. [OPEN] ${dispute1.orderReference} (${dispute1.claimant.displayName} vs ${dispute1.respondent.displayName})`);
console.log(`2. [RESOLVED] ${dispute2.orderReference} (${dispute2.claimant.displayName} vs ${dispute2.respondent.displayName})`);
console.log('---------------------------------------------------------');
