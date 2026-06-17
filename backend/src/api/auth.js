import express from 'express';
import { registerUser, authenticateAndIssueToken } from '../services/authService.js';
import { validateId } from '../utils/validation.js';

const router = express.Router();

/**
 * POST /api/auth/register
 * Register a new partner or arbiter
 */
router.post('/register', async (req, res) => {
    try {
        const validUsername = validateId(req.body.username, 'Username');
        const role = req.body.role;
        if (!role) {
            return res.status(400).json({ error: 'Role is required' });
        }
        if (role !== 'partner' && role !== 'arbiter') {
            return res.status(400).json({ error: 'Role must be partner or arbiter' });
        }

        await registerUser(validUsername, role);
        res.json({ message: `User ${validUsername} successfully registered with role ${role}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/auth/login
 * Log in to receive a JWT
 */
router.post('/login', async (req, res) => {
    try {
        const validUsername = validateId(req.body.username, 'Username');


        const token = await authenticateAndIssueToken(validUsername);
        res.json({ token, username: validUsername });
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
});

export default router;
