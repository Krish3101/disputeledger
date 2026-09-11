import { existsSync } from 'node:fs';
import DatabaseConstructor from 'better-sqlite3';
import { getLedgerKey } from './config.js';
import { verifyLedger } from './ledger.js';

// Usage: npm run verify -- --db <path>
// Exit codes: 0 the ledger checks out, 1 tampered, 2 bad input.

function run(args: string[]): number {
  const i = args.indexOf('--db');
  const dbPath = i >= 0 ? args[i + 1] : undefined;
  if (!dbPath) {
    console.error('Usage: npm run verify -- --db <path>');
    return 2;
  }
  if (!existsSync(dbPath)) {
    console.error(`No database at ${dbPath}`);
    return 2;
  }

  let key: string;
  try {
    key = getLedgerKey();
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  // Read-only, so checking a copy can never change it
  const db = new DatabaseConstructor(dbPath, { readonly: true, fileMustExist: true });
  try {
    const result = verifyLedger(db, key);
    if (result.ok) {
      console.log(`OK ${result.eventsChecked} events, head ${result.head.hash.slice(0, 8)}`);
      return 0;
    }

    const where = result.eventId !== undefined ? `event #${result.eventId}` : `row ${result.rowId}`;
    const dispute = result.disputeId ? ` (dispute ${result.disputeId})` : '';
    console.log(`${result.reason} at ${where}${dispute}`);
    console.log(result.detail);
    return 1;
  } catch (err) {
    // Not an SQLite file, or tables missing
    console.error(`Cannot read ${dbPath}: ${(err as Error).message}`);
    return 2;
  } finally {
    db.close();
  }
}

process.exit(run(process.argv.slice(2)));
