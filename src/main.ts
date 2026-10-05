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
const app = createApp(db);

const server = app.listen(PORT, () => {
  console.log(`Dispute Ledger running at http://localhost:${PORT} (database: ${DB_PATH})`);
});

function shutdown(signal: string): void {
  console.log(`\nReceived ${signal}. Gracefully shutting down...`);
  server.close(() => {
    try {
      db.close();
      console.log('Database connection closed cleanly.');
    } catch (err) {
      console.error('Error closing database:', err);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
