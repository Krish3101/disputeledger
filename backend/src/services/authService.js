import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import FabricCAServices from 'fabric-ca-client';
import { Wallets } from 'fabric-network';
import { CCP_PATH, WALLET_PATH, MSP_ID, JWT_SECRET } from '../config.js';

/**
 * Ensures the admin user is enrolled, necessary to register other users.
 */
export async function enrollAdmin() {
    const ccp = JSON.parse(fs.readFileSync(CCP_PATH, 'utf8'));
    const caInfo = ccp.certificateAuthorities[Object.keys(ccp.certificateAuthorities)[0]];
    const ca = new FabricCAServices(caInfo.url, { trustedRoots: caInfo.tlsCACerts.pem, verify: false });

    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    const adminIdentity = await wallet.get('admin');
    if (adminIdentity) {
        return;
    }

    const enrollment = await ca.enroll({ enrollmentID: 'admin', enrollmentSecret: 'adminpw' });
    const x509Identity = {
        credentials: {
            certificate: enrollment.certificate,
            privateKey: enrollment.key.toBytes(),
        },
        mspId: MSP_ID,
        type: 'X.509',
    };
    await wallet.put('admin', x509Identity);
}

/**
 * Registers a new user with a specific role ('partner' or 'arbiter').
 */
export async function registerUser(username, role) {
    await enrollAdmin();
    const ccp = JSON.parse(fs.readFileSync(CCP_PATH, 'utf8'));
    const caInfo = ccp.certificateAuthorities[Object.keys(ccp.certificateAuthorities)[0]];
    const ca = new FabricCAServices(caInfo.url, { trustedRoots: caInfo.tlsCACerts.pem, verify: false });

    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    const userIdentity = await wallet.get(username);
    if (userIdentity) {
        throw new Error(`User ${username} already exists`);
    }

    const adminIdentity = await wallet.get('admin');
    if (!adminIdentity) {
        throw new Error('An administrator needs to be enrolled first');
    }

    const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
    const adminUser = await provider.getUserContext(adminIdentity, 'admin');

    // Register the user
    const secret = await ca.register({
        affiliation: 'org1.department1',
        enrollmentID: username,
        role: 'client',
        attrs: [{ name: 'role', value: role, ecert: true }]
    }, adminUser);

    // Enroll the user and request the role attribute in the cert
    const enrollment = await ca.enroll({
        enrollmentID: username,
        enrollmentSecret: secret,
        attr_reqs: [{ name: 'role', optional: false }, { name: 'hf.EnrollmentID', optional: true }]
    });

    const x509Identity = {
        credentials: {
            certificate: enrollment.certificate,
            privateKey: enrollment.key.toBytes(),
        },
        mspId: MSP_ID,
        type: 'X.509',
    };
    await wallet.put(username, x509Identity);
    return true;
}

/**
 * Verifies credentials (simplified for portfolio) and issues JWT
 */
export async function authenticateAndIssueToken(username) {
    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    const identity = await wallet.get(username);
    
    if (!identity) {
        throw new Error('User not found. Please register first.');
    }

    // In a real app, verify a password here. We just issue a token for the existing Fabric identity.
    return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '2h' });
}

/**
 * Express middleware to verify JWT and attach Fabric username to request
 */
export function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = payload.sub; // The fabric username
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}
