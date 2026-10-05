export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
export const DB_PATH = process.env.DB_PATH || './dispute.db';

const MIN_LEDGER_KEY_LENGTH = 32;

export function getLedgerKey(): string {
  const key = process.env.LEDGER_KEY;
  if (!key) {
    throw new Error('LEDGER_KEY is not set. Run ./scripts/start.sh once, or add it to .env.');
  }
  if (key.length < MIN_LEDGER_KEY_LENGTH) {
    throw new Error(`LEDGER_KEY must be at least ${MIN_LEDGER_KEY_LENGTH} characters.`);
  }
  return key;
}
