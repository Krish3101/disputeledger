import type { Database } from 'better-sqlite3';
import { createDb } from './db.js';
import { createApp } from './app.js';
import { PORT, DB_PATH, getLedgerKey } from './config.js';

// Fail fast at startup rather than on the first write
let db: Database;
try {
  getLedgerKey();
  db = createDb(DB_PATH);
} catch (err) {
  console.error(`Cannot start: ${(err as Error).message}`);
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error(`Cannot start: PORT must be an integer from 0 to 65535 (got "${process.env.PORT}").`);
  process.exit(1);
}
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Dispute Ledger running at http://localhost:${PORT} (database: ${DB_PATH})`);
});
