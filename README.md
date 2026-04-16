# Complaint Management on Hyperledger Fabric

A production-ready complaint management system built on Hyperledger Fabric with role-based access control.

## 🚀 Features

- **Smart Contract (Chaincode)**: Node.js chaincode with role-based access control
- **REST API**: Express.js server with Gateway SDK integration
- **Dynamic User Management**: Register users on-demand with customizable roles
- **Role-Based Access Control**: Citizens can create/update complaints, authorities can resolve them
- **Web UI**: Modern single-page application for complete system management
- **Security**: Input validation, rate limiting, and helmet security headers
- **Flexible Architecture**: No hardcoded users - fully dynamic and scalable

---

## 📋 Prerequisites (WSL Ubuntu)

1. **Docker Desktop for Windows** (enable WSL 2 integration for your Ubuntu distro)
2. In WSL (Ubuntu), install tools:
   ```bash
   sudo apt update
   sudo apt install -y git jq curl make g++ python3 ca-certificates
   # If you use the Linux docker engine instead of Docker Desktop:
   # sudo apt install -y docker.io docker-compose-plugin
   ```
3. **Node.js 18+** in WSL (recommended):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt install -y nodejs
   node -v && npm -v
   ```

> If you saw `Permission denied` on `network.sh` earlier, run: `chmod +x ~/fabric-samples/test-network/network.sh` and always execute it from Bash.

---

## 🔧 Installation & Setup

### 1) Get Fabric samples & start the network (with CAs)

```bash
cd ~
git clone https://github.com/hyperledger/fabric-samples
cd fabric-samples/test-network

# Optional: download binaries & docker images if needed
# ./network.sh prereq

# Clean any previous run
./network.sh down

# Bring up with CAs and CouchDB, and create channel "mychannel"
./network.sh up -ca -s couchdb
./network.sh createChannel -c mychannel
```

> **Tip:** The flag `--remove-orphans` is for `docker compose`, not `network.sh`. Use `./network.sh down` to clean.

---

### 2) Add the chaincode

Copy the `chaincode/complaint-js` folder from this starter into your `fabric-samples` tree:

```bash
# In WSL
cp -r /mnt/data/complaint-fabric-starter/chaincode/complaint-js ~/fabric-samples/chaincode/complaint-js
```

Deploy it with the helper script:

```bash
cd ~/fabric-samples/test-network
./network.sh deployCC -c mychannel -ccn complaint -ccp ../chaincode/complaint-js -ccl javascript
```

This packages, installs, approves and commits the chaincode named `complaint` to `mychannel`.

---

### 3) Run the API + UI

Install and start the Express server (it will also serve the UI):

```bash
cd /mnt/data/complaint-fabric-starter/app

# Install dependencies
npm install

# Optional: Run pre-flight checks
npm run preflight

# Start the server
npm start
```

Open **http://localhost:3000** in your Windows or WSL browser.

The UI guides you through the complete workflow:

1. **Initialize System**: Click "Initialize Admin" to enroll the admin user
2. **Register Users**: Create users with either "Citizen" or "Authority" roles
   - Citizens can create and update complaints
   - Authorities can resolve complaints
3. **Manage Complaints**: Create, view, update, and resolve complaints
4. **Query System**: View all complaints or filter by status (OPEN/RESOLVED)

Example workflow:
- Register a citizen user (e.g., `john-doe`)
- Register an authority user (e.g., `city-admin`)
- Create a complaint as the citizen
- Resolve the complaint as the authority user

---

## 📚 API Reference

### User Management Examples

Register a new citizen:
```bash
curl -X POST 'http://localhost:3000/users/register' \
  -H 'content-type: application/json' \
  -d '{"userId":"john-doe","role":"citizen"}'
```

Register a new authority:
```bash
curl -X POST 'http://localhost:3000/users/register' \
  -H 'content-type: application/json' \
  -d '{"userId":"city-admin","role":"authority"}'
```

List all registered users:
```bash
curl 'http://localhost:3000/users'
```

### Complaint Management Examples

Create a complaint as a user:
```bash
curl -X POST 'http://localhost:3000/complaints?as=john-doe' \
  -H 'content-type: application/json' \
  -d '{"id":"cmp-001","user":"john-doe","description":"Streetlight out"}'
