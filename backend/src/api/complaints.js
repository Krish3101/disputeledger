const { validateComplaintId, validateText, validateUserId } = require('../utils/validation');
const { getContract } = require('../services/fabricService');

/**
 * POST /complaints
 * Create a new complaint
 */
async function createComplaint(req, res) {
  try {
    const { id, user, description } = req.body;
    const asUser = req.user;
    
    
    const complaintId = validateComplaintId(id);
    const userId = validateUserId(user);
    const desc = validateText(description, 'Description', 1000);
    
    
    const { gateway, contract } = await getContract(asUser);
    const result = await contract.submitTransaction('CreateComplaint', complaintId, userId, desc);
    gateway.disconnect();
    res.json(JSON.parse(result.toString()));
  } catch (e) {
    console.error('Error creating complaint:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /complaints/:id
 * Read a specific complaint
 */
async function readComplaint(req, res) {
  try {
    const asUser = req.user;
    
    
    const complaintId = validateComplaintId(req.params.id);
    
    
    const { gateway, contract } = await getContract(asUser);
    const result = await contract.evaluateTransaction('ReadComplaint', complaintId);
    gateway.disconnect();
    res.json(JSON.parse(result.toString()));
  } catch (e) {
    console.error('Error reading complaint:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /complaints
 * Get all complaints or filter by status
 */
async function listComplaints(req, res) {
  try {
    const { status, as } = req.query;
    
    
    
    const { gateway, contract } = await getContract(asUser);
    
    if (!status) {
      const result = await contract.evaluateTransaction('GetAllComplaints');
      gateway.disconnect();
      return res.json(JSON.parse(result.toString()));
    }
    
    if (status !== 'OPEN' && status !== 'RESOLVED') {
      gateway.disconnect();
      return res.status(400).json({ error: 'status must be either OPEN or RESOLVED' });
    }
    
    const result = await contract.evaluateTransaction('GetComplaintsByStatus', status);
    gateway.disconnect();
    res.json(JSON.parse(result.toString()));
  } catch (e) {
    console.error('Error getting complaints:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * PATCH /complaints/:id/resolve
 * Resolve a complaint
 */
async function resolveComplaint(req, res) {
  try {
    const note = req.body.note || '';
    const asUser = req.user;
    
    
    const complaintId = validateComplaintId(req.params.id);
    const resolutionNote = note ? validateText(note, 'Resolution note', 1000) : '';
    
    
    const { gateway, contract } = await getContract(asUser);
    const result = await contract.submitTransaction('ResolveComplaint', complaintId, resolutionNote);
    gateway.disconnect();
    res.json(JSON.parse(result.toString()));
  } catch (e) {
    console.error('Error resolving complaint:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * PATCH /complaints/:id
 * Update complaint description
 */
async function updateComplaint(req, res) {
  try {
    const { description } = req.body;
    const asUser = req.user;
    
    
    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }
    
    const complaintId = validateComplaintId(req.params.id);
    const newDescription = validateText(description, 'Description', 1000);
    
    
    const { gateway, contract } = await getContract(asUser);
    const result = await contract.submitTransaction('UpdateComplaint', complaintId, newDescription);
    gateway.disconnect();
    res.json(JSON.parse(result.toString()));
  } catch (e) {
    console.error('Error updating complaint:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /complaints/:id
 * Delete a complaint
 */
async function deleteComplaint(req, res) {
  try {
    const asUser = req.user;
    
    
    const complaintId = validateComplaintId(req.params.id);
    
    
    const { gateway, contract } = await getContract(asUser);
    const result = await contract.submitTransaction('DeleteComplaint', complaintId);
    gateway.disconnect();
    res.json(JSON.parse(result.toString()));
  } catch (e) {
    console.error('Error deleting complaint:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * PATCH /complaints/:id/assign
 * Assign complaint to authority
 */
async function assignComplaint(req, res) {
  try {
    const { assignedTo } = req.body;
    const asUser = req.user;
    
    
    if (!assignedTo) {
      return res.status(400).json({ error: 'assignedTo is required in request body' });
    }
    
    const complaintId = validateComplaintId(req.params.id);
    const assignToUser = validateUserId(assignedTo);
    
    
    const { gateway, contract } = await getContract(asUser);
    const result = await contract.submitTransaction('AssignComplaint', complaintId, assignToUser);
    gateway.disconnect();
    res.json(JSON.parse(result.toString()));
  } catch (e) {
    console.error('Error assigning complaint:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /complaints/assigned/:authorityId
 * Get complaints assigned to a specific authority
 */
async function getAssignedComplaints(req, res) {
  try {
    const asUser = req.user;
    
    
    const authorityId = validateUserId(req.params.authorityId);
    
    
    const { gateway, contract } = await getContract(asUser);
    const result = await contract.evaluateTransaction('GetAssignedComplaints', authorityId);
    gateway.disconnect();
    res.json(JSON.parse(result.toString()));
  } catch (e) {
    console.error('Error getting assigned complaints:', e);
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  createComplaint,
  readComplaint,
  listComplaints,
  resolveComplaint,
  updateComplaint,
  deleteComplaint,
  assignComplaint,
  getAssignedComplaints,
};
