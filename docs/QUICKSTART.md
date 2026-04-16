# Quick Start Guide

Get your Complaint Management System running in minutes!

---

## ⚡ Fast Track (5 Minutes)

### Prerequisites
- Docker Desktop running
- Node.js 18+ installed
- WSL2 (Windows users)

### 1. Start Fabric Network

```bash
cd ~/fabric-samples/test-network
./network.sh down
./network.sh up -ca -s couchdb
./network.sh createChannel -c mychannel
```

### 2. Deploy Chaincode

```bash
# Copy chaincode
cp -r /path/to/complaint-fabric-starter/chaincode/complaint-js ~/fabric-samples/chaincode/

# Deploy
./network.sh deployCC -c mychannel -ccn complaint -ccp ../chaincode/complaint-js -ccl javascript
```

### 3. Start Application

```bash
cd /path/to/complaint-fabric-starter/app
npm install
cp .env.example .env
# Edit .env to set your CCP_PATH
npm start
```

### 4. Open Browser

Visit: **http://localhost:3000**

---

## 🎯 First Steps in the UI

### Step 1: Initialize
Click **"Initialize Admin"** button

### Step 2: Register Users
- User ID: `alice`, Role: `citizen`
- User ID: `admin1`, Role: `authority`

### Step 3: Create Complaint
- Complaint ID: `cmp-001`
- Reporter: `alice`
- Description: `Street light not working`
- Submit as: `alice`

### Step 4: Assign Complaint
- Complaint ID: `cmp-001`
- Assign to: `admin1`
- Assign as: `admin1`

### Step 5: Resolve Complaint
- Complaint ID: `cmp-001`
- Resolution: `Fixed the street light`
- Resolve as: `admin1`

---

## 🐛 Quick Fixes

### Port Already in Use
```bash
# Change PORT in .env
PORT=3001
```

### Network Not Starting
```bash
cd ~/fabric-samples/test-network
./network.sh down
docker system prune -f
./network.sh up -ca -s couchdb
```

### Connection Errors
```bash
# Run preflight checks
cd app
npm run preflight
```

### Docker Issues
```bash
# Restart Docker Desktop
# Then:
docker ps
```

---

## 📚 Next Steps

1. Read [SETUP.md](SETUP.md) for detailed setup
2. Review [API.md](API.md) for API usage
3. Check [PRODUCTION.md](PRODUCTION.md) for deployment
4. Explore the code in `chaincode/` and `app/`

---

## 🆘 Need Help?

- Check [SETUP.md](SETUP.md) troubleshooting section
- View logs: `docker logs peer0.org1.example.com`
- Test network: `docker ps`
- Verify chaincode: `docker ps | grep complaint`

---

## 🎉 You're Ready!

Your blockchain-powered complaint management system is now running!

**Pro Tips:**
- Use different browsers/incognito for testing different users
- Check the browser console (F12) for detailed error messages
- Monitor Docker logs for chaincode execution details
- Use the `/health` endpoint to check system status

Happy building! 🚀
