# Dispute Ledger

When a buyer, a supplier and a carrier disagree about a shipment, everyone works from one case file, and that file is only worth trusting if nobody can quietly change it afterwards, including whoever runs the database. Dispute Ledger records every change to a dispute as an event in an HMAC hash chain, and one check replays the chain against the live tables to confirm the record is intact or name the first record that was altered.

![screenshot](screenshot.png)

## Run (macOS)

Needs Node.js 22 or newer (`brew install node`).

```bash
cp .env.example .env            # ships a marked demo LEDGER_KEY
npm install
npm run seed                    # rebuilds dispute.db with demo data
npm run dev                     # http://localhost:3000
```

Log in with one of the four demo buttons (Supplier, Buyer, Carrier, Arbiter); every demo password is `password123`. On Render, `render.yaml` builds with `npm run build`, reseeds on each start and generates its own `LEDGER_KEY`.

## How it works

1. A partner raises a dispute, a party adds evidence, or the arbiter resolves it; `routes.ts` checks the session and validates the body with Zod.
2. `disputes.ts` opens one transaction, checks who may do this, and writes the row.
3. In the same transaction `appendEvent` reads the last event's hash and stores a new event: `hash = HMAC-SHA256(LEDGER_KEY, prevHash + "\n" + JSON(id, type, disputeId, actorId, occurredAt, payload))`. The first `prevHash` is 64 zeros.
4. The arbiter's Verify button calls `verifyLedger`, which replays every event: ids must run 1, 2, 3 with no gap, each `prevHash` must match the hash before it, and each hash must recompute.
5. It then compares each event with its row, and looks for rows that have no event.
6. The answer is "intact" with the event count, or the reason and the first bad event.

| Someone with the database file (but not the key) | Verify reports |
| --- | --- |
| Edits a row, for example an evidence note | `ROW_MISMATCH` at that row's event |
| Swaps two events | `CHAIN_BROKEN` |
| Deletes an event from the middle | `CHAIN_BROKEN`, naming the missing event |
| Changes an event and recomputes its hash without the key | `CHAIN_BROKEN` |
| Inserts a row with no event | `ORPHAN_ROW` with the row's id |

`npm run verify -- --db copy.db` runs the same check on a database file from the command line.

## API

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/health` | Server is up |
| `POST` | `/api/login` | Username and password in; a session token and the user out |
| `POST` | `/api/logout` | Deletes the session |
| `GET` | `/api/me` | The current user |
| `GET` | `/api/partners` | Partner names, for the "against whom" picker |
| `GET` | `/api/disputes` | Your disputes; all of them for the arbiter |
| `POST` | `/api/disputes` | Raise a dispute (partners) |
| `GET` | `/api/disputes/:id` | One dispute with its evidence; 404 if you are not a party |
| `POST` | `/api/disputes/:id/evidence` | Add an evidence note (the two parties, while open) |
| `POST` | `/api/disputes/:id/resolution` | Resolve the dispute (arbiter) |
| `GET` | `/api/disputes/:id/events` | The ledger events of one dispute |
| `GET` | `/api/ledger/verify` | Verify the whole ledger (arbiter) |

The token travels as `Authorization: Bearer <token>`. Errors have one shape: `{"error": {"code", "message"}}`.

## Tests

```bash
npm test && npm run typecheck
```
