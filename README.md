# Supply Chain Dispute Ledger

A decentralized B2B dispute resolution system built on Hyperledger Fabric, Node.js Express, and Vanilla JavaScript that enables supply chain partners (suppliers, logistics providers, retailers) and independent arbiters to record, track, and adjudicate shipment and purchase order disputes on an immutable distributed ledger.

---

## One-Paragraph Summary

The Supply Chain Dispute Ledger is a permissioned blockchain solution designed to resolve inter-organizational B2B disagreements—such as damaged shipments, missing inventory, or delivery delays—without reliance on a centralized dispute database. Commercial organizations register identities with a Hyperledger Fabric Certificate Authority (CA) embedding cryptographic role attributes (`partner` or `arbiter`). An Express REST API validates inputs and dispatches transactions over gRPC through the modern Fabric Gateway client. Smart contract chaincode deterministically enforces access control directly on the ledger: supply chain partners can raise disputes against purchase orders and append chronological evidence notes, while neutral arbiters possess exclusive authorization to resolve disputes with legally binding adjudication notes.

---

## Architecture Overview

The system follows a decoupled 3-tier enterprise architecture separating smart contract governance, gateway proxy orchestration, and client presentation:

```
┌─────────────────────────────────────────────────────────────┐
│                   Frontend Client (Browser)                 │
│      Vanilla HTML5 / ES6 JavaScript / CSS (No Bundler)      │
│  - Programmatic DOM building (XSS-safe textContent)         │
│  - CSP-compliant event handling (zero inline scripts)       │
│  - Role-gated UI controls (partner vs. arbiter actions)     │
└───────────────────────────────┬─────────────────────────────┘
                                │ HTTP / JSON (Bearer JWT)
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                 Backend API Gateway (Node.js)               │
│              Express.js + Modern Fabric Gateway             │
│  - Security: Helmet (Strict CSP), Express Rate Limiting     │
│  - Auth: JWT session management & FileSystemWallet custody  │
│  - CA Client: Dynamic identity enrollment & X.509 certs     │
│  - Gateway: gRPC connection pooling & peer transaction eval │
│  - Error Normalization: Domain error prefixes to HTTP codes │
└───────────────────────────────┬─────────────────────────────┘
                                │ gRPC over TLS (Peer Endpoint)
                                ▼
┌─────────────────────────────────────────────────────────────┐
│              Hyperledger Fabric Network (v2.5+)             │
│   Channel: `mychannel` | Chaincode: `dispute` (Node.js)     │
│  - State Storage: LevelDB key-value records keyed by ID     │
│  - RBAC: Hardware/CA-signed X.509 `role` attribute checks   │
│  - Dispute Lifecycle: PENDING -> Evidence Appended -> RESOLVED
│  - State Queries: Paginated range queries with bookmarks    │
└─────────────────────────────────────────────────────────────┘
```

### 1. Smart Contract Layer (`chaincode/contract.js`)

- **Data Model**: Disputes are persisted in the ledger state keyed by a unique dispute identifier. Each record tracks:
  - `id`: Unique dispute ID (alphanumeric, max 100 chars).
  - `orderReference`: External purchase order or tracking reference (max 100 chars).
  - `description`: Partner statement of the dispute issue (max 1000 chars).
  - `status`: Current dispute state (`PENDING` or `RESOLVED`).
  - `raisedBy`: Client identity ID / Fabric CA enrollment ID of the initiating partner.
  - `createdAt`: Deterministic transaction timestamp generated from the peer proposal.
  - `evidence`: Array of chronological evidence items, each capturing `submittedBy`, `notes` (max 1000 chars), and `timestamp`.
  - `resolutionNote`: Final decision summary recorded by the arbiter (max 1000 chars).
  - `resolvedBy`: Client identity ID / Fabric CA enrollment ID of the adjudicating arbiter.
  - `resolvedAt`: Timestamp of the adjudication transaction.
