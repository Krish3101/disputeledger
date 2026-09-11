import { createDb } from './db.js';
import { createApp } from './app.js';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const dbPath = process.env.DB_PATH || './dispute.db';

const db = createDb(dbPath);
const app = createApp(db);

const server = app.listen(port, () => {
  console.log(`Dispute Ledger running at http://localhost:${port} (database: ${dbPath})`);
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
