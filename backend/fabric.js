import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as crypto from 'crypto';
import * as grpc from '@grpc/grpc-js';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import FabricCAServices from 'fabric-ca-client';
import { connect, signers } from '@hyperledger/fabric-gateway';
import { Wallets } from 'fabric-network';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
function resolveFabricBase() {
  if (process.env.FABRIC_NETWORK_BASE_DIR) {
    return path.resolve(process.env.FABRIC_NETWORK_BASE_DIR);
  }
  const candidatePaths = [
    path.resolve(__dirname, '../fabric-samples/test-network'),
    path.resolve(__dirname, '../../fabric-samples/test-network'),
    path.resolve(__dirname, '../../test-network'),
    path.resolve(process.env.HOME || '', 'fabric-samples/test-network'),
  ];
  for (const candidate of candidatePaths) {
    const candidateCcp = path.join(
      candidate,
      'organizations/peerOrganizations/org1.example.com/connection-org1.json'
    );
    if (fs.existsSync(candidateCcp)) {
      return candidate;
    }
  }
  return candidatePaths[1]; // default to ../../fabric-samples/test-network
}

const defaultFabricBase = resolveFabricBase();

export const PORT = process.env.PORT || 3000;
export const CCP_PATH =
  process.env.CCP_PATH ||
  path.join(
    defaultFabricBase,
    'organizations/peerOrganizations/org1.example.com/connection-org1.json'
  );
export const WALLET_PATH = process.env.WALLET_PATH || path.resolve(__dirname, './wallet');
export const CHANNEL_NAME = process.env.CHANNEL_NAME || 'mychannel';
export const CHAINCODE_NAME = process.env.CHAINCODE_NAME || 'dispute';
export const MSP_ID = process.env.MSP_ID || 'Org1MSP';
export const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-development-key';
export const PEER_ENDPOINT = process.env.PEER_ENDPOINT || 'localhost:7051';
export const PEER_HOST_ALIAS = process.env.PEER_HOST_ALIAS || 'peer0.org1.example.com';
export const CA_ADMIN_NAME = process.env.CA_ADMIN_NAME || 'admin';
export const CA_ADMIN_SECRET = process.env.CA_ADMIN_SECRET || 'adminpw';

if (JWT_SECRET === 'super-secret-development-key') {
  console.warn('WARNING: Using default JWT_SECRET. Set a secure secret in .env for production.');
}

function verifyCcpExists() {
  if (!fs.existsSync(CCP_PATH)) {
    throw new Error(
      `Fabric connection profile not found at: ${CCP_PATH}. ` +
        `Please ensure your Fabric network is running and FABRIC_NETWORK_BASE_DIR is configured in .env ` +
        `(e.g., FABRIC_NETWORK_BASE_DIR=/path/to/fabric-samples/test-network).`
    );
  }
}

async function newGrpcConnection(ccp) {
  const tlsCACerts = ccp.peers[Object.keys(ccp.peers)[0]].tlsCACerts;
  const tlsRootCert = tlsCACerts.pem
    ? Buffer.from(tlsCACerts.pem)
    : fs.readFileSync(tlsCACerts.path);
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
  return new grpc.Client(PEER_ENDPOINT, tlsCredentials, {
    'grpc.ssl_target_name_override': PEER_HOST_ALIAS,
  });
}

async function getIdentityAndSigner(username) {
  const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
  const identity = await wallet.get(username);
  if (!identity) throw new Error(`NOT_FOUND: Identity for ${username} not found in wallet`);

  const certBuffer = Buffer.from(identity.credentials.certificate);
  const keyBuffer = Buffer.from(identity.credentials.privateKey);
  const gatewayIdentity = { mspId: identity.mspId, credentials: certBuffer };

  const privateKey = crypto.createPrivateKey(keyBuffer);
  const signer = signers.newPrivateKeySigner(privateKey);
  return { gatewayIdentity, signer };
}

const gatewayCache = new Map();

