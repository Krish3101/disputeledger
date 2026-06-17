import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const defaultFabricBase = process.env.FABRIC_NETWORK_BASE_DIR || path.resolve(__dirname, '../../../test-network');

export const PORT = process.env.PORT || 3000;
export const CCP_PATH = process.env.CCP_PATH || path.join(defaultFabricBase, 'organizations/peerOrganizations/org1.example.com/connection-org1.json');
export const WALLET_PATH = process.env.WALLET_PATH || path.resolve(__dirname, '../../wallet');
export const CHANNEL_NAME = process.env.CHANNEL_NAME || 'mychannel';
export const CHAINCODE_NAME = process.env.CHAINCODE_NAME || 'dispute';
export const MSP_ID = process.env.MSP_ID || 'Org1MSP';
export const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-development-key';

// Gateway configuration (fabric-gateway specific)
export const PEER_ENDPOINT = process.env.PEER_ENDPOINT || 'localhost:7051';
export const PEER_HOST_ALIAS = process.env.PEER_HOST_ALIAS || 'peer0.org1.example.com';
