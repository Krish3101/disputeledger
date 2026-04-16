#!/usr/bin/env node
'use strict';

/**
 * Pre-flight check script to validate the environment before starting the server
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🔍 Running pre-flight checks...\n');

let hasErrors = false;

// Check Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
console.log(`✓ Node.js version: ${nodeVersion}`);
if (majorVersion < 14) {
  console.error('❌ Node.js version 14 or higher is required');
  hasErrors = true;
}

// Check if required dependencies are installed
const packageJson = path.join(__dirname, 'package.json');
if (fs.existsSync(packageJson)) {
  console.log('✓ package.json found');
  
  // Check if node_modules exists
  const nodeModules = path.join(__dirname, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.error('❌ node_modules not found. Run: npm install');
    hasErrors = true;
  } else {
    console.log('✓ node_modules found');
  }
} else {
  console.error('❌ package.json not found');
  hasErrors = true;
}

// Check for connection profile (optional but recommended)
const defaultCcp = path.join(
  os.homedir(),
  'fabric-samples',
  'test-network',
  'organizations',
  'peerOrganizations',
  'org1.example.com',
  'connection-org1.json'
);

const ccpPath = process.env.CCP_PATH || defaultCcp;
if (fs.existsSync(ccpPath)) {
  console.log(`✓ Connection profile found: ${ccpPath}`);
} else {
  console.warn(`⚠️  Connection profile not found: ${ccpPath}`);
  console.warn('   This is expected if you haven\'t set up the Fabric network yet.');
  console.warn('   Set CCP_PATH environment variable to point to your connection profile.');
}

// Check wallet directory
const walletPath = path.join(__dirname, 'wallet');
if (fs.existsSync(walletPath)) {
  console.log('✓ Wallet directory exists');
} else {
  console.log('ℹ️  Wallet directory will be created on first use');
}

// Check environment variables
console.log('\n📋 Configuration:');
console.log(`   PORT: ${process.env.PORT || 3000}`);
console.log(`   CHANNEL: ${process.env.CHANNEL || 'mychannel'}`);
console.log(`   CHAINCODE: ${process.env.CHAINCODE || 'complaint'}`);
console.log(`   MSPID: ${process.env.MSPID || 'Org1MSP'}`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'production'}`);

console.log('\n' + '='.repeat(60));
if (hasErrors) {
  console.error('❌ Pre-flight checks failed. Please fix the errors above.');
  process.exit(1);
} else {
  console.log('✅ Pre-flight checks passed. You can start the server.');
  process.exit(0);
}
