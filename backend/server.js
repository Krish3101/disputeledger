import express from 'express';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PORT,
  getContract,
  registerUser,
  authenticateAndIssueToken,
  requireAuth,
} from './fabric.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many requests' } }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Utilities
const validateId = (id, field = 'ID') => {
  if (!id || typeof id !== 'string')
    throw new Error(`VALIDATION: ${field} is required and must be a string`);
  const sanitized = id.trim();
  if (sanitized.length === 0 || sanitized.length > 100)
    throw new Error(`VALIDATION: ${field} must be between 1 and 100 characters`);
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized))
    throw new Error(
      `VALIDATION: ${field} can only contain alphanumeric characters, dashes, and underscores`
    );
  return sanitized;
};

const validateText = (text, field = 'Text', max = 1000) => {
  if (!text || typeof text !== 'string')
    throw new Error(`VALIDATION: ${field} is required and must be a string`);
  const sanitized = text.trim();
  if (sanitized.length === 0) throw new Error(`VALIDATION: ${field} cannot be empty`);
  if (sanitized.length > max)
    throw new Error(`VALIDATION: ${field} must not exceed ${max} characters`);
  return sanitized;
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Auth Routes
app.post(
  '/api/auth/register',
  asyncHandler(async (req, res) => {
    const validUsername = validateId(req.body.username, 'Username');
    const role = req.body.role;
    if (role !== 'partner' && role !== 'arbiter')
      return res.status(400).json({ error: 'Role must be partner or arbiter' });
    await registerUser(validUsername, role);
    res.json({ message: `User ${validUsername} successfully registered with role ${role}` });
  })
);

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const validUsername = validateId(req.body.username, 'Username');
    const { token, role } = await authenticateAndIssueToken(validUsername);
    res.json({ token, username: validUsername, role });
  })
);

// Dispute Routes (Protected)
app.use('/api/disputes', requireAuth);

app.get(
  '/api/disputes',
  asyncHandler(async (req, res) => {
    const { contract } = await getContract(req.user);
    const resultBytes = await contract.evaluateTransaction(
      'GetAllDisputes',
      req.query.pageSize || '100',
      req.query.bookmark || ''
    );
    res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
  })
);

app.post(
  '/api/disputes',
  asyncHandler(async (req, res) => {
    const { contract } = await getContract(req.user);
    const resultBytes = await contract.submitTransaction(
      'RaiseDispute',
      validateId(req.body.disputeId),
      validateId(req.body.orderReference),
      validateText(req.body.description)
    );
    res.status(201).json(JSON.parse(new TextDecoder().decode(resultBytes)));
  })
);

app.patch(
  '/api/disputes/:id/evidence',
  asyncHandler(async (req, res) => {
    const { contract } = await getContract(req.user);
    const resultBytes = await contract.submitTransaction(
      'AddEvidence',
      validateId(req.params.id),
      validateText(req.body.notes)
    );
    res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
  })
);

app.patch(
  '/api/disputes/:id/resolve',
  asyncHandler(async (req, res) => {
    const { contract } = await getContract(req.user);
    const resultBytes = await contract.submitTransaction(
      'AdjudicateDispute',
      validateId(req.params.id),
      validateText(req.body.resolutionNote)
    );
    res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
  })
);

// Fallback & Errors
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

app.use((err, req, res, _next) => {
  const msg = err?.details?.[0]?.message || err?.cause?.message || err.message || '';
  if (msg.includes('ACCESS_DENIED:')) return res.status(403).json({ error: msg });
  if (msg.includes('CONFLICT:') || msg.includes('VALIDATION:'))
    return res.status(400).json({ error: msg });
  if (msg.includes('NOT_FOUND:')) return res.status(404).json({ error: msg });
  if (msg.includes('administrator needs to be enrolled') || msg.includes('User not found'))
    return res.status(401).json({ error: msg });
  if (msg.includes('Fabric connection profile not found'))
    return res.status(503).json({ error: msg });
  console.error('System Error:', err);
  res.status(500).json({ error: 'An internal error occurred processing the request.' });
});

app.listen(PORT, () => console.log(`Dispute Resolution API listening on port ${PORT}`));
