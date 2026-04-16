// Input validation utilities for complaint-fabric-starter API

function validateComplaintId(id) {
  if (!id || typeof id !== 'string') {
    throw new Error('Complaint ID is required and must be a string');
  }
  const sanitized = id.trim();
  if (sanitized.length === 0 || sanitized.length > 100) {
    throw new Error('Complaint ID must be between 1 and 100 characters');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    throw new Error('Complaint ID can only contain alphanumeric characters, dashes, and underscores');
  }
  return sanitized;
}

function validateText(text, fieldName, maxLength = 1000) {
  if (!text || typeof text !== 'string') {
    throw new Error(`${fieldName} is required and must be a string`);
  }
  const sanitized = text.trim();
  if (sanitized.length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  if (sanitized.length > maxLength) {
    throw new Error(`${fieldName} must not exceed ${maxLength} characters`);
  }
  return sanitized;
}

function validateUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('User ID is required and must be a string');
  }
  const sanitized = userId.trim();
  if (sanitized.length === 0 || sanitized.length > 50) {
    throw new Error('User ID must be between 1 and 50 characters');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    throw new Error('User ID can only contain alphanumeric characters, dashes, and underscores');
  }
  return sanitized;
}

module.exports = {
  validateComplaintId,
  validateText,
  validateUserId,
};
