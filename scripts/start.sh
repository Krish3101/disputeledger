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

# Check if bootstrapping should be skipped via environment variable
if [ "${SKIP_INIT:-0}" != "1" ]; then
  # Ensure dependencies are installed
  if [ ! -d "node_modules" ]; then
    echo "Dependencies not found. Running npm install..."
    npm install
  fi

  # Ensure database exists, seed if missing
  if [ ! -f "dispute.db" ]; then
    echo "Database not found. Seeding initial data..."
    npm run seed
  fi
fi

echo "Starting Dispute Ledger at http://localhost:3000 ..."
exec npm start
