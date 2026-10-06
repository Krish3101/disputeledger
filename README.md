# Dispute Ledger

A buyer, a supplier, a carrier and an arbiter share one case file per dispute (damaged
pallets, a short shipment). Nobody, including whoever runs the database, should be able to
quietly change that record afterwards.

So every write is HMAC-chained in the same transaction as its row, and a check replays the
chain against the live tables and names the first record that was altered. The dispute app
is the demo; the part worth reading is the audit-log layer under it.

**Stack:** TypeScript on Node.js 22, Express, better-sqlite3, Zod, Vitest with supertest, a plain HTML/CSS/JS frontend, Render.

**Live demo:** <https://disputeledger.onrender.com>. Log in with the quick buttons; the demo
reseeds every time the free server restarts, and the first load can take about a minute.

![The ledger check naming the edited event](docs/tamper-caught.png)

## What it detects, and what it can't

Someone with the database file but not `LEDGER_KEY` (a stolen backup, an admin with disk
access) can run any SQL they like. The check catches:

| Attack | Reported as |
|---|---|
| Edit a row (an evidence note, a ruling) | `ROW_MISMATCH` at that row's event |
| Backdate a timestamp | `ROW_MISMATCH` |
| Swap two events | `CHAIN_BROKEN` |
| Delete an event in the middle | `CHAIN_BROKEN`, naming the missing event |
| Rehash the chain with plain SHA-256 (no key) | `CHAIN_BROKEN` |
| Insert a row with no event (a forged dispute, evidence or ruling) | `ORPHAN_ROW` with the row's id |
| Inject an extra field, or reorder keys, in a stored payload | `PAYLOAD_NOT_CANONICAL` |

It cannot detect:

- **Deleting the newest events, or wiping everything.** What's left is still a valid chain.
  Catching that needs the latest hash held somewhere outside the server.
- **A full rewrite by someone holding `LEDGER_KEY`.** The key is what makes the chain hard to
  forge, so whoever has the database and `.env` can rebuild history. A rewrite that dates an
  event before the one ahead of it is flagged (`TIMESTAMP_REGRESSION`); one that keeps the
  dates in order passes.
- **A lie told at write time.** The ledger proves a record wasn't changed later; it does not
  prove it was true.

Users, password hashes and sessions are not covered by the chain.

**Next steps:** signed checkpoints of the chain head, handed to the parties and kept outside
the server, which would catch truncation and rewrites by the key holder.

## Try the tamper demo

Tamper with a **copy**, then check it offline (stop the server first, so the copy includes
writes still sitting in the WAL file):

```bash
cp dispute.db copy.db
sqlite3 copy.db "UPDATE evidence SET notes='never happened' WHERE rowid=1"
npm run verify -- --db copy.db
# ROW_MISMATCH at event #2 (dispute 6cea...)
# The row for event #2 (EVIDENCE_ADDED) no longer matches it
```

`npm run verify` exits 0 when the ledger checks out, 1 when it was tampered with and 2 for
bad input. It opens the file read-only and runs the same check as the API.

Or serve the copy on a second port and click **Verify ledger** as the arbiter:

```bash
PORT=3001 DB_PATH=copy.db npm start
```

A red banner names the reason and the first bad event, and stays while you move around.
**Go to event** opens the dispute with that event marked `TAMPERED` and every later event
marked as not trusted.

## Design

- **Event envelope.** Each event is serialised as
  `{v, ledger, id, type, disputeId, actorId, occurredAt, keyId, payload}`. The payload has a
  fixed set of fields per event type, in a fixed order, and the stored bytes must be exactly
  that canonical JSON, so nothing can hide in an extra field.
- **Hash.** `hash = HMAC-SHA256(LEDGER_KEY, "dl.event.v1\n" + prevHash + "\n" + envelope)`.
  The first event's `prevHash` is a SHA-256 of a random `ledgerId` made when the database is
  created, so two databases never share a chain. Event ids must run 1, 2, 3 with no gaps.
- **One global chain** across all disputes. Simpler to verify and it orders everything, at
  the cost that every write waits on the one before it (fine for SQLite anyway).
- **Same transaction.** Each raise, evidence note and ruling checks its rules, writes its
  row and appends its event inside one `BEGIN IMMEDIATE` transaction, so the ledger can't
  drift from the data and two arbiters can't both resolve a dispute.
- **Reconciliation.** The check replays the chain, then compares every event with its row,
  then looks for rows with no event, all in one read transaction
  (`src/ledger/reconcile.ts`).
- **Roles.** Partners see and add evidence to disputes they are a party to (others get a
  404, not a 403). Only the arbiter records rulings and runs the ledger check, because the
  check reads every dispute.

## Running it

Needs Node.js 22 or newer.

```bash
./scripts/start.sh
```

That generates a `LEDGER_KEY` into `.env` the first time, installs dependencies, builds to
`dist/`, seeds the database if there isn't one, and starts the server at
http://localhost:3000.

![A dispute as the arbiter sees it: evidence from both sides and its ledger events](docs/dispute.png)

Seeded accounts, password `password123` for all of them (demo only):

| user | role | acting as |
|---|---|---|
| `supplier` | partner | Sam Ortiz, Northwind Supply |
| `buyer` | partner | Dana Reyes, Acme Retail |
| `carrier` | partner | Chris Vance, Pacific Freight |
| `arbiter` | arbiter | Ari Lund, Meridian Arbitration |

Evidence is text notes only; there are no file uploads.

**Configuration** (in `.env`):

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `DB_PATH` | `./dispute.db` | |
| `LEDGER_KEY` | none | Required, at least 32 characters. `start.sh` generates one. Changing it makes every existing event fail the check. |
| `DEMO_RESEED` | unset | `npm run seed` refuses to replace an existing database unless this is `1`. |

A database from an older version of the app is refused at startup with
"... was made by an older version: delete it and run npm run seed". There are no
migrations.

**Deploying.** `render.yaml` runs it on Render's free plan (New → Blueprint → this repo). It
builds to compiled JS, Render generates `LEDGER_KEY`, the health check is `/api/health`, and
`DEMO_RESEED=1` is set because the free plan has no persistent disk.

```
src/
  ledger/chain.ts      what an event is, how it is hashed, how the chain is checked
  ledger/reconcile.ts  the chain against the rows, and rows with no event
  disputes.ts          raise / add evidence / resolve, each in one transaction
  format.ts            the JSON the API returns
  domain.ts            dispute rules and error types, no I/O
  auth.ts              scrypt passwords, hashed session tokens
  db.ts                schema and the version check
  routes.ts            endpoints, Zod validation, login rate limit
  app.ts, main.ts      Express setup and startup
  seed.ts, verify.ts   demo data and the offline check
public/                plain HTML, CSS and ES modules
```

## Tests

```bash
npm test
```

70 Vitest tests in 8 files: the ledger functions, a tamper matrix of 10 attacks that each
assert their reason (the eight in the table above, a lone-surrogate string that is rejected
with 400 before it can poison the chain, and tail truncation, which is asserted to pass as
the known limit), the schema check and seed guard, the `verify` exit
codes, and the API (auth and rate limiting, the dispute rules, JSON errors, the arbiter-only
check, and two connections racing to resolve the same dispute). Tests also verify building and starting
`dist/main.js`.

## License

[MIT](LICENSE)
