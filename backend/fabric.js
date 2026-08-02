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
const defaultFabricBase = process.env.FABRIC_NETWORK_BASE_DIR || path.resolve(__dirname, '../../test-network');

export const PORT = process.env.PORT || 3000;
export const CCP_PATH = process.env.CCP_PATH || path.join(defaultFabricBase, 'organizations/peerOrganizations/org1.example.com/connection-org1.json');
export const WALLET_PATH = process.env.WALLET_PATH || path.resolve(__dirname, './wallet');
export const CHANNEL_NAME = process.env.CHANNEL_NAME || 'mychannel';
export const CHAINCODE_NAME = process.env.CHAINCODE_NAME || 'dispute';
export const MSP_ID = process.env.MSP_ID || 'Org1MSP';
export const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-development-key';
export const PEER_ENDPOINT = process.env.PEER_ENDPOINT || 'localhost:7051';
export const PEER_HOST_ALIAS = process.env.PEER_HOST_ALIAS || 'peer0.org1.example.com';

if (JWT_SECRET === 'super-secret-development-key') {
    console.warn('WARNING: Using default JWT_SECRET. Set a secure secret in .env for production.');
}

async function newGrpcConnection(ccp) {
    const tlsCACerts = ccp.peers[Object.keys(ccp.peers)[0]].tlsCACerts;
    const tlsRootCert = tlsCACerts.pem ? Buffer.from(tlsCACerts.pem) : fs.readFileSync(tlsCACerts.path);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(PEER_ENDPOINT, tlsCredentials, {
        'grpc.ssl_target_name_override': PEER_HOST_ALIAS,
    });
}

async function getIdentityAndSigner(username) {
    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    const identity = await wallet.get(username);
    if (!identity) throw new Error(`Identity for ${username} not found in wallet`);

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
    const ccp = JSON.parse(fs.readFileSync(CCP_PATH, 'utf8'));
    const caInfo = ccp.certificateAuthorities[Object.keys(ccp.certificateAuthorities)[0]];
    return new FabricCAServices(caInfo.url, { trustedRoots: caInfo.tlsCACerts.pem, verify: false });
}

export async function enrollAdmin() {
    const ca = getCAClient();

    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    if (await wallet.get('admin')) return;

    const enrollment = await ca.enroll({ enrollmentID: 'admin', enrollmentSecret: 'adminpw' });
    await wallet.put('admin', {
        credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() },
        mspId: MSP_ID,
        type: 'X.509',
    });
}

export async function registerUser(username, role) {
    await enrollAdmin();
    const ca = getCAClient();

    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    if (await wallet.get(username)) throw new Error(`User ${username} already exists`);

    const adminIdentity = await wallet.get('admin');
    if (!adminIdentity) throw new Error('An administrator needs to be enrolled first');

    const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
    const adminUser = await provider.getUserContext(adminIdentity, 'admin');

    const secret = await ca.register({
        affiliation: 'org1.department1',
        enrollmentID: username,
        role: 'client',
        attrs: [{ name: 'role', value: role, ecert: true }]
    }, adminUser);

    const enrollment = await ca.enroll({
        enrollmentID: username,
        enrollmentSecret: secret,
        attr_reqs: [{ name: 'role', optional: false }, { name: 'hf.EnrollmentID', optional: true }]
    });

    await wallet.put(username, {
        credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() },
        mspId: MSP_ID,
        type: 'X.509',
    });
    return true;
}

export async function authenticateAndIssueToken(username) {
    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    if (!(await wallet.get(username))) throw new Error('User not found. Please register first.');
    return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '2h' });
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
