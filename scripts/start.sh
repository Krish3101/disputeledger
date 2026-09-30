#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

# Every ledger event is keyed with LEDGER_KEY. Generate one the first time.
if ! grep -q '^LEDGER_KEY=.' .env 2>/dev/null; then
  [ -f .env ] || cp .env.example .env
  echo "LEDGER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env
  echo "Generated LEDGER_KEY in .env"
fi

if [ ! -d node_modules ]; then
  npm install
fi

if [ ! -f dispute.db ]; then
  npm run seed
fi

exec npm start
