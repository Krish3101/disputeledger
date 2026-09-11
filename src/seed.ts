import { existsSync, unlinkSync } from 'node:fs';
import { createDb } from './db.js';
import { hashPassword } from './auth.js';
import { raiseDispute, addEvidence, resolveDispute } from './disputes.js';
import { verifyLedgerIntegrity } from './audit.js';

const dbPath = process.env.DB_PATH || './dispute.db';

if (existsSync(dbPath)) {
  unlinkSync(dbPath);
}
if (existsSync(`${dbPath}-wal`)) {
  unlinkSync(`${dbPath}-wal`);
}
if (existsSync(`${dbPath}-shm`)) {
  unlinkSync(`${dbPath}-shm`);
}

const db = createDb(dbPath);

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

// 1. OPEN dispute: Supplier vs Buyer with evidence from both sides
const dispute1 = raiseDispute(
  db,
  { id: 'u-sam', username: 'supplier', displayName: 'Sam Ortiz (Northwind Supply)', role: 'partner' },
  {
    orderReference: 'PO-8834',
    description: '5 of 40 pallets arrived water-damaged upon arrival at receiving dock.',
    respondentId: 'u-dana',
  }
);

addEvidence(
  db,
  { id: 'u-sam', username: 'supplier', displayName: 'Sam Ortiz (Northwind Supply)', role: 'partner' },
  dispute1.id,
  { notes: 'Carrier POD photos, ref PH-4471 showing water ingress on delivery.' }
);

addEvidence(
  db,
  { id: 'u-dana', username: 'buyer', displayName: 'Dana Reyes (Acme Retail)', role: 'partner' },
  dispute1.id,
  { notes: 'Receiving dock inspection report DR-202 confirmed package dampness and box deformation.' }
);

// 2. RESOLVED dispute: Buyer vs Carrier with evidence and resolution
const dispute2 = raiseDispute(
  db,
  { id: 'u-dana', username: 'buyer', displayName: 'Dana Reyes (Acme Retail)', role: 'partner' },
  {
    orderReference: 'PO-7712',
    description: 'Short shipment: invoice billed 100 cartons, only 90 received.',
    respondentId: 'u-chris',
  }
);

addEvidence(
  db,
  { id: 'u-dana', username: 'buyer', displayName: 'Dana Reyes (Acme Retail)', role: 'partner' },
  dispute2.id,
  { notes: 'Delivery receipt marked with shortage exception on line 3.' }
);

addEvidence(
  db,
  { id: 'u-chris', username: 'carrier', displayName: 'Chris Vance (Pacific Freight)', role: 'partner' },
  dispute2.id,
  { notes: 'Transfer manifest TM-903 indicates only 90 cartons were received from origin warehouse.' }
);

resolveDispute(
  db,
  { id: 'u-ari', username: 'arbiter', displayName: 'Ari Lund (Meridian Arbitration)', role: 'arbiter' },
  dispute2.id,
  {
    resolutionNote:
      'Carrier liable under clause 4. Supplier credited buyer for 10 missing cartons based on transfer manifest records.',
  }
);

const integrity = verifyLedgerIntegrity(db);

console.log('---------------------------------------------------------');
console.log(`Database seeded at: ${dbPath}`);
const integrityMsg = integrity.ok
  ? `OK (${integrity.eventsChecked} events verified)`
  : `FAILED (tampered at event #${integrity.firstBadEventId})`;
console.log(`Ledger Integrity: ${integrityMsg}`);
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
