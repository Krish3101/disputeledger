# Supply Chain Dispute Ledger

A decentralized B2B dispute resolution system built on Hyperledger Fabric, Node.js, and Vanilla JS. 

Instead of relying on a central database, this app lets supply chain partners (like suppliers and retailers) raise shipment disputes, upload evidence, and have arbiters resolve them on an immutable blockchain ledger. Smart contracts enforce the rules (e.g., only arbiters can resolve disputes).

## Tech Stack
- **Smart Contracts:** Hyperledger Fabric (Node.js/JavaScript)
- **Backend:** Express.js + Fabric Gateway gRPC API
- **Frontend:** HTML, CSS, Vanilla JS
- **Security:** JWT Authentication, Role-Based Access Control (RBAC)

---

## How to Run Locally

You need Docker, Node.js (v18+), and Git installed.

### 1. Start the Blockchain Network
You need a local Hyperledger Fabric test network to run this.
```bash
# Download the Fabric tools
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
bash ./install-fabric.sh docker samples binary

# Start the network with Certificate Authorities (CA)
cd fabric-samples/test-network
./network.sh down
./network.sh up createChannel -c mychannel -ca
```

### 2. Deploy the Smart Contract
Point the network to the `chaincode` folder in this project to deploy the contract. *(Replace the path below with your actual project path).*
```bash
./network.sh deployCC -ccn dispute -ccp /path/to/your/project/chaincode -ccl javascript
```

### 3. Start the Backend & UI
Open a new terminal tab in the `backend` folder of this project:
```bash
cd backend
npm install
npm start
```

### 4. Use the App
Open your browser to `http://localhost:3000`. 
1. Register a user with the role `partner` to raise disputes.
2. Register a user with the role `arbiter` to resolve them.
