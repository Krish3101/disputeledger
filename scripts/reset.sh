#!/usr/bin/env bash
set -e

# Change to project root directory
cd "$(dirname "$0")/.."

echo "Resetting database..."
rm -f dispute.db dispute.db-shm dispute.db-wal

echo "Seeding fresh database..."
npm run seed

echo "Database reset complete."