- **On-Chain RBAC Enforcement**: Role verification is performed inside the chaincode sandbox using `ctx.clientIdentity.getAttributeValue('role')`. Only callers with `role === 'partner'` can invoke `RaiseDispute` and `AddEvidence`. Only callers with `role === 'arbiter'` can invoke `AdjudicateDispute`. Neither the client nor the intermediary server can forge these permissions, as they are cryptographically anchored to the caller's X.509 certificate issued by the Fabric CA.
- **State Machine Invariants**:
  - Duplicate dispute IDs are rejected (`CONFLICT`).
  - Evidence cannot be appended to an already `RESOLVED` dispute.
  - A dispute cannot be adjudicated more than once.
- **Range Pagination**: `GetAllDisputes` uses Fabric's `getStateByRangeWithPagination` API to retrieve paginated records alongside query bookmarks, preventing memory exhaustion when reading large ledgers.

### 2. Backend Gateway Layer (`backend/server.js`, `backend/fabric.js`)

- **REST API Endpoints**: Exposes clean JSON endpoints (`/api/auth/register`, `/api/auth/login`, `/api/disputes`, `/api/disputes/:id/evidence`, `/api/disputes/:id/resolve`).
- **Fabric Gateway Integration**: Uses `@hyperledger/fabric-gateway` and `@grpc/grpc-js` (the modern Fabric Gateway client SDK) instead of legacy network libraries. It establishes TLS-secured gRPC connections to peer endpoints and caches gateway connections per user identity.
- **Identity Management & CA Enrollment**: Utilizes `fabric-ca-client` to enroll an administrative identity (`admin`) and register individual user credentials into a local file-system wallet (`backend/wallet/`). Certificates are issued with custom certificate attributes (`attrs: [{ name: 'role', value: role, ecert: true }]`).
- **Session Management**: Authenticates users with JSON Web Tokens (`jsonwebtoken`) with a 2-hour expiration. The backend maps authenticated user identities (`req.user`) directly to their corresponding wallet credentials for transaction signing.
- **Security Middleware & Hardening**:
  - **Helmet**: Enforces HTTP security headers and a strict Content Security Policy (`scriptSrc: ["'self'"]`).
  - **Rate Limiting**: Throttles incoming client requests (100 requests per 15-minute window).
  - **Input Validation**: Sanitizes and enforces alphanumeric constraints on identifiers (`validateId`) and string length limits (`validateText`).
  - **Error Mapping**: Translates chaincode domain error prefixes (`ACCESS_DENIED:`, `CONFLICT:`, `VALIDATION:`, `NOT_FOUND:`) into standard HTTP status codes (`403`, `400`, `404`, `500`).

### 3. Frontend Presentation Layer (`frontend/`)

- **Lightweight Vanilla Architecture**: Built with pure HTML5, CSS3, and modern ES6+ JavaScript. No bundlers, Webpack, or framework runtimes required.
- **Defense-in-Depth XSS Protection**: Dispute cards and evidence timelines are rendered programmatically via `document.createElement()` and `textContent` assignments, preventing stored script injection from untrusted ledger data.
- **Strict CSP Compliance**: All UI actions are wired via standard DOM event listeners (`addEventListener`) rather than inline `onclick` attributes, allowing the server to disallow `'unsafe-inline'` script execution.
- **Role-Aware UI Gating**: Conditionally hides action triggers (e.g., hiding evidence buttons from arbiters and resolution buttons from partners) based on the login profile, complementing on-chain rule enforcement.

---

## Tech Stack & Architectural Rationale

