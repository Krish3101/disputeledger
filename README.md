# Complaint Management System (Version 1)

This repository contains the foundational **Version 1** of a blockchain-based Complaint Management System. It was originally built as a project to demonstrate core Hyperledger Fabric concepts such as chaincode implementation, Certificate Authority (CA) user enrollment, and Role-Based Access Control (RBAC).

## Architecture Overview
The system implements a classic 3-tier architecture:
1. **Frontend**: A vanilla HTML/JS Single Page Application (SPA).
2. **Backend**: An Express.js REST API serving as middleware. It uses a **Custodial Wallet Pattern**, where the server securely holds the users' X.509 Fabric certificates and signs transactions on their behalf using the legacy `fabric-network` SDK.
3. **Blockchain**: A Hyperledger Fabric `ComplaintContract` smart contract enforcing the core business logic.

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
While still in the `test-network` directory, deploy the `complaint` smart contract from this repository to the blockchain. *(Replace `~/Workspace/cr/complaint-system-main` with your actual path if different).*
```bash
./network.sh deployCC -ccn complaint -ccp ~/Workspace/cr/complaint-system-main/chaincode -ccl javascript
```

### 5. Start the Node.js Backend
Open a **new terminal tab** and navigate to the backend folder of this project:
```bash
cd ~/Workspace/cr/complaint-system-main/backend
npm install
```

Configure your environment variables:
```bash
cp ../.env.example ../.env
```
*(Open `.env` and ensure `CCP_PATH` points accurately to `~/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/connection-org1.json` if you installed Fabric somewhere else).*

Start the server:
```bash
npm start
```

### 6. Access the Application
Open your web browser to:
**[http://localhost:3000](http://localhost:3000)**

---

## API Overview
Authentication is handled via JWT. Obtain a token by registering and logging in, then pass it as `Authorization: Bearer <token>`.

* `POST /users/register` - Registers a user with the CA (requires `userId` and `role`).
* `POST /users/login` - Returns a JWT for API access.
* `POST /complaints` - Creates a new complaint.
* `GET /complaints` - Fetches all complaints from the ledger.
* `PATCH /complaints/:id/resolve` - Resolves a complaint (Authority only).

---

## Historical Context & Limitations
As Version 1, this project demonstrates initial architectural decisions and has known limitations that set the stage for V2:
* **Legacy SDK:** Relies on the deprecated `fabric-network` SDK rather than the modern `@hyperledger/fabric-gateway`.
* **State Parsing Risks:** Ledger retrieval (`GetAllComplaints`) pulls all records into memory at once without pagination.
* **Basic Identity Management:** Uses a monolithic Express server to custody all keys, trading true blockchain non-repudiation for frontend UX simplicity.