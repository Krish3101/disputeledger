import { Contract } from 'fabric-contract-api';

export class DisputeContract extends Contract {

    /**
     * Initializes the ledger (optional)
     */
    async InitLedger(ctx) {
        console.info('Dispute Ledger Initialized');
    }

    /**
     * Raises a new supply chain dispute.
     */
    async RaiseDispute(ctx, disputeId, orderReference, description) {
        this._assertPartner(ctx);
        this._validateString(disputeId, 100, 'Dispute ID');
        this._validateString(orderReference, 100, 'Order Reference');
        this._validateString(description, 1000, 'Description');

        const exists = await this.DisputeExists(ctx, disputeId);
        if (exists) {
            throw new Error(`The dispute ${disputeId} already exists`);
        }

        const clientId = ctx.clientIdentity.getAttributeValue('hf.EnrollmentID') || ctx.clientIdentity.getID();
        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestampString = new Date(txTimestamp.seconds.low * 1000).toISOString();
        
        const dispute = {
            id: disputeId,
            orderReference: orderReference,
            description: description,
            status: 'PENDING',
            raisedBy: clientId,
            evidence: [],
            resolutionNote: '',
            resolvedBy: '',
            createdAt: timestampString
        };

        await ctx.stub.putState(disputeId, Buffer.from(JSON.stringify(dispute)));
        return JSON.stringify(dispute);
    }

    /**
     * Appends evidence to an existing dispute.
     */
    async AddEvidence(ctx, disputeId, evidenceNotes) {
        this._assertPartner(ctx);
        this._validateString(evidenceNotes, 1000, 'Evidence Notes');

        const dispute = await this._readDispute(ctx, disputeId);

        if (dispute.status === 'RESOLVED') {
            throw new Error('Cannot add evidence to a resolved dispute.');
        }

        const clientId = ctx.clientIdentity.getAttributeValue('hf.EnrollmentID') || ctx.clientIdentity.getID();
        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestampString = new Date(txTimestamp.seconds.low * 1000).toISOString();

        dispute.evidence.push({
            submittedBy: clientId,
            notes: evidenceNotes,
            timestamp: timestampString
        });

        await ctx.stub.putState(disputeId, Buffer.from(JSON.stringify(dispute)));
        return JSON.stringify(dispute);
    }

    /**
     * Adjudicates and resolves a dispute. Only users with the 'arbiter' role can call this.
     */
    async AdjudicateDispute(ctx, disputeId, resolutionNote) {
        // Enforce RBAC: Only an arbiter can resolve a dispute
        this._assertArbiter(ctx);
        this._validateString(resolutionNote, 1000, 'Resolution Note');

        const dispute = await this._readDispute(ctx, disputeId);

        if (dispute.status === 'RESOLVED') {
            throw new Error('Dispute is already resolved.');
        }

        const clientId = ctx.clientIdentity.getAttributeValue('hf.EnrollmentID') || ctx.clientIdentity.getID();
        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestampString = new Date(txTimestamp.seconds.low * 1000).toISOString();
        
        dispute.status = 'RESOLVED';
        dispute.resolutionNote = resolutionNote;
        dispute.resolvedBy = clientId;
        dispute.resolvedAt = timestampString;

        await ctx.stub.putState(disputeId, Buffer.from(JSON.stringify(dispute)));
        return JSON.stringify(dispute);
    }

    /**
     * Retrieves a single dispute by ID.
     */
    async ReadDispute(ctx, disputeId) {
        return await this._readDispute(ctx, disputeId);
    }

    /**
     * Retrieves all disputes (Note: In production, use pagination).
     */
    async GetAllDisputes(ctx, pageSizeStr = '100', bookmark = '') {
        const pageSize = parseInt(pageSizeStr, 10);
        const { iterator, metadata } = await ctx.stub.getStateByRangeWithPagination('', '', pageSize, bookmark);
        const allResults = [];
        
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.log(err);
                record = strValue;
            }
            allResults.push(record);
            result = await iterator.next();
        }
        return JSON.stringify({ records: allResults, bookmark: metadata.fetchedRecordsCount === pageSize ? metadata.bookmark : '' });
    }

    /**
     * Helper to check existence
     */
    async DisputeExists(ctx, disputeId) {
        const buffer = await ctx.stub.getState(disputeId);
        return (!!buffer && buffer.length > 0);
    }

    /**
     * Internal helper to read state and parse JSON
     */
    async _readDispute(ctx, disputeId) {
        const buffer = await ctx.stub.getState(disputeId);
        if (!buffer || buffer.length === 0) {
            throw new Error(`The dispute ${disputeId} does not exist`);
        }
        return JSON.parse(buffer.toString());
    }

    /**
     * Enforces Role-Based Access Control (RBAC) for Arbiters.
     * Throws an error if the invoker does not have the 'arbiter' role attribute.
     */
    _assertArbiter(ctx) {
        const role = ctx.clientIdentity.getAttributeValue('role');
        if (role !== 'arbiter') {
            throw new Error('Access denied: only identities with the "arbiter" role can adjudicate disputes.');
        }
    }

    /**
     * Enforces Role-Based Access Control (RBAC) for Partners.
     */
    _assertPartner(ctx) {
        const role = ctx.clientIdentity.getAttributeValue('role');
        if (role !== 'partner') {
            throw new Error('Access denied: only identities with the "partner" role can perform this action.');
        }
    }

    /**
     * Basic input validation logic executed on-chain.
     */
    _validateString(str, maxLength, fieldName) {
        if (!str || typeof str !== 'string' || str.trim().length === 0) {
            throw new Error(`${fieldName} is required and cannot be empty`);
        }
        if (str.length > maxLength) {
            throw new Error(`${fieldName} must be less than ${maxLength} characters`);
        }
    }
}