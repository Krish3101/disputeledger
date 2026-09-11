#!/usr/bin/env bash
set -e

# Change to project root directory
cd "$(dirname "$0")/.."

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
