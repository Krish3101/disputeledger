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
  # An existing .env may not end in a newline, which would glue the key onto its last line
  [ -z "$(tail -c1 .env)" ] || echo >> .env
  echo "LEDGER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env
  echo "Generated LEDGER_KEY in .env"
fi

if [ ! -d node_modules ]; then
  npm ci
fi

# tsc only takes a few seconds, so always build: dist/ is never stale
npm run build

# npm start reads .env itself, so look there too when DB_PATH isn't in the environment.
# Parsed with sed rather than sourced, so nothing else in the file is executed.
db_path="${DB_PATH:-}"
if [ -z "$db_path" ] && [ -f .env ]; then
  db_path=$(sed -n 's/^DB_PATH=//p' .env | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/")
fi

if [ ! -f "${db_path:-./dispute.db}" ]; then
  npm run seed
fi

exec npm start
