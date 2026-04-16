/*
 * Express API server for Hyperledger Fabric complaint management
 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const compression = require('compression');
const cors = require('cors');
const morgan = require('morgan');

const { PORT, CCP_PATH } = require('./config');
const securityMiddleware = require('./middleware/security');
const rateLimitMiddleware = require('./middleware/rateLimit');

// API route handlers
const systemRoutes = require('./api/system');
const userRoutes = require('./api/users');
const complaintRoutes = require('./api/complaints');

const app = express();

// Middleware
app.use(securityMiddleware);
app.use(rateLimitMiddleware);
app.use(compression());
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'web')));

// System routes
app.get('/health', systemRoutes.health);
app.post('/setup', systemRoutes.setup);

// User routes
app.post('/users/register', userRoutes.registerNewUser);
app.get('/users', userRoutes.listUsers);
app.get('/users/:userId/exists', userRoutes.checkUserExists);

// Complaint routes
app.post('/complaints', complaintRoutes.createComplaint);
app.get('/complaints/:id', complaintRoutes.readComplaint);
app.get('/complaints', complaintRoutes.listComplaints);
app.patch('/complaints/:id/resolve', complaintRoutes.resolveComplaint);
app.patch('/complaints/:id', complaintRoutes.updateComplaint);
app.delete('/complaints/:id', complaintRoutes.deleteComplaint);
app.patch('/complaints/:id/assign', complaintRoutes.assignComplaint);
app.get('/complaints/assigned/:authorityId', complaintRoutes.getAssignedComplaints);

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`API + UI server running on http://localhost:${PORT}`);
  console.log('='.repeat(60));
  
  if (!fs.existsSync(CCP_PATH)) {
    console.error('WARNING: Connection profile not found at:', CCP_PATH);
    console.error('Please ensure fabric-samples test-network is running and CCP_PATH is correct.');
  }
});

module.exports = app;
