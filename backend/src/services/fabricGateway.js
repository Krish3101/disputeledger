import fs from 'fs';
import * as crypto from 'crypto';
import * as grpc from '@grpc/grpc-js';
import { connect, signers } from '@hyperledger/fabric-gateway';
import { CCP_PATH, WALLET_PATH, CHANNEL_NAME, CHAINCODE_NAME, PEER_ENDPOINT, PEER_HOST_ALIAS } from '../config.js';
import { Wallets } from 'fabric-network'; // only used for retrieving certs from legacy wallet

/**
 * Creates a gRPC connection to the Fabric Peer
 */
async function newGrpcConnection(ccp) {
    const tlsCACerts = ccp.peers[Object.keys(ccp.peers)[0]].tlsCACerts;
    const tlsRootCert = tlsCACerts.pem ? Buffer.from(tlsCACerts.pem) : fs.readFileSync(tlsCACerts.path);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(PEER_ENDPOINT, tlsCredentials, {
        'grpc.ssl_target_name_override': PEER_HOST_ALIAS,
    });
}

/**
 * Helper to extract identity and signer from the FileSystemWallet
 */
async function getIdentityAndSigner(username) {
    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    const identity = await wallet.get(username);
    
    if (!identity) {
        throw new Error(`Identity for ${username} not found in wallet`);
    }

    const certBuffer = Buffer.from(identity.credentials.certificate);
    const keyBuffer = Buffer.from(identity.credentials.privateKey);

    const gatewayIdentity = { mspId: identity.mspId, credentials: certBuffer };
    
    const privateKey = crypto.createPrivateKey(keyBuffer);
    const signer = signers.newPrivateKeySigner(privateKey);

    return { gatewayIdentity, signer };
}

/**
 * Gets the smart contract instance for a specific authenticated user
 */
export async function getContract(username) {
    const ccp = JSON.parse(fs.readFileSync(CCP_PATH, 'utf8'));
    const client = await newGrpcConnection(ccp);
    
    const { gatewayIdentity, signer } = await getIdentityAndSigner(username);

    const gateway = connect({
        client,
        identity: gatewayIdentity,
        signer,
        // Default timeouts
        evaluateOptions: () => { return { deadline: Date.now() + 5000 }; },
        endorseOptions: () => { return { deadline: Date.now() + 15000 }; },
        submitOptions: () => { return { deadline: Date.now() + 5000 }; },
        commitStatusOptions: () => { return { deadline: Date.now() + 60000 }; },
    });

    const network = gateway.getNetwork(CHANNEL_NAME);
    const contract = network.getContract(CHAINCODE_NAME);

    return { gateway, contract };
}