| Component              | Technology                                           | Rationale                                                                                                                                                                                                              |
| :--------------------- | :--------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Distributed Ledger** | Hyperledger Fabric (v2.5+)                           | Enterprise B2B supply chains require permissioned consortium governance, known identities, deterministic consensus without transaction gas fees, and immediate finality without blockchain reorgs.                     |
| **Smart Contracts**    | Fabric Contract API (`fabric-contract-api`, Node.js) | Allows idiomatic JavaScript contract development while maintaining language parity with the backend and unit tests. Runs inside isolated Docker chaincode containers.                                                  |
| **Blockchain Gateway** | `@hyperledger/fabric-gateway` & `@grpc/grpc-js`      | The modern Fabric Gateway client shifts transaction endorsement collection, discovery, and commit event monitoring to the peer Gateway service, dramatically reducing backend memory overhead compared to legacy SDKs. |
| **Backend Framework**  | Node.js & Express.js (ES Modules)                    | Lightweight, asynchronous HTTP routing layer ideal for proxying REST API calls to gRPC gateway transactions with minimal latency.                                                                                      |
| **Identity & PKI**     | `fabric-ca-client` & FileSystemWallet                | Standard Fabric CA client for automated user enrollment, issuing X.509 digital certificates with embedded cryptographic attributes (`role`) stored in a secure local wallet directory.                                 |
| **Session Security**   | `jsonwebtoken` (JWT)                                 | Provides stateless bearer-token session authorization for the web frontend without exposing raw private keys or cryptographic certificates to the browser runtime.                                                     |
| **API Defense**        | `helmet` & `express-rate-limit`                      | Protects the Express API against cross-site scripting (CSP header lockdown) and mitigates denial-of-service or credential brute-forcing via rate limiting.                                                             |
| **Frontend**           | Vanilla HTML5 / CSS3 / ES6 JavaScript                | Zero external build dependencies eliminates frontend supply-chain vulnerabilities, guarantees instant page loads, and makes the application straightforward to audit and inspect.                                      |
| **Unit Testing**       | Jest (`@jest/globals`)                               | Executes isolated unit tests for the smart contract using mocked Fabric transaction stubs and client contexts without requiring a running Dockerized Fabric network.                                                   |

---

## How to Run Locally

### Prerequisites

- **Docker Desktop** (running and configured with adequate memory, minimum 4GB recommended)
- **Node.js** (v18.x or v20.x LTS) & **npm**
- **Git** and **cURL**

---

### Step 1: Install Hyperledger Fabric Samples & Binaries

If you do not already have the Fabric test network installed on your machine, download the Fabric Docker images and platform binaries into a sibling directory:

```bash
# Clone or download the Fabric sample scripts
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh docker samples binary
```

---

### Step 2: Start the Fabric Test Network with CA Enabled

The dispute ledger requires Certificate Authorities to issue cryptographically signed X.509 role attributes:

```bash
# Navigate to the test-network directory inside fabric-samples
cd fabric-samples/test-network

# Shut down any previous network containers
./network.sh down

# Bring up the network, create the default channel ('mychannel'), and start Org CAs
./network.sh up createChannel -c mychannel -ca
```

---

### Step 3: Deploy the Dispute Smart Contract

Deploy the chaincode located in this project's `chaincode` directory to the running network. Run this command from inside the `fabric-samples/test-network` directory, providing the absolute path to the `chaincode` folder:

```bash
# Run from inside the fabric-samples/test-network directory:
# (Substitute your actual repository path, e.g. using pwd from the repo root)
./network.sh deployCC \
  -ccn dispute \
  -ccp "/absolute/path/to/complaint-system-main/chaincode" \
  -ccl javascript

# Example if fabric-samples is placed in your home directory (~/fabric-samples):
# ./network.sh deployCC -ccn dispute -ccp "$HOME/path/to/complaint-system-main/chaincode" -ccl javascript
```

---

### Step 4: Configure Environment Variables

Return to this repository's root directory and create a `.env` file based on `.env.example`:

```bash
# In the complaint-system-main root directory:
cp .env.example .env
```

Review and adjust the environment variables in `.env`:

| Variable                  | Description                                             | Default / Example                                          |
| :------------------------ | :------------------------------------------------------ | :--------------------------------------------------------- |
| `PORT`                    | Local port for the Express REST API and static frontend | `3000`                                                     |
| `FABRIC_NETWORK_BASE_DIR` | Absolute path to `fabric-samples/test-network`          | `/path/to/fabric-samples/test-network`                     |
| `WALLET_PATH`             | Directory where enrolled X.509 identities are stored    | `./wallet` (relative to `backend/`)                        |
| `CHANNEL_NAME`            | Fabric channel where chaincode is deployed              | `mychannel`                                                |
| `CHAINCODE_NAME`          | Deployed smart contract name                            | `dispute`                                                  |
| `MSP_ID`                  | Membership Service Provider identifier                  | `Org1MSP`                                                  |
| `PEER_ENDPOINT`           | gRPC address of the target Fabric peer node             | `localhost:7051`                                           |
| `PEER_HOST_ALIAS`         | TLS hostname override for the peer's certificate        | `peer0.org1.example.com`                                   |
| `JWT_SECRET`              | Secret key used for signing session JWTs                | `your-jwt-secret-keep-this-secure-min-32-chars`            |
| `CA_ADMIN_NAME`           | Fabric CA admin enrollment username                     | `admin`                                                    |
| `CA_ADMIN_SECRET`         | Fabric CA admin enrollment secret                       | `adminpw`                                                  |
| `CCP_PATH` _(Optional)_   | Explicit path to `connection-org1.json`                 | Defaults to `${FABRIC_NETWORK_BASE_DIR}/organizations/...` |

