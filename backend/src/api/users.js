const { validateUserId, validateText } = require('../utils/validation');
const { loadCCP, registerUser, getWallet } = require('../services/fabricService');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

/**
 * POST /users/register
 * Register a new user with optional role
 */
async function registerNewUser(req, res) {
  try {
    const { userId, role } = req.body;
    const sanitizedUserId = validateUserId(userId);
    const attrs = [];
    
    if (role) {
      const sanitizedRole = validateText(role, 'Role', 50);
      if (sanitizedRole !== 'authority' && sanitizedRole !== 'citizen') {
        return res.status(400).json({ error: 'Role must be either "authority" or "citizen"' });
      }
      attrs.push({ name: 'role', value: sanitizedRole });
    }
    
    const ccp = loadCCP();
    await registerUser(ccp, sanitizedUserId, attrs);
    
    res.json({ 
      ok: true, 
      message: `User ${sanitizedUserId} registered successfully`,
      userId: sanitizedUserId,
      role: role || 'citizen'
    });
  } catch (e) {
    console.error('Error registering user:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /users
 * Get list of registered users
 */
async function listUsers(req, res) {
  try {
    const wallet = await getWallet();
    const identities = await wallet.list();
    const users = identities
      .filter(id => id.label !== 'admin')
      .map(id => ({ userId: id.label }));
    res.json({ users });
  } catch (e) {
    console.error('Error listing users:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /users/:userId/exists
 * Check if a user exists
 */
async function checkUserExists(req, res) {
  try {
    const userId = validateUserId(req.params.userId);
    const wallet = await getWallet();
    const identity = await wallet.get(userId);
    res.json({ exists: !!identity, userId });
  } catch (e) {
    console.error('Error checking user:', e);
    res.status(500).json({ error: e.message });
  }
}
/**
 * POST /users/login
 * Login and receive JWT
 */
async function loginUser(req, res) {
  try {
    const { userId } = req.body;
    const sanitizedUserId = validateUserId(userId);
    const wallet = await getWallet();
    const identity = await wallet.get(sanitizedUserId);
    
    if (!identity) {
      return res.status(401).json({ error: 'User not found. Please register first.' });
    }
    
    const token = jwt.sign({ userId: sanitizedUserId }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ ok: true, token, userId: sanitizedUserId });
  } catch (e) {
    console.error('Error logging in:', e);
    res.status(500).json({ error: e.message });
  }
}


module.exports = {
  registerNewUser,
  listUsers,
  checkUserExists,
  loginUser,
};
