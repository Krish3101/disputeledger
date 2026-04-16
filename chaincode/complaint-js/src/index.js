/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const { Contract } = require('fabric-contract-api');

/**
 * ComplaintContract - Smart contract for managing complaints on Hyperledger Fabric
 * 
 * Features:
 * - Create complaints with unique IDs
 * - Read individual complaints
 * - Resolve complaints (authority role only)
 * - Query complaints by status
 */
class ComplaintContract extends Contract {

  /**
   * Creates a new complaint
   * @param {Context} ctx - Transaction context
   * @param {string} complaintID - Unique identifier for the complaint
   * @param {string} user - User who created the complaint
   * @param {string} description - Description of the complaint
   * @returns {string} JSON string of the created complaint
   */
  async CreateComplaint(ctx, complaintID, user, description) {
    if (!complaintID || !user || !description) {
      throw new Error('CreateComplaint requires complaintID, user, description');
    }
    const exists = await this.ComplaintExists(ctx, complaintID);
    if (exists) {
      throw new Error(`Complaint ${complaintID} already exists`);
    }

    const ts = ctx.stub.getTxTimestamp();
    const createdAt = (Number(ts.seconds) * 1000) + Math.floor(Number(ts.nanos) / 1e6);

    const complaint = {
      complaintID,
      user,
      description,
      status: 'OPEN',
      resolutionNote: '',
      assignedTo: null,
      createdAt,
      updatedAt: createdAt,
      resolvedAt: null
    };

    await ctx.stub.putState(complaintID, Buffer.from(JSON.stringify(complaint)));
    return JSON.stringify(complaint);
  }

  /**
   * Resolves a complaint (authority role required)
   * @param {Context} ctx - Transaction context
   * @param {string} complaintID - ID of the complaint to resolve
   * @param {string} resolutionNote - Note describing the resolution
   * @returns {string} JSON string of the resolved complaint
   */
  async ResolveComplaint(ctx, complaintID, resolutionNote) {
    await this._assertAuthority(ctx);
    const complaint = await this._read(ctx, complaintID);
    if (complaint.status === 'RESOLVED') {
      throw new Error(`Complaint ${complaintID} is already resolved`);
    }
    const ts = ctx.stub.getTxTimestamp();
    complaint.status = 'RESOLVED';
    complaint.resolutionNote = resolutionNote || '';
    complaint.resolvedAt = (Number(ts.seconds) * 1000) + Math.floor(Number(ts.nanos) / 1e6);

    await ctx.stub.putState(complaintID, Buffer.from(JSON.stringify(complaint)));
    return JSON.stringify(complaint);
  }

  /**
   * Updates a complaint description (only if not resolved)
   * @param {Context} ctx - Transaction context
   * @param {string} complaintID - ID of the complaint to update
   * @param {string} newDescription - New description for the complaint
   * @returns {string} JSON string of the updated complaint
   */
  async UpdateComplaint(ctx, complaintID, newDescription) {
    if (!newDescription) {
      throw new Error('newDescription is required');
    }
    
    const complaint = await this._read(ctx, complaintID);
    
    if (complaint.status === 'RESOLVED') {
      throw new Error(`Cannot update resolved complaint ${complaintID}`);
    }
    
    const ts = ctx.stub.getTxTimestamp();
    complaint.description = newDescription;
    complaint.updatedAt = (Number(ts.seconds) * 1000) + Math.floor(Number(ts.nanos) / 1e6);
    
    await ctx.stub.putState(complaintID, Buffer.from(JSON.stringify(complaint)));
    return JSON.stringify(complaint);
  }

  /**
   * Reads a complaint by ID
   * @param {Context} ctx - Transaction context
   * @param {string} complaintID - ID of the complaint to read
   * @returns {string} JSON string of the complaint
   */
  async ReadComplaint(ctx, complaintID) {
    const c = await this._read(ctx, complaintID);
    return JSON.stringify(c);
  }

  /**
   * Gets all complaints with a specific status
   * @param {Context} ctx - Transaction context
   * @param {string} status - Status to filter by (OPEN or RESOLVED)
   * @returns {string} JSON string array of matching complaints
   */
  async GetComplaintsByStatus(ctx, status) {
    if (!status) throw new Error('status is required');
    const iterator = await ctx.stub.getStateByRange('', '');
    const results = [];
    for await (const res of iterator) {
      if (!res || !res.value) continue;
      try {
        const obj = JSON.parse(res.value.toString('utf8'));
        if (obj.status === status) results.push(obj);
      } catch (e) {
        // skip non-JSON states
      }
    }
    return JSON.stringify(results);
  }

