#!/usr/bin/env bash
set -e

# Change to project root directory
cd "$(dirname "$0")/.."

# Every ledger event is keyed with LEDGER_KEY. Generate one the first time.
if ! grep -q '^LEDGER_KEY=.' .env 2>/dev/null; then
  [ -f .env ] || cp .env.example .env
  echo "LEDGER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env
  echo "Generated LEDGER_KEY in .env"
fi

echo "Resetting database..."
rm -f dispute.db dispute.db-shm dispute.db-wal

echo "Seeding fresh database..."
npm run seed

echo "Database reset complete."
