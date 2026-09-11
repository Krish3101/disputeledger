# Dispute Ledger

A web app for tracking commercial disputes — damaged cargo, short shipments — between
supply chain partners, where the record of what happened can't be quietly altered.

Every change appends an event to a SHA-256 hash chain, with each event's hash covering the
one before it. Editing a row directly in SQLite breaks the chain, and the integrity check
reports which event was tampered with.

## What the chain proves, and what it doesn't

Worth being clear about this up front, because it is easy to oversell.

It shows the ledger has not been edited after the fact. Each event's hash covers the
previous event's hash, so changing anything in the middle invalidates every event after it,
and recomputing the chain finds exactly where.

It does not make anyone honest. The app writes the chain itself, so whoever can run the app
can append whatever they like at the time. This catches tampering with history; it does
nothing about a lie recorded truthfully.

There is no blockchain here and no distributed consensus — it is one SQLite file with a
verifiable append-only log over it.

## Catching a tamper

With the server running, edit the database underneath it:

```bash
sqlite3 dispute.db "UPDATE evidence SET notes='never happened' WHERE id=(SELECT id FROM evidence LIMIT 1);"
```

Then click **Check Ledger Integrity**. It recomputes the chain and names the event that no
longer matches.

Each state change writes its event inside the same SQLite transaction as the change itself,
so the ledger can't drift from the data it describes.

## The four roles

Seeded accounts, password `password123` for all of them:

| user | role | acting as |
|---|---|---|
| `supplier` | partner | Sam Ortiz, Northwind Supply |
| `buyer` | partner | Dana Reyes, Acme Retail |
| `carrier` | partner | Chris Vance, Pacific Freight |
| `arbiter` | arbiter | Ari Lund, Meridian Arbitration |

Log in as `supplier`, raise a dispute against Dana Reyes, and add an evidence note. Log in
as `buyer` and add counter-evidence. Log in as `carrier` — the dispute isn't in the list,
and opening its URL gives a 404 rather than a 403, so an uninvolved partner can't even
confirm it exists. Log in as `arbiter` and record a ruling; the dispute moves to `RESOLVED`
and stops accepting evidence.

A dispute goes `OPEN` once and `RESOLVED` once. Only an arbiter can close it, and nothing
can be added afterwards.

Passwords use `scrypt` from `node:crypto` and are compared with `timingSafeEqual`, so a
wrong password and an unknown username take the same time to reject.

## Running it

Needs Node.js 20 or newer.

```bash
./scripts/start.sh
```

That installs dependencies if needed, seeds the database, and starts the server at
http://localhost:3000. To do it by hand:

```bash
npm install
npm run seed     # 4 users, 2 disputes
npm run dev
npm test
```

`npm run reset` wipes and reseeds.

TypeScript runs directly through `tsx` with no build step, and the frontend is plain HTML,
CSS and ES modules, so there's no bundler either.

```
src/
  domain.ts     dispute rules and error types, no I/O
  audit.ts      hash chain and integrity verification
  auth.ts       scrypt hashing, session tokens
  db.ts         SQLite schema and indices
  disputes.ts   queries and dispute operations
  routes.ts     endpoints and Zod validation
  app.ts        builds the Express app (exported so tests can drive it)
  main.ts       starts the server, handles shutdown
public/         single-page frontend
tests/          domain rules and API tests
```

## Still missing

Evidence is text notes only. The walkthrough talks about photos of water ingress, but
there's no file upload — you describe the photo rather than attach it, which is the main
thing I'd add next.

## License

[MIT](LICENSE)