export async function getContract(username) {
  if (gatewayCache.has(username)) {
    const gateway = gatewayCache.get(username);
    return { contract: gateway.getNetwork(CHANNEL_NAME).getContract(CHAINCODE_NAME) };
  }

  verifyCcpExists();
  const ccp = JSON.parse(fs.readFileSync(CCP_PATH, 'utf8'));
  const client = await newGrpcConnection(ccp);
  const { gatewayIdentity, signer } = await getIdentityAndSigner(username);

  const gateway = connect({
    client,
    identity: gatewayIdentity,
    signer,
    evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15000 }),
    submitOptions: () => ({ deadline: Date.now() + 5000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
  });

  gatewayCache.set(username, gateway);
  return { contract: gateway.getNetwork(CHANNEL_NAME).getContract(CHAINCODE_NAME) };
}
function getCAClient() {
  verifyCcpExists();
  const ccp = JSON.parse(fs.readFileSync(CCP_PATH, 'utf8'));
  const caInfo = ccp.certificateAuthorities[Object.keys(ccp.certificateAuthorities)[0]];
  return new FabricCAServices(caInfo.url, { trustedRoots: caInfo.tlsCACerts.pem, verify: false });
}

export async function enrollAdmin() {
  const ca = getCAClient();

  const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
  if (await wallet.get(CA_ADMIN_NAME)) return;

  const enrollment = await ca.enroll({
    enrollmentID: CA_ADMIN_NAME,
    enrollmentSecret: CA_ADMIN_SECRET,
  });
  await wallet.put(CA_ADMIN_NAME, {
    credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() },
    mspId: MSP_ID,
    type: 'X.509',
  });
}

export async function registerUser(username, role) {
  await enrollAdmin();
  const ca = getCAClient();

  const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
  if (await wallet.get(username)) throw new Error(`CONFLICT: User ${username} already exists`);

  const adminIdentity = await wallet.get(CA_ADMIN_NAME);
  if (!adminIdentity) throw new Error('An administrator needs to be enrolled first');

  const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
  const adminUser = await provider.getUserContext(adminIdentity, CA_ADMIN_NAME);

  const secret = await ca.register(
    {
      affiliation: 'org1.department1',
      enrollmentID: username,
      role: 'client',
      attrs: [{ name: 'role', value: role, ecert: true }],
    },
    adminUser
  );

  const enrollment = await ca.enroll({
    enrollmentID: username,
    enrollmentSecret: secret,
    attr_reqs: [
      { name: 'role', optional: false },
      { name: 'hf.EnrollmentID', optional: true },
    ],
  });

  await wallet.put(username, {
    credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() },
    mspId: MSP_ID,
    type: 'X.509',
  });
  saveRole(username, role);
  return true;
}

/**
 * UI Role Cache (.roles.json):
 *
 * This local JSON file acts as a derived, non-authoritative convenience cache
 * used exclusively to return the user's role on login for frontend UI-gating
 * (showing or hiding the "Add Evidence" vs "Adjudicate" action buttons).
 *
 * NOTE: The true source of truth for Role-Based Access Control (RBAC) is the
 * cryptographically signed X.509 certificate attribute ('role') issued by the
 * Fabric CA during enrollment, which is enforced on-chain by the chaincode.
 *
 * Colocation: .roles.json is stored inside WALLET_PATH to leverage the existing
 * .gitignore entry (backend/wallet/) and keep all local runtime identity data
 * cleanly scoped in one directory.
 *
 * If a role entry is missing (e.g., if .roles.json is deleted or out of sync),
 * getRole defaults to 'partner' (least-privilege fallback).
 */
function getRolesFilePath() {
  return path.join(WALLET_PATH, '.roles.json');
}

function saveRole(username, role) {
  const filePath = getRolesFilePath();
  let roles = {};
  if (fs.existsSync(filePath)) {
    try {
      roles = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      roles = {};
    }
  }
  roles[username] = role;
  fs.writeFileSync(filePath, JSON.stringify(roles, null, 2), 'utf8');
}

function getRole(username) {
  const filePath = getRolesFilePath();
  if (fs.existsSync(filePath)) {
    try {
      const roles = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return roles[username] || 'partner';
    } catch (e) {
      return 'partner';
    }
  }
  return 'partner';
}

export async function authenticateAndIssueToken(username) {
  const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
  if (!(await wallet.get(username))) throw new Error('User not found. Please register first.');
  const role = getRole(username);
  // JWT is session authentication convenience only ({ sub: username }), not the authorization source.
  // Real RBAC is enforced on-chain via the client certificate in chaincode.
  const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '2h' });
  return { token, role };
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  try {
    const payload = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    req.user = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