```

Update a complaint description:
```bash
curl -X PATCH 'http://localhost:3000/complaints/cmp-001?as=john-doe' \
  -H 'content-type: application/json' \
  -d '{"description":"Streetlight out on Main Street - urgent"}'
```

Resolve (as authority):
```bash
curl -X PATCH 'http://localhost:3000/complaints/cmp-001/resolve?as=city-admin' \
  -H 'content-type: application/json' \
  -d '{"note":"Fixed by maintenance"}'
```

Query all RESOLVED complaints:
```bash
curl 'http://localhost:3000/complaints?status=RESOLVED&as=john-doe'
```

Get all complaints (without status filter):
```bash
curl 'http://localhost:3000/complaints?as=john-doe'
```

Read a specific complaint:
```bash
curl 'http://localhost:3000/complaints/cmp-001?as=john-doe'
```

---

## 🔐 Access Control

### How access control works

- The chaincode checks a **certificate attribute** called `role`.
- Only invokers with `role=authority` may call `ResolveComplaint`.
- The `/users/register` endpoint uses the Fabric CA to register users with their role attribute embedded in the ECert (`ecert: true`).
- Users without the authority role can create and update complaints, but cannot resolve them.

Code (chaincode):
```js
const role = ctx.clientIdentity.getAttributeValue('role');
if (role !== 'authority') throw new Error('Access denied');
```

---

## 🐛 Troubleshooting

### 6) Troubleshooting (WSL + Fabric)

- `jq: command not found` → `sudo apt install -y jq`
- `Unknown flag: --remove-orphans` when using `network.sh` → That flag is for `docker compose down --remove-orphans`; just run `./network.sh down`
- `bash: ./network.sh: Permission denied` → `chmod +x ./network.sh` and run it with `./network.sh ...`
- `Failed to connect to peer/orderer` → Ensure Docker Desktop is running and WSL integration is enabled.
- If you changed the channel name or org, set env vars before starting the server:
  ```bash
  export CHANNEL=mychannel
  export CHAINCODE=complaint
  export MSPID=Org1MSP
  export CCP_PATH=~/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/connection-org1.json
  npm start
  ```

---

## 🧪 Testing

Run the test suites:

```bash
# Test the API server
cd app
npm install
npm test

# Test the chaincode
cd ../chaincode/complaint-js
npm install
npm test
```

## 🔍 Code Quality

Lint the code:

```bash
cd app
npm run lint
```

## 🛡️ Security Features

- **Input Validation**: All user inputs are validated and sanitized with express-validator
- **Rate Limiting**: Intelligent rate limiting on API endpoints to prevent abuse
- **Security Headers**: Helmet.js adds comprehensive security headers
- **Access Control**: Role-based access control via certificate attributes
- **Environment Variables**: Sensitive configuration via .env files
- **Response Compression**: Gzip compression for improved performance
- **CORS Protection**: Configurable CORS policy

## 📝 Environment Variables

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

See `.env.example` for available configuration options.

---

## 📖 Additional Documentation

- **[SETUP.md](SETUP.md)** - Complete step-by-step setup guide with troubleshooting
- **[PRODUCTION.md](PRODUCTION.md)** - Production deployment, monitoring, and security hardening
- **[API.md](API.md)** - Complete API reference with examples
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Development guidelines and contribution process
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and changes

---

## 🎨 UI Improvements

The web interface now includes:
- ✨ Modern gradient design with responsive layout
- 🔄 Loading states with spinner animations
- ✅ Success/error feedback with auto-dismissing messages
- 📱 Mobile-friendly responsive design
- 🎯 Better form validation and error handling
- 🔍 Enhanced user experience with clear visual feedback
- 📊 JSON formatting for API responses
- ⚠️ Warning indicators for authority-only operations

---

## 7) Done in ~1 hour

**Timebox** (approx):
- 0–10 min: Prereqs & Docker
- 10–25 min: Start test-network with CAs
- 25–35 min: Copy & deploy chaincode
- 35–45 min: `npm install` and start API/UI
- 45–60 min: Create & resolve complaints, verify ACL

Happy building! 🚀
