# Complete Setup Guide

## Prerequisites

Before you begin, ensure you have the following installed:

### Required Software
- **Docker Desktop** (Windows/Mac) or Docker Engine (Linux) - [Download here](https://www.docker.com/products/docker-desktop)
- **Node.js 18+** and npm - [Download here](https://nodejs.org/)
- **Git** - [Download here](https://git-scm.com/)
- **WSL2** (Windows users) - [Setup guide](https://learn.microsoft.com/en-us/windows/wsl/install)

### System Requirements
- **RAM**: Minimum 8GB (16GB recommended)
- **Disk Space**: At least 10GB free
- **OS**: Windows 10+, macOS 10.15+, or Linux

---

## Step 1: Install Hyperledger Fabric

### Clone Fabric Samples

```bash
# Navigate to your home directory
cd ~

# Clone the fabric-samples repository
git clone https://github.com/hyperledger/fabric-samples.git
cd fabric-samples
```

### Download Fabric Binaries and Docker Images

```bash
# Download Fabric 2.5.0 binaries and images
curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.0 1.5.5
```

This command will:
- Download Fabric binaries (peer, orderer, configtxgen, etc.)
- Pull Docker images for Fabric components
- Set up the necessary certificates and configurations

**Note for Windows users**: Run this in WSL2 terminal, not PowerShell.

---

## Step 2: Start the Fabric Test Network

```bash
# Navigate to test network directory
cd ~/fabric-samples/test-network

# Clean any previous network (optional, but recommended)
./network.sh down

# Start the network with Certificate Authorities and CouchDB
./network.sh up -ca -s couchdb
```

**What this does:**
- Creates 2 peer organizations (Org1 and Org2)
- Creates an orderer organization
- Starts Certificate Authority (CA) services
- Sets up CouchDB for state database

### Create a Channel

```bash
# Create a channel named 'mychannel'
./network.sh createChannel -c mychannel
```

---

## Step 3: Deploy the Chaincode

### Copy Chaincode to Fabric Samples

**On Linux/macOS/WSL2:**
```bash
# Replace with your actual path
cp -r /path/to/complaint-fabric-starter/chaincode/complaint-js ~/fabric-samples/chaincode/
```

**On Windows (PowerShell):**
```powershell
# Replace with your actual path
Copy-Item -Recurse "C:\path\to\complaint-fabric-starter\chaincode\complaint-js" "$env:USERPROFILE\fabric-samples\chaincode\"
```

### Deploy the Chaincode

```bash
cd ~/fabric-samples/test-network

# Deploy chaincode with lifecycle
./network.sh deployCC -c mychannel -ccn complaint -ccp ../chaincode/complaint-js -ccl javascript
```

**Parameters:**
- `-c mychannel`: Channel name
- `-ccn complaint`: Chaincode name
- `-ccp ../chaincode/complaint-js`: Path to chaincode
- `-ccl javascript`: Chaincode language

This process:
1. Packages the chaincode
2. Installs on both peer organizations
3. Approves the chaincode definition
4. Commits to the channel

---

## Step 4: Configure the Application

### Install Dependencies

```bash
# Navigate to app directory
cd /path/to/complaint-fabric-starter/app

# Install Node.js dependencies
npm install
```

### Create Environment File

```bash
# Copy the example environment file
cp .env.example .env
```

### Edit Configuration

Open `.env` and verify/update the following paths:

```env
# Server configuration
PORT=3000
NODE_ENV=development

# Fabric network configuration
CHANNEL=mychannel
CHAINCODE=complaint
MSPID=Org1MSP

# Connection profile path (IMPORTANT: Update this!)
CCP_PATH=/home/youruser/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/connection-org1.json

# Wallet path (relative to app directory)
WALLET_PATH=./wallet

# Certificate Authority
CA_URL=https://localhost:7054
```

**For Windows users**, use forward slashes or double backslashes:
```env
CCP_PATH=C:/Users/youruser/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/connection-org1.json
```

---

## Step 5: Run Preflight Checks

This step verifies your configuration before starting the application.

```bash
npm run preflight
```

**Expected Output:**
```
✓ Connection profile exists
✓ Channel 'mychannel' is accessible
✓ Chaincode 'complaint' is installed
✓ Wallet directory created
```

**If errors occur:**
- Check that Docker containers are running: `docker ps`
- Verify the `CCP_PATH` in `.env`
- Ensure the test network is running
- Check that chaincode is deployed: `docker ps | grep complaint`

---

## Step 6: Start the Application

```bash
npm start
```

**Expected Output:**
```
Server listening on http://localhost:3000
Static files served from: /path/to/app/web
```

### Access the Application

Open your web browser and navigate to:
```
http://localhost:3000
```

---

## Step 7: Initialize and Test

### 1. Initialize Admin Identity

Click **"Initialize Admin"** button in the web interface.

This will:
- Enroll the admin user with the Certificate Authority
- Create an admin identity in the wallet
- Enable user registration capabilities

### 2. Register Users

Register test users with different roles:

**Citizen User:**
- User ID: `alice`
- Role: `citizen`

**Authority User:**
- User ID: `admin1`
- Role: `authority`

### 3. Create a Test Complaint

- Complaint ID: `cmp-001`
- Reporter: `alice`
- Description: `Street light not working on Main Street`
- Submit as User: `alice`

### 4. Assign Complaint

- Complaint ID: `cmp-001`
- Assign to: `admin1`
- Assign as: `admin1` (requires authority role)

### 5. Resolve Complaint

- Complaint ID: `cmp-001`
- Resolution Note: `Fixed the street light`
- Resolve as: `admin1`

---

## Development Commands

```bash
# Start in development mode (with auto-reload)
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

---

## Troubleshooting

### Docker Issues

**Problem**: Docker containers not starting
```bash
# Check Docker status
docker ps

# Restart Docker Desktop (Windows/Mac)
# Or restart Docker service (Linux)
sudo systemctl restart docker

# Clean up old containers
docker system prune -a
```

### Network Issues

**Problem**: Test network not responding
```bash
cd ~/fabric-samples/test-network

# Bring down the network
./network.sh down

# Remove Docker volumes
docker volume prune

# Start fresh
./network.sh up -ca -s couchdb
./network.sh createChannel -c mychannel
```

### Chaincode Issues

**Problem**: Chaincode not deployed properly
```bash
# Check chaincode containers
docker ps | grep complaint

# Redeploy chaincode
cd ~/fabric-samples/test-network
./network.sh deployCC -c mychannel -ccn complaint -ccp ../chaincode/complaint-js -ccl javascript
```

### Application Issues

**Problem**: Connection errors in application
- Verify `CCP_PATH` in `.env` file
- Ensure test network is running
- Check wallet directory exists
- Run preflight checks: `npm run preflight`

**Problem**: Port 3000 already in use
```bash
# Find process using port 3000
lsof -i :3000  # Linux/macOS
netstat -ano | findstr :3000  # Windows

# Kill the process or change PORT in .env
PORT=3001
```

### Permission Issues (Linux/macOS)

```bash
# If you get permission errors with wallet directory
chmod -R 755 ./app/wallet

# If Docker commands fail
sudo usermod -aG docker $USER
# Then log out and log back in
```

---

## Stopping the Application

### Stop the Node.js Server

Press `Ctrl+C` in the terminal running the application.

### Stop the Fabric Network

```bash
cd ~/fabric-samples/test-network
./network.sh down
```

### Clean Up Everything

```bash
# Stop network and remove volumes
cd ~/fabric-samples/test-network
./network.sh down

# Remove Docker volumes
docker volume prune -f

# Remove wallet (will require re-initialization)
rm -rf /path/to/complaint-fabric-starter/app/wallet
```

---

## Production Deployment

For production deployment, see [PRODUCTION.md](PRODUCTION.md) for:
- Security hardening
- Performance optimization
- Monitoring setup
- Backup strategies
- Load balancing
- SSL/TLS configuration

---

## Next Steps

1. ✅ Read [API.md](API.md) for API documentation
2. ✅ Review [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines
3. ✅ Check [SUMMARY.md](SUMMARY.md) for project overview
4. ✅ Explore the chaincode in `chaincode/complaint-js/`
5. ✅ Customize the UI in `app/web/index.html`

---

## Support

- **Documentation**: Check the [README.md](README.md)
- **Issues**: [GitHub Issues](https://github.com/Krish3101/complaint-fabric-starter/issues)
- **Fabric Docs**: [Hyperledger Fabric Documentation](https://hyperledger-fabric.readthedocs.io/)

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `./network.sh up -ca -s couchdb` | Start Fabric network |
| `./network.sh down` | Stop Fabric network |
| `./network.sh createChannel` | Create a channel |
| `./network.sh deployCC` | Deploy chaincode |
| `npm start` | Start application |
| `npm test` | Run tests |
| `docker ps` | List running containers |
| `docker logs <container>` | View container logs |

---

**Note**: This setup is for **development and testing only**. Do not use in production without proper security configurations!
