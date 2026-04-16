const fs = require('fs');
const path = require('path');
const { Wallets, Gateway } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const { CCP_PATH, CHANNEL, CHAINCODE, MSPID } = require('../config');

let wallet;

/**
 * Loads the connection profile (CCP) for Hyperledger Fabric
 */
function loadCCP() {
  if (!fs.existsSync(CCP_PATH)) {
    throw new Error(`Connection profile not found at ${CCP_PATH}. Set CCP_PATH env var.`);
  }
  const ccp = JSON.parse(fs.readFileSync(CCP_PATH, 'utf8'));
  return ccp;
}

/**
 * Enrolls the admin user with the Certificate Authority
 */
async function enrollAdmin(ccp) {
  wallet = wallet || await Wallets.newFileSystemWallet(path.join(__dirname, '../../wallet'));
  const adminId = 'admin';
  const adminInWallet = await wallet.get(adminId);
  if (adminInWallet) return;

  const caInfo = ccp.certificateAuthorities[Object.keys(ccp.certificateAuthorities)[0]];
  const ca = new FabricCAServices(caInfo.url, { trustedRoots: caInfo.tlsCACerts.pem, verify: false });

  const enrollment = await ca.enroll({ enrollmentID: 'admin', enrollmentSecret: 'adminpw' });
  const identity = {
    credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() },
    mspId: MSPID,
    type: 'X.509'
  };
  await wallet.put(adminId, identity);
}

/**
 * Registers and enrolls a user with the Certificate Authority
 */
async function registerUser(ccp, userId, attrs = []) {
  wallet = wallet || await Wallets.newFileSystemWallet(path.join(__dirname, '../../wallet'));
  const userInWallet = await wallet.get(userId);
  if (userInWallet) return;

  const caInfo = ccp.certificateAuthorities[Object.keys(ccp.certificateAuthorities)[0]];
  const ca = new FabricCAServices(caInfo.url, { trustedRoots: caInfo.tlsCACerts.pem, verify: false });

  const adminIdentity = await wallet.get('admin');
  if (!adminIdentity) throw new Error('Admin identity not in wallet. Call /setup first.');

  const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
  const adminUser = await provider.getUserContext(adminIdentity, 'admin');

  const secret = await ca.register({
    affiliation: 'org1.department1',
    enrollmentID: userId,
    role: 'client',
    attrs: attrs.map(a => ({ name: a.name, value: a.value, ecert: true }))
  }, adminUser);

  const enrollment = await ca.enroll({ enrollmentID: userId, enrollmentSecret: secret, attr_reqs: attrs.map(a => ({ name: a.name, optional: false })) });
  const x509Identity = {
    credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() },
    mspId: MSPID,
    type: 'X.509'
  };
  await wallet.put(userId, x509Identity);
}

/**
 * Gets a contract instance for the specified user
 */
async function getContract(userId) {
  wallet = wallet || await Wallets.newFileSystemWallet(path.join(__dirname, '../../wallet'));
  const ccp = loadCCP();
  const gateway = new Gateway();
  await gateway.connect(ccp, {
    wallet,
    identity: userId,
    discovery: { enabled: true, asLocalhost: true }
  });
  const network = await gateway.getNetwork(CHANNEL);
  const contract = network.getContract(CHAINCODE);
  return { gateway, contract };
}

/**
 * Gets the wallet instance
 */
async function getWallet() {
  wallet = wallet || await Wallets.newFileSystemWallet(path.join(__dirname, '../../wallet'));
  return wallet;
}

module.exports = {
  loadCCP,
  enrollAdmin,
  registerUser,
  getContract,
  getWallet,
};
