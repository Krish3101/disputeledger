import express from 'express';
import { requireAuth } from '../services/authService.js';
import { getContract } from '../services/fabricGateway.js';
import { validateId, validateText } from '../utils/validation.js';

const router = express.Router();

// All dispute routes require a valid JWT
router.use(requireAuth);

/**
 * Common error handler for Fabric Gateway / Chaincode exceptions
 */
function handleFabricError(err, res) {
    const errMsg = err.message || '';
    
    // RBAC Errors
    if (errMsg.includes('Access denied')) {
        return res.status(403).json({ error: errMsg });
    }
    
    // Validation / Logic Errors
    if (errMsg.includes('already exists') || 
        errMsg.includes('does not exist') ||
        errMsg.includes('Cannot add evidence') ||
        errMsg.includes('Dispute is already resolved') ||
        errMsg.includes('is required') ||
        errMsg.includes('must be less than')) {
        return res.status(400).json({ error: errMsg });
    }

    // Sanitize 500 errors to avoid leaking network topology to frontend
    console.error('Fabric Gateway Error:', err);
    res.status(500).json({ error: 'An internal error occurred processing the transaction.' });
}

/**
 * GET /api/disputes
 * List all disputes (with basic pagination support)
 */
router.get('/', async (req, res) => {
    let gateway;
    try {
        const pageSize = req.query.pageSize || '100';
        const bookmark = req.query.bookmark || '';
        
        const { gateway: gw, contract } = await getContract(req.user);
        gateway = gw;
        const resultBytes = await contract.evaluateTransaction('GetAllDisputes', pageSize, bookmark);
        res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
    } catch (err) {
        handleFabricError(err, res);
    } finally {
        if (gateway) gateway.close();
    }
});

/**
 * POST /api/disputes
 * Raise a new dispute (Partner only)
 */
router.post('/', async (req, res) => {
    let gateway;
    try {
        const disputeId = validateId(req.body.disputeId, 'Dispute ID');
        const orderReference = validateId(req.body.orderReference, 'Order Reference');
        const description = validateText(req.body.description, 'Description');

        const { gateway: gw, contract } = await getContract(req.user);
        gateway = gw;
        
        const resultBytes = await contract.submitTransaction('RaiseDispute', disputeId, orderReference, description);
        res.status(201).json(JSON.parse(new TextDecoder().decode(resultBytes)));
    } catch (err) {
        handleFabricError(err, res);
    } finally {
        if (gateway) gateway.close();
    }
});

/**
 * PATCH /api/disputes/:id/evidence
 * Add evidence to an existing dispute
 */
router.patch('/:id/evidence', async (req, res) => {
    let gateway;
    try {
        const notes = validateText(req.body.notes, 'Evidence notes');
        const disputeId = validateId(req.params.id, 'Dispute ID');

        const { gateway: gw, contract } = await getContract(req.user);
        gateway = gw;
        
        const resultBytes = await contract.submitTransaction('AddEvidence', disputeId, notes);
        res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
    } catch (err) {
        handleFabricError(err, res);
    } finally {
        if (gateway) gateway.close();
    }
});

/**
 * PATCH /api/disputes/:id/resolve
 * Adjudicate and resolve a dispute (Arbiter only)
 */
router.patch('/:id/resolve', async (req, res) => {
    let gateway;
    try {
        const resolutionNote = validateText(req.body.resolutionNote, 'Resolution Note');
        const disputeId = validateId(req.params.id, 'Dispute ID');

        const { gateway: gw, contract } = await getContract(req.user);
        gateway = gw;
        
        const resultBytes = await contract.submitTransaction('AdjudicateDispute', disputeId, resolutionNote);
        res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
    } catch (err) {
        handleFabricError(err, res);
    } finally {
        if (gateway) gateway.close();
    }
});

export default router;