  /**
   * Gets all complaints (no filter)
   * @param {Context} ctx - Transaction context
   * @returns {string} JSON string array of all complaints
   */
  async GetAllComplaints(ctx) {
    const iterator = await ctx.stub.getStateByRange('', '');
    const results = [];
    for await (const res of iterator) {
      if (!res || !res.value) continue;
      try {
        const obj = JSON.parse(res.value.toString('utf8'));
        if (obj.complaintID && obj.status) {
          results.push(obj);
        }
      } catch (e) {
        // skip non-JSON states
      }
    }
    return JSON.stringify(results);
  }

  /**
   * Deletes a complaint (authority role required)
   * @param {Context} ctx - Transaction context
   * @param {string} complaintID - ID of the complaint to delete
   * @returns {string} JSON string confirming deletion
   */
  async DeleteComplaint(ctx, complaintID) {
    await this._assertAuthority(ctx);
    const complaint = await this._read(ctx, complaintID);
    const deletedComplaint = { ...complaint };
    
    await ctx.stub.deleteState(complaintID);
    return JSON.stringify({ 
      message: `Complaint ${complaintID} has been deleted`,
      deletedComplaint 
    });
  }

  /**
   * Assigns a complaint to an authority user
   * @param {Context} ctx - Transaction context
   * @param {string} complaintID - ID of the complaint to assign
   * @param {string} assignedTo - User ID of the authority to assign to
   * @returns {string} JSON string of the updated complaint
   */
  async AssignComplaint(ctx, complaintID, assignedTo) {
    await this._assertAuthority(ctx);
    const complaint = await this._read(ctx, complaintID);
    
    if (!assignedTo) {
      throw new Error('assignedTo parameter is required');
    }
    
    const ts = ctx.stub.getTxTimestamp();
    complaint.assignedTo = assignedTo;
    complaint.updatedAt = (Number(ts.seconds) * 1000) + Math.floor(Number(ts.nanos) / 1e6);
    
    await ctx.stub.putState(complaintID, Buffer.from(JSON.stringify(complaint)));
    return JSON.stringify(complaint);
  }

  /**
   * Gets all complaints assigned to a specific authority
   * @param {Context} ctx - Transaction context
   * @param {string} authorityId - Authority user ID
   * @returns {string} JSON string array of assigned complaints
   */
  async GetAssignedComplaints(ctx, authorityId) {
    if (!authorityId) throw new Error('authorityId is required');
    const iterator = await ctx.stub.getStateByRange('', '');
    const results = [];
    for await (const res of iterator) {
      if (!res || !res.value) continue;
      try {
        const obj = JSON.parse(res.value.toString('utf8'));
        if (obj.complaintID && obj.assignedTo === authorityId) {
          results.push(obj);
        }
      } catch (e) {
        // skip non-JSON states
      }
    }
    return JSON.stringify(results);
  }

  /**
   * Checks if a complaint exists
   * @param {Context} ctx - Transaction context
   * @param {string} id - Complaint ID
   * @returns {boolean} True if complaint exists
   */
  async ComplaintExists(ctx, id) {
    const data = await ctx.stub.getState(id);
    return data && data.length > 0;
  }

  /**
   * Reads and parses a complaint from the ledger
   * @param {Context} ctx - Transaction context
   * @param {string} id - Complaint ID
   * @returns {Object} Parsed complaint object
   * @private
   */
  async _read(ctx, id) {
    if (!id) throw new Error('id is required');
    const data = await ctx.stub.getState(id);
    if (!data || data.length === 0) {
      throw new Error(`Complaint ${id} does not exist`);
    }
    try {
      return JSON.parse(data.toString('utf8'));
    } catch (e) {
      throw new Error(`Stored data for ${id} is not valid JSON`);
    }
  }

  /**
   * Validates that the caller has authority role
   * @param {Context} ctx - Transaction context
   * @throws {Error} If caller does not have authority role
   * @private
   */
  async _assertAuthority(ctx) {
    const cid = ctx.clientIdentity;
    const role = cid.getAttributeValue('role');
    if (role !== 'authority') {
      throw new Error('Access denied: only users with attribute role=authority can resolve complaints');
    }
  }
}

module.exports = ComplaintContract;