---

### Step 5: Install Dependencies & Run Tests

```bash
# 1. Install root workspace dependencies
npm install

# 2. Run chaincode unit tests (validates RBAC, state rules, error codes)
npm test

# 3. Install backend dependencies
cd backend
npm install
cd ..
```

---

### Step 6: Start the Application

From the `backend` directory:

```bash
cd backend
npm start
```

For automatic server reload during development:

```bash
npm run dev
```

The server will initialize, automatically enroll the CA `admin` identity into `backend/wallet/`, and begin listening on `http://localhost:3000`.

---

### Step 7: Verify via Web Interface

Open your browser to **`http://localhost:3000`**:

1. **Register a Partner**:
   - Username: `supplier1`
   - Role: `partner`
   - Click **Register**, then click **Login**.
2. **Raise a Dispute**:
   - Dispute ID: `D-101`
   - Order Ref: `PO-8834`
   - Description: `Consignment arrived with damaged outer packaging and 10 missing items.`
   - Click **Submit to Ledger**.
3. **Add Evidence Notes**:
   - Dispute ID: `D-101`
   - Evidence Notes: `Attached warehouse intake log #WH-442 noting missing seal on container.`
   - Click **Add Evidence**.
4. **Log Out & Register an Arbiter**:
   - Click **Logout**.
   - Username: `arbiter1`
   - Role: `arbiter`
   - Click **Register**, then click **Login**.
5. **Adjudicate Dispute**:
   - Notice that as an arbiter, the "Add Evidence" button is hidden.
   - Dispute ID: `D-101`
   - Notes: `Inspection verified carrier seal breach. Supplier awarded full credit refund of $4,200.`
   - Click **Adjudicate (Arbiter)**.
   - The dispute badge updates to `RESOLVED` with the adjudication note and arbiter ID recorded on-chain.

---

## REST API Reference

All dispute endpoints (`/api/disputes*`) require session authentication. Pass the JWT token returned by `/api/auth/login` in the HTTP header:

```http
Authorization: Bearer <your_jwt_token>
```

### Authentication Endpoints

#### 1. Register Identity

- **Method / Path:** `POST /api/auth/register`
- **Role Required:** None (Public)
- **Request Body:**
  ```json
  {
    "username": "supplier1",
    "role": "partner"
  }
  ```
  _(Role must be either `"partner"` or `"arbiter"`)_
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "User supplier1 successfully registered with role partner"
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: `{"error": "Role must be partner or arbiter"}`
  - `400 Bad Request`: `{"error": "CONFLICT: User supplier1 already exists"}`
  - `400 Bad Request`: `{"error": "VALIDATION: Username can only contain alphanumeric characters, dashes, and underscores"}`
  - `503 Service Unavailable`: `{"error": "Fabric connection profile not found at: ... Please ensure your Fabric network is running..."}`

#### 2. User Login

- **Method / Path:** `POST /api/auth/login`
- **Role Required:** None (Public)
- **Request Body:**
  ```json
  {
    "username": "supplier1"
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "username": "supplier1",
    "role": "partner"
  }
  ```
- **Error Response:**
  - `401 Unauthorized`: `{"error": "User not found. Please register first."}`

---

### Dispute Management Endpoints

#### 3. List All Disputes

- **Method / Path:** `GET /api/disputes`
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:**
  - `pageSize` _(optional, default: `100`)_: Maximum records per page.
  - `bookmark` _(optional)_: Cursor bookmark for fetching the next page.
