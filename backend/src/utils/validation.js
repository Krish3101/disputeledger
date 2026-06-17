/**
 * Validates identifier strings (e.g., usernames, dispute IDs, order references).
 * Prevents NoSQL/Command injection and strictly enforces formatting.
 */
export function validateId(id, fieldName = 'ID') {
    if (!id || typeof id !== 'string') {
        throw new Error(`${fieldName} is required and must be a string`);
    }
    const sanitized = id.trim();
    if (sanitized.length === 0 || sanitized.length > 100) {
        throw new Error(`${fieldName} must be between 1 and 100 characters`);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
        throw new Error(`${fieldName} can only contain alphanumeric characters, dashes, and underscores`);
    }
    return sanitized;
}

/**
 * Validates free-form text inputs (e.g., descriptions, evidence notes).
 */
export function validateText(text, fieldName = 'Text', maxLength = 1000) {
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
