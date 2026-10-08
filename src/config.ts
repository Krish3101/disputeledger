const rawPort = process.env.PORT;
export const PORT = rawPort ? Number(rawPort) : 3000;
export const DB_PATH = process.env.DB_PATH || './dispute.db';

const MIN_LEDGER_KEY_LENGTH = 32;

export function getLedgerKey(): string {
  const key = process.env.LEDGER_KEY;
  if (!key) {
    throw new Error('LEDGER_KEY is not set. Copy .env.example to .env, or set it in the environment.');
  }
  if (key.length < MIN_LEDGER_KEY_LENGTH) {
    throw new Error(`LEDGER_KEY must be at least ${MIN_LEDGER_KEY_LENGTH} characters.`);
  }
  return key;
}