- **Role Required:** Any authenticated role (`partner` or `arbiter`)
- **Success Response (`200 OK`):**
  ```json
  {
    "records": [
      {
        "id": "D-101",
        "orderReference": "PO-8834",
        "description": "Consignment arrived with damaged outer packaging.",
        "status": "PENDING",
        "raisedBy": "supplier1",
        "evidence": [
          {
            "submittedBy": "supplier1",
            "notes": "Attached warehouse intake log #WH-442 noting missing seal.",
            "timestamp": "2026-09-08T10:32:00.000Z"
          }
        ],
        "resolutionNote": "",
        "resolvedBy": "",
        "createdAt": "2026-09-08T10:30:00.000Z"
      }
    ],
    "bookmark": ""
  }
  ```
- **Error Response:**
  - `401 Unauthorized`: `{"error": "Missing or invalid Authorization header"}`

#### 4. Raise New Dispute

- **Method / Path:** `POST /api/disputes`
- **Headers:** `Authorization: Bearer <token>`
- **Role Required:** `partner` _(Enforced on-chain via CA certificate attribute)_
- **Request Body:**
  ```json
  {
    "disputeId": "D-101",
    "orderReference": "PO-8834",
    "description": "Consignment arrived with damaged outer packaging and 10 missing items."
  }
  ```
- **Success Response (`201 Created`):** Returns the newly created dispute object with `"status": "PENDING"`.
- **Error Responses:**
  - `403 Forbidden`: `{"error": "ACCESS_DENIED: only identities with the \"partner\" role can perform this action."}`
  - `400 Bad Request`: `{"error": "CONFLICT: The dispute D-101 already exists"}`
  - `400 Bad Request`: `{"error": "VALIDATION: Dispute ID must be between 1 and 100 characters"}`

#### 5. Add Evidence Notes

- **Method / Path:** `PATCH /api/disputes/:id/evidence`
- **Headers:** `Authorization: Bearer <token>`
- **Role Required:** `partner` _(Enforced on-chain)_
- **Request Body:**
  ```json
  {
    "notes": "Attached warehouse intake log #WH-442 noting missing seal on container."
  }
  ```
- **Success Response (`200 OK`):** Returns the updated dispute object with the new evidence item appended to the `evidence` array.
- **Error Responses:**
  - `403 Forbidden`: `{"error": "ACCESS_DENIED: only identities with the \"partner\" role can perform this action."}`
  - `400 Bad Request`: `{"error": "CONFLICT: Cannot add evidence to a resolved dispute."}`
  - `404 Not Found`: `{"error": "NOT_FOUND: The dispute D-101 does not exist"}`

#### 6. Adjudicate & Resolve Dispute

- **Method / Path:** `PATCH /api/disputes/:id/resolve`
- **Headers:** `Authorization: Bearer <token>`
- **Role Required:** `arbiter` _(Enforced on-chain)_
- **Request Body:**
  ```json
  {
    "resolutionNote": "Inspection verified carrier seal breach. Supplier awarded full credit refund of $4,200."
  }
  ```
- **Success Response (`200 OK`):** Returns the updated dispute object with `"status": "RESOLVED"`, `"resolvedBy": "arbiter1"`, `"resolvedAt": "<ISO-8601>"`, and `"resolutionNote"`.
- **Error Responses:**
  - `403 Forbidden`: `{"error": "ACCESS_DENIED: only identities with the \"arbiter\" role can adjudicate disputes."}`
  - `400 Bad Request`: `{"error": "CONFLICT: Dispute is already resolved."}`
  - `404 Not Found`: `{"error": "NOT_FOUND: The dispute D-101 does not exist"}`

---

## Production Deployment Guide

To deploy this solution to a cloud server or virtual private server (e.g., AWS EC2, GCP Compute Engine, Azure VM):

