const os = require('os');
const path = require('path');

// Environment variables with defaults
const PORT = process.env.PORT || 3000;
const CHANNEL = process.env.CHANNEL || 'mychannel';
const CHAINCODE = process.env.CHAINCODE || 'complaint';
const MSPID = process.env.MSPID || 'Org1MSP';

// Default to the standard test-network connection profile path
const defaultCcp = path.join(
  os.homedir(),
  'fabric-samples',
  'test-network',
  'organizations',
  'peerOrganizations',
  'org1.example.com',
  'connection-org1.json'
);
const CCP_PATH = process.env.CCP_PATH || defaultCcp;

module.exports = {
  PORT,
  CHANNEL,
  CHAINCODE,
  MSPID,
  CCP_PATH,
};
