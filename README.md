# Supply Chain Dispute Ledger

A shared, append-only dispute resolution system on Hyperledger Fabric. Supply chain partners raise disputes and add evidence; arbiters review and resolve them. All actions are attributed, timestamped, and preserved on an immutable ledger with role-based access enforced on-chain.

## Architecture

```
frontend/  (Vanilla HTML/JS/CSS, served by Express)
    │  HTTP/JSON + Bearer JWT
    ▼
backend/   (Express REST API → Fabric Gateway over gRPC)
    │  gRPC over TLS
    ▼
chaincode/ (Fabric smart contract — all RBAC + lifecycle rules)
```

- **Chaincode** (`chaincode/contract.js`): Disputes keyed by ID in ledger state. RBAC enforced via X.509 certificate `role` attribute. Lifecycle: `PENDING → RESOLVED`. Paginated range queries.
- **Backend** (`backend/server.js`, `backend/fabric.js`): Express routes, JWT session auth, Fabric CA enrollment, input validation, error mapping (chaincode prefixes → HTTP status codes). Two Fabric SDKs coexist: `fabric-network` for wallet/CA, `@hyperledger/fabric-gateway` for transactions.
- **Frontend** (`frontend/`): Vanilla JS, XSS-safe DOM rendering (`textContent`), CSP-compliant event listeners, role-gated UI, paginated dispute listing.

## Prerequisites

- Docker Desktop (4GB+ memory)
- Node.js ≥ 18 & npm
- Hyperledger Fabric test network with CAs

## Setup

### 1. Start Fabric Network

```bash
cd fabric-samples/test-network
./network.sh down
./network.sh up createChannel -c mychannel -ca
```

### 2. Deploy Chaincode

```bash
# From fabric-samples/test-network:
./network.sh deployCC -ccn dispute -ccp "/path/to/dispute-ledger/chaincode" -ccl javascript
```

### 3. Configure & Install

```bash
# From project root:
cp .env.example .env          # Edit FABRIC_NETWORK_BASE_DIR and JWT_SECRET
npm install                    # Root: lint/format tooling
npm install --prefix backend
npm install --prefix chaincode
```

### 4. Run

```bash
cd backend && npm start        # http://localhost:3000
# or: npm run dev              # auto-reload
```

### 5. Test

```bash
npm test                       # Runs chaincode (Jest) + backend (node:test) suites
npm run lint                   # ESLint
npm run format:check           # Prettier
```

## Environment Variables

| Variable                  | Default                        | Description                           |
| :------------------------ | :----------------------------- | :------------------------------------ |
| `PORT`                    | `3000`                         | Express server port                   |
| `FABRIC_NETWORK_BASE_DIR` | auto-detected                  | Path to `fabric-samples/test-network` |
| `CHANNEL_NAME`            | `mychannel`                    | Fabric channel                        |
| `CHAINCODE_NAME`          | `dispute`                      | Deployed chaincode name               |
| `MSP_ID`                  | `Org1MSP`                      | Membership service provider           |
| `PEER_ENDPOINT`           | `localhost:7051`               | gRPC peer address                     |
| `JWT_SECRET`              | dev default (warns at startup) | JWT signing secret                    |

See [`.env.example`](.env.example) for the full list.

## API Reference

All `/api/disputes*` endpoints require `Authorization: Bearer <token>`.

### Auth

| Method | Path                 | Body                 | Response                    |
| :----- | :------------------- | :------------------- | :-------------------------- |
| POST   | `/api/auth/register` | `{ username, role }` | `{ message }`               |
| POST   | `/api/auth/login`    | `{ username }`       | `{ token, username, role }` |

`role` must be `"partner"` or `"arbiter"`.

### Disputes

| Method | Path                         | Body / Query                                 | Description                    |
| :----- | :--------------------------- | :------------------------------------------- | :----------------------------- |
| GET    | `/api/disputes`              | `?pageSize=10&bookmark=...`                  | List disputes (paginated)      |
| GET    | `/api/disputes/:id`          | —                                            | View single dispute            |
| POST   | `/api/disputes`              | `{ disputeId, orderReference, description }` | Raise dispute (partner only)   |
| PATCH  | `/api/disputes/:id/evidence` | `{ notes }`                                  | Add evidence (partner only)    |
| PATCH  | `/api/disputes/:id/resolve`  | `{ resolutionNote }`                         | Resolve dispute (arbiter only) |

### Error Prefixes

Chaincode errors map to HTTP status codes:

| Prefix          | HTTP Status |
| :-------------- | :---------- |
| `ACCESS_DENIED` | 403         |
| `CONFLICT`      | 400         |
| `VALIDATION`    | 400         |
| `NOT_FOUND`     | 404         |
| Network failure | 503 / 504   |

## Quick Walkthrough

1. Register `supplier1` as `partner` → Login
2. Raise dispute `D-101` against order `PO-8834`
3. Add evidence notes
4. Logout → Register `arbiter1` as `arbiter` → Login
5. Adjudicate dispute `D-101` → Status becomes `RESOLVED`

All actions are recorded with actor identity and timestamp on the immutable ledger.
