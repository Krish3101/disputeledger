#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

if ! node -e 'process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)' 2>/dev/null; then
  echo "Error: Dispute Ledger needs Node.js 22 or newer (found $(node --version 2>/dev/null || echo none))."
  exit 1
fi

# Every ledger event is keyed with LEDGER_KEY. Generate one the first time.
if ! grep -q '^LEDGER_KEY=.' .env 2>/dev/null; then
  [ -f .env ] || cp .env.example .env
  echo "LEDGER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env
  echo "Generated LEDGER_KEY in .env"
fi

if [ ! -d node_modules ]; then
  npm install
fi

# tsc only takes a few seconds, so always build: dist/ is never stale
npm run build

if [ ! -f "${DB_PATH:-./dispute.db}" ]; then
  npm run seed
fi

exec npm start
