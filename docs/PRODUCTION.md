# Production Deployment Guide

This guide covers deploying the Complaint Management System to a production environment.

---

## Pre-Production Checklist

### Security
- [ ] Remove all default credentials
- [ ] Enable HTTPS/TLS
- [ ] Configure firewall rules
- [ ] Set up proper authentication
- [ ] Implement secret management
- [ ] Enable audit logging
- [ ] Configure CORS properly
- [ ] Set strong rate limiting
- [ ] Use environment variables for secrets
- [ ] Disable debug mode

### Performance
- [ ] Enable response compression
- [ ] Configure caching
- [ ] Optimize database queries
- [ ] Set up load balancing
- [ ] Configure connection pooling
- [ ] Monitor resource usage

### Reliability
- [ ] Set up health checks
- [ ] Configure automatic restarts
- [ ] Implement error tracking
- [ ] Set up monitoring and alerts
- [ ] Create backup strategy
- [ ] Document disaster recovery plan
- [ ] Test failover scenarios

---

## 1. Security Hardening

### Environment Variables

**Never commit secrets to version control!**

Create `.env.production`:

```env
NODE_ENV=production
PORT=3000

# Fabric Configuration
CHANNEL=mychannel
CHAINCODE=complaint
MSPID=Org1MSP
CCP_PATH=/opt/fabric/connection-profile.json
WALLET_PATH=/opt/wallet

# Certificate Authority
CA_URL=https://ca.yourdomain.com:7054

# Security
SESSION_SECRET=your-very-long-random-secret-here
JWT_SECRET=another-very-long-random-secret

# Rate Limiting (more strict in production)
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=50

# Logging
LOG_LEVEL=info
LOG_FILE_PATH=/var/log/complaint-app
```

### HTTPS/TLS Configuration

