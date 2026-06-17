# Inter-Organizational Supply Chain Dispute Resolution (Version 2)

This repository is a modern, enterprise-grade evolution of a Hyperledger Fabric application. It shifts the domain from a generic civic complaint box to a **B2B Supply Chain Consortium Network**, allowing multiple mutually distrusting organizations (Suppliers, Retailers, and Arbiters) to immutably track, manage, and adjudicate shipment and order disputes.

## V2 Modernization Highlights
* **Modern Fabric Gateway SDK:** Upgraded from the deprecated legacy SDK to the modern `@hyperledger/fabric-gateway` gRPC client, shifting the endorsement gathering workload from the Express server back to the Fabric peers.
* **Deterministic Chaincode:** Solved consensus errors by replacing native JavaScript timestamps (`Date.now()`) with Fabric's deterministic consensus timestamps (`ctx.stub.getTxTimestamp()`).
* **Robust Security:** Implemented `helmet`, `express-rate-limit`, strict API input sanitization, and secure JWT identity mapping.
* **UX & Ledger Optimization:** Replaced ugly Base64 X.509 strings with clean usernames on-chain (`hf.EnrollmentID`) and implemented ledger pagination for large dataset retrieval.

---

## Complete Setup from Scratch

To run this project, you must first set up a local Hyperledger Fabric blockchain network.

### 1. Prerequisites
Ensure you have the following installed on your machine (macOS/Linux/Windows WSL):
* **Docker Desktop** (or **OrbStack** for Mac users) running in the background.
* **Node.js** (v18+ recommended) and `npm`.
* **Git** and **cURL**.

### 2. Install Hyperledger Fabric
Open a new terminal and navigate to your home directory to install the Fabric Docker images and the `fabric-samples` repository:
```bash
cd ~
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
bash ./install-fabric.sh docker samples binary
```

### 3. Start the Blockchain Network
Navigate into the newly downloaded test network folder, clean up any old containers, and start a fresh network with Certificate Authorities (CA):
```bash
cd ~/fabric-samples/test-network
./network.sh down
./network.sh up createChannel -c mychannel -ca
```

### 4. Deploy the Chaincode
While still in the `test-network` directory, deploy the `dispute` smart contract from this repository to the blockchain. *(Replace `~/Workspace/cr/v2-supply-chain-dispute-resolution` with your actual path if different).*
```bash
./network.sh deployCC -ccn dispute -ccp ~/Workspace/cr/v2-supply-chain-dispute-resolution/chaincode -ccl javascript
```

### 5. Start the Node.js Backend
Open a **new terminal tab** and navigate to the backend folder of this project:
```bash
cd ~/Workspace/cr/v2-supply-chain-dispute-resolution/backend
npm install
```

Configure your environment variables:
```bash
cp ../.env.example ../.env
```
*(Open `.env` and ensure `FABRIC_NETWORK_BASE_DIR` points to your `fabric-samples/test-network` installation. Also note that the server runs on `PORT=3001` to avoid clashing with V1).*

Start the server:
```bash
npm start
```

### 6. Access the Application
Open your web browser to:
**[http://localhost:3001](http://localhost:3001)**

---

## API Overview
Authentication is required for all dispute routes. A valid JWT must be passed in the `Authorization: Bearer <token>` header.

| Method | Endpoint | Description | Role Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Register a new Fabric user | None |
| `POST` | `/api/auth/login` | Authenticate and receive a JWT | None |
| `GET` | `/api/disputes` | List all disputes (Paginated) | Any (`partner`/`arbiter`) |
| `POST` | `/api/disputes` | Raise a new dispute | `partner` |
| `PATCH`| `/api/disputes/:id/evidence`| Add evidence notes to a dispute | `partner` |
| `PATCH`| `/api/disputes/:id/resolve` | Adjudicate and close a dispute | `arbiter` |

---

## Security & Architecture Details
* **Ledger RBAC**: Security is defense-in-depth. The Express API ensures basic input validation, but the ultimate source of truth is enforced at the smart contract level using the invoker's X.509 certificate attributes, guaranteeing that the API cannot bypass the Arbiter-only resolution constraint.
* **Custodial Wallet Pattern**: For this portfolio scope, having the Express server hold the certificates drastically improved the UX while maintaining ledger-level security. In a strict production environment, this would be swapped for an HSM or browser-based offline signing extension.