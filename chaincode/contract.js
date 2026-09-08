import { Contract } from 'fabric-contract-api';

export class DisputeContract extends Contract {
  async RaiseDispute(ctx, disputeId, orderReference, description) {
    this._assertPartner(ctx);
    this._validateId(disputeId, 'Dispute ID');
    this._validateId(orderReference, 'Order Reference');
    this._validateString(description, 1000, 'Description');

    const exists = await this.DisputeExists(ctx, disputeId);
    if (exists) {
      throw new Error(`CONFLICT: The dispute ${disputeId} already exists`);
    }

    const { clientId, timestampString } = this._getTxData(ctx);

    const dispute = {
      id: disputeId,
      orderReference: orderReference,
      description: description,
      status: 'PENDING',
      raisedBy: clientId,
      evidence: [],
      resolutionNote: '',
      resolvedBy: '',
      createdAt: timestampString,
    };

    await ctx.stub.putState(disputeId, Buffer.from(JSON.stringify(dispute)));
    return JSON.stringify(dispute);
  }

  async AddEvidence(ctx, disputeId, evidenceNotes) {
    this._assertPartner(ctx);
    this._validateId(disputeId, 'Dispute ID');
    this._validateString(evidenceNotes, 1000, 'Evidence Notes');

    const dispute = await this._readDispute(ctx, disputeId);

    if (dispute.status === 'RESOLVED') {
      throw new Error('CONFLICT: Cannot add evidence to a resolved dispute.');
    }

    const { clientId, timestampString } = this._getTxData(ctx);

    dispute.evidence.push({
      submittedBy: clientId,
      notes: evidenceNotes,
      timestamp: timestampString,
    });

    await ctx.stub.putState(disputeId, Buffer.from(JSON.stringify(dispute)));
    return JSON.stringify(dispute);
  }

  async AdjudicateDispute(ctx, disputeId, resolutionNote) {
    // Enforce RBAC: Only an arbiter can resolve a dispute
    this._assertArbiter(ctx);
    this._validateId(disputeId, 'Dispute ID');
    this._validateString(resolutionNote, 1000, 'Resolution Note');

    const dispute = await this._readDispute(ctx, disputeId);

    if (dispute.status !== 'PENDING') {
      throw new Error('CONFLICT: Dispute is already resolved.');
    }

    const { clientId, timestampString } = this._getTxData(ctx);

    dispute.status = 'RESOLVED';
    dispute.resolutionNote = resolutionNote;
    dispute.resolvedBy = clientId;
    dispute.resolvedAt = timestampString;

    await ctx.stub.putState(disputeId, Buffer.from(JSON.stringify(dispute)));
    return JSON.stringify(dispute);
  }

  async GetDispute(ctx, disputeId) {
    this._validateId(disputeId, 'Dispute ID');
    const dispute = await this._readDispute(ctx, disputeId);
    return JSON.stringify(dispute);
  }

  async GetAllDisputes(ctx, pageSizeStr = '100', bookmark = '') {
    const pageSize = parseInt(pageSizeStr, 10);
    const { iterator, metadata } = await ctx.stub.getStateByRangeWithPagination(
      '',
      '',
      pageSize,
      bookmark
    );
    const allResults = [];

    try {
      let result = await iterator.next();
      while (!result.done) {
        const strValue = Buffer.from(result.value.value).toString('utf8');
        let record;
        try {
          record = JSON.parse(strValue);
        } catch (_err) {
          record = strValue;
        }
        allResults.push(record);
        result = await iterator.next();
      }
    } finally {
      if (iterator && typeof iterator.close === 'function') {
        await iterator.close();
      }
    }

    return JSON.stringify({
      records: allResults,
      bookmark: metadata?.fetchedRecordsCount === pageSize ? metadata.bookmark : '',
    });
  }

  async DisputeExists(ctx, disputeId) {
    const buffer = await ctx.stub.getState(disputeId);
    return !!buffer && buffer.length > 0;
  }

  async _readDispute(ctx, disputeId) {
    const buffer = await ctx.stub.getState(disputeId);
    if (!buffer || buffer.length === 0) {
      throw new Error(`NOT_FOUND: The dispute ${disputeId} does not exist`);
    }
    return JSON.parse(buffer.toString());
  }

  _assertArbiter(ctx) {
    const role = ctx.clientIdentity.getAttributeValue('role');
    if (role !== 'arbiter') {
      throw new Error(
        'ACCESS_DENIED: only identities with the "arbiter" role can adjudicate disputes.'
      );
    }
  }

  _assertPartner(ctx) {
    const role = ctx.clientIdentity.getAttributeValue('role');
    if (role !== 'partner') {
      throw new Error(
        'ACCESS_DENIED: only identities with the "partner" role can perform this action.'
      );
    }
  }

  _validateId(id, fieldName) {
    this._validateString(id, 100, fieldName);
    if (!/^[a-zA-Z0-9_-]+$/.test(id.trim())) {
      throw new Error(
        `VALIDATION: ${fieldName} can only contain alphanumeric characters, dashes, and underscores`
      );
    }
  }

  _validateString(str, maxLength, fieldName) {
    if (!str || typeof str !== 'string' || str.trim().length === 0) {
      throw new Error(`VALIDATION: ${fieldName} is required and cannot be empty`);
    }
    if (str.length > maxLength) {
      throw new Error(`VALIDATION: ${fieldName} must be less than ${maxLength} characters`);
    }
  }

  _getTxData(ctx) {
    const clientId =
      ctx.clientIdentity.getAttributeValue('hf.EnrollmentID') || ctx.clientIdentity.getID();
    const txTimestamp = ctx.stub.getTxTimestamp();
    const timestampString = new Date(txTimestamp.seconds.low * 1000).toISOString();
    return { clientId, timestampString };
  }
}