1. **Host Prerequisites**: Provision an Ubuntu 22.04 LTS instance with minimum 4GB RAM, Docker, Docker Compose, and Node.js 18+.
2. **Launch Fabric Network**: Clone or copy `fabric-samples` and run `./network.sh up createChannel -c mychannel -ca`.
3. **Deploy Chaincode**: Deploy the `chaincode/` directory using `./network.sh deployCC`.
4. **Configure Environment**: Set `FABRIC_NETWORK_BASE_DIR`, production `JWT_SECRET`, and `PORT` in `.env`.
5. **Reverse Proxy with TLS**: Run Nginx or Caddy in front of Express (port `3000`) terminating HTTPS with Let's Encrypt certificates.
6. **Daemonize Backend**: Manage the Node.js process using PM2:
   ```bash
   cd backend
   npm install -g pm2
   pm2 start server.js --name "dispute-ledger-api"
   pm2 save
   ```

---

## Future Scope

The current implementation deliberately scopes features to uphold clean architectural boundaries, deterministic ledger execution, and verifiable access control. The following areas represent intentional scoping trade-offs:

### 1. Off-Chain Binary Storage with Cryptographic Anchors vs. In-Ledger Bloat

- **Current State**: Evidence is limited to structured alphanumeric text notes (`evidenceNotes`, max 1000 characters) recorded directly on-chain.
- **Trade-off & Scope**: Storing raw binary files (such as high-resolution damage photographs, scanned bills of lading, or PDF inspection certificates) directly within Hyperledger Fabric's state database (LevelDB/CouchDB) causes rapid ledger bloat, memory exhaustion, and slow peer block synchronization.
- **Production Path**: Integrate off-chain content-addressed storage (e.g., IPFS or private AWS S3 / Azure Blob Storage buckets with pre-signed URLs), storing only the document's SHA-256 cryptographic hash and URI pointer on-chain. The smart contract validates document authenticity without burdening peer storage.

### 2. Multi-Organization Endorsement Policies vs. Single-Org Dev Topology

- **Current State**: Transactions are executed against a single organization (`Org1MSP`) on `mychannel`.
- **Trade-off & Scope**: Configured for local development efficiency and low hardware consumption. In a production B2B consortium, dispute resolution involves multiple distinct legal entities (`SupplierMSP`, `RetailerMSP`, `CarrierMSP`, `AuditorMSP`).
- **Production Path**: Define an explicit Fabric endorsement policy (e.g., `AND('SupplierMSP.peer', 'RetailerMSP.peer')` for raising disputes, or `AND('ArbiterMSP.peer')` for adjudication) requiring endorsement signatures from multiple independent organization peers before committing to the ledger.

### 3. Private Data Collections (PDCs) vs. Channel-Wide Transparency

- **Current State**: All dispute records and purchase order references are visible to any authorized identity capable of querying the channel ledger.
- **Trade-off & Scope**: Channel-wide visibility simplifies ledger indexing and auditing for the demo. However, enterprise competitors sharing a channel often cannot expose commercial contract values, partner identities, or volume metrics to third parties.
- **Production Path**: Utilize Fabric Private Data Collections (PDCs) and transient data inputs to restrict sensitive commercial dispute details strictly to transacting counterparties and the assigned arbiter, committing only private data hashes to the shared channel ledger.

### 4. Client-Side Non-Custodial PKI vs. Server-Custodial Wallet

- **Current State**: The backend maintains a server-side `FileSystemWallet` containing user private keys and X.509 certificates, authenticating browser sessions via JWTs.
- **Trade-off & Scope**: Chosen to provide a seamless web UX without requiring users to install specialized browser extensions or manage raw `.pem` cryptographic key pairs. However, it requires the server to act as a custodial proxy.
- **Production Path**: Transition to client-side cryptographic signing using WebCrypto / WebAuthn, hardware security modules (HSMs), or client-side Fabric Gateway connections, allowing users to sign transactions directly in their own secure environment.

### 5. Deterministic Smart Contract Execution vs. Autonomous Escalation Oracles

- **Current State**: Disputes remain in `PENDING` status indefinitely until an arbiter submits an adjudication transaction.
- **Trade-off & Scope**: Smart contracts in distributed ledgers must remain strictly deterministic across all endorsing peers and cannot execute asynchronous timers, sleep commands, or background crons.
- **Production Path**: Implement an external worker service (oracle daemon) that monitors block events (`commitStatus` / event listeners) and triggers automated escalation or default settlements when a counterparty fails to respond within a pre-negotiated SLA window.