Install SSL certificate (using Let's Encrypt):

```bash
# Install certbot
sudo apt-get update
sudo apt-get install certbot

# Generate certificate
sudo certbot certonly --standalone -d yourdomain.com
```

### Nginx Reverse Proxy

Create `/etc/nginx/sites-available/complaint-app`:

```nginx
upstream complaint_app {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;

    location / {
        proxy_pass http://complaint_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/complaint-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 2. Process Management with PM2

### Install PM2

```bash
npm install -g pm2
```

### Create PM2 Ecosystem File

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'complaint-app',
    script: './server.js',
    cwd: '/opt/complaint-fabric-starter/app',
    instances: 4,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/pm2/complaint-app-error.log',
    out_file: '/var/log/pm2/complaint-app-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '500M',
    watch: false
  }]
};
```

### Start the Application

```bash
# Start with ecosystem file
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup systemd
```

### PM2 Commands

```bash
# View status
pm2 status

# View logs
pm2 logs complaint-app

# Restart
pm2 restart complaint-app

# Stop
pm2 stop complaint-app

# Reload (zero downtime)
pm2 reload complaint-app

# Monitor
pm2 monit
```

---

## 3. Monitoring and Logging

### Winston Logger Setup

Install dependencies:

```bash
npm install winston winston-daily-rotate-file
```

Create `app/logger.js`:

```javascript
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'complaint-app' },
  transports: [
    // Error logs
    new DailyRotateFile({
      filename: '/var/log/complaint-app/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
      maxSize: '20m',
    }),
    // Combined logs
    new DailyRotateFile({
      filename: '/var/log/complaint-app/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      maxSize: '20m',
    }),
  ],
});

// Console logging in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

module.exports = logger;
```

### Prometheus Metrics

Install dependencies:

```bash
npm install prom-client
```

Create `app/metrics.js`:

```javascript
const client = require('prom-client');

// Create a Registry
const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const blockchainTransactions = new client.Counter({
  name: 'blockchain_transactions_total',
  help: 'Total number of blockchain transactions',
  labelNames: ['type', 'status'],
  registers: [register],
});

module.exports = {
  register,
  httpRequestDuration,
  httpRequestTotal,
  blockchainTransactions,
};
```

Add metrics endpoint in `server.js`:

```javascript
const { register } = require('./metrics');

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Health Check Endpoint

Add comprehensive health check:

```javascript
app.get('/health', async (req, res) => {
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    status: 'OK',
    version: process.env.npm_package_version || '2.0.0',
    environment: process.env.NODE_ENV,
    checks: {
      wallet: false,
      connectionProfile: false,
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
      },
    },
  };

  try {
    // Check wallet
    const wallet = await Wallets.newFileSystemWallet(process.env.WALLET_PATH);
    health.checks.wallet = true;

    // Check connection profile
    const ccpPath = path.resolve(process.env.CCP_PATH);
    if (fs.existsSync(ccpPath)) {
      health.checks.connectionProfile = true;
    }
  } catch (error) {
    health.status = 'DEGRADED';
    health.error = error.message;
  }

  const statusCode = health.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

---

## 4. Database Backup Strategy

### CouchDB Backup

Create backup script `scripts/backup-couchdb.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/opt/backups/couchdb"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
COUCHDB_URL="http://admin:password@localhost:5984"

mkdir -p $BACKUP_DIR

# Backup all databases
for db in $(curl -s $COUCHDB_URL/_all_dbs | jq -r '.[]'); do
    if [[ $db != _* ]]; then
        echo "Backing up $db..."
        curl -s "$COUCHDB_URL/$db/_all_docs?include_docs=true" \
            -o "$BACKUP_DIR/${db}_${TIMESTAMP}.json"
    fi
done

# Compress backups older than 1 day
find $BACKUP_DIR -name "*.json" -mtime +1 -exec gzip {} \;

# Delete backups older than 30 days
find $BACKUP_DIR -name "*.json.gz" -mtime +30 -delete

echo "Backup completed: $TIMESTAMP"
```

### Wallet Backup

```bash
#!/bin/bash

WALLET_PATH="/opt/wallet"
BACKUP_DIR="/opt/backups/wallet"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup wallet
tar -czf "$BACKUP_DIR/wallet_${TIMESTAMP}.tar.gz" -C "$(dirname $WALLET_PATH)" "$(basename $WALLET_PATH)"

# Encrypt backup (optional)
gpg --symmetric --cipher-algo AES256 "$BACKUP_DIR/wallet_${TIMESTAMP}.tar.gz"

# Delete unencrypted backup
rm "$BACKUP_DIR/wallet_${TIMESTAMP}.tar.gz"

# Delete backups older than 30 days
find $BACKUP_DIR -name "*.tar.gz.gpg" -mtime +30 -delete

echo "Wallet backup completed: $TIMESTAMP"
```

### Schedule Backups with Cron

```bash
# Edit crontab
crontab -e

# Add these lines:
# Backup CouchDB daily at 2 AM
0 2 * * * /opt/scripts/backup-couchdb.sh >> /var/log/backup-couchdb.log 2>&1

# Backup wallet daily at 3 AM
0 3 * * * /opt/scripts/backup-wallet.sh >> /var/log/backup-wallet.log 2>&1
```

---

## 5. Docker Production Setup

### Docker Compose for Production

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.prod
    image: complaint-app:production
    container_name: complaint-app
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    volumes:
      - wallet-data:/opt/wallet
      - logs:/var/log/complaint-app
    networks:
      - fabric-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  nginx:
    image: nginx:alpine
    container_name: complaint-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - app
    networks:
      - fabric-network

volumes:
  wallet-data:
  logs:

networks:
  fabric-network:
    external: true
```

### Production Dockerfile

Create `Dockerfile.prod`:

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY app/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY app/ .

# Remove development files
RUN rm -rf tests/ jest.config.js .eslintrc.js

FROM node:18-alpine

# Add non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy from builder
COPY --from=builder --chown=nodejs:nodejs /app /app

# Create directories
RUN mkdir -p /opt/wallet /var/log/complaint-app && \
    chown -R nodejs:nodejs /opt/wallet /var/log/complaint-app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "server.js"]
```

### Build and Deploy

```bash
# Build image
docker build -f Dockerfile.prod -t complaint-app:production .

# Start services
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop services
docker-compose -f docker-compose.prod.yml down
```

---

## 6. Monitoring with Grafana

### Install Grafana

```bash
# Add Grafana repository
sudo apt-get install -y software-properties-common
wget -q -O - https://packages.grafana.com/gpg.key | sudo apt-key add -
echo "deb https://packages.grafana.com/oss/deb stable main" | sudo tee /etc/apt/sources.list.d/grafana.list

# Install
sudo apt-get update
sudo apt-get install grafana

# Start Grafana
sudo systemctl start grafana-server
sudo systemctl enable grafana-server
```

Access Grafana at `http://localhost:3000` (default: admin/admin)

### Configure Prometheus Data Source

1. Add Prometheus as data source
2. URL: `http://localhost:9090`
3. Create dashboard for application metrics

---

## 7. Security Best Practices

### Firewall Configuration (UFW)

```bash
# Enable firewall
sudo ufw enable

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Deny all other incoming
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Check status
sudo ufw status verbose
```

### Fail2Ban (Protection against brute force)

```bash
# Install fail2ban
sudo apt-get install fail2ban

# Configure
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local

# Edit jail.local and add:
[nginx-limit-req]
enabled = true
filter = nginx-limit-req
action = iptables-multiport[name=ReqLimit, port="http,https"]
logpath = /var/log/nginx/error.log
```

---

## 8. Performance Optimization

### Node.js Optimization

```javascript
// Enable compression
const compression = require('compression');
app.use(compression());

// Connection pooling
const pool = {
  maxSockets: 100,
  keepAlive: true,
  keepAliveMsecs: 30000,
};

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
```

### Database Indexes (CouchDB)

Create design documents with indexes for frequently queried fields.

---

## 9. Disaster Recovery

### Recovery Plan

1. **Application Failure**
   - PM2 auto-restart
   - Manual restart from backup
   - Rollback to previous version

2. **Database Corruption**
   - Restore from latest CouchDB backup
   - Verify data integrity
   - Replay blockchain ledger if needed

3. **Complete System Failure**
   - Deploy on backup server
   - Restore wallet and configuration
   - Reconnect to Fabric network

---

## 10. Deployment Checklist

- [ ] All tests passing
- [ ] Environment variables configured
- [ ] SSL certificates installed
- [ ] Nginx configured
- [ ] PM2 ecosystem configured
- [ ] Logging configured
- [ ] Monitoring set up
- [ ] Backups automated
- [ ] Firewall configured
- [ ] Health checks working
- [ ] Documentation updated
- [ ] Team trained on deployment
- [ ] Rollback plan documented
- [ ] Load testing completed
- [ ] Security audit performed

---

## Support

For production issues:
- Check logs: `/var/log/complaint-app/`
- Monitor metrics: `http://yourdomain.com/metrics`
- Health check: `http://yourdomain.com/health`
- PM2 status: `pm2 status`

---

**Remember**: Always test deployment procedures in a staging environment first!
