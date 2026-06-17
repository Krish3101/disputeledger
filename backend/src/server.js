import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { PORT } from './config.js';
import authRoutes from './api/auth.js';
import disputeRoutes from './api/disputes.js';
import { securityMiddleware } from './middleware/security.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(securityMiddleware);
app.use(rateLimitMiddleware);
app.use(cors());
app.use(express.json());

// Serve the static frontend
app.use(express.static(path.join(__dirname, '../../frontend')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/disputes', disputeRoutes);

// Fallback for SPA routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

app.listen(PORT, () => {
    console.log(`Dispute Resolution API listening on port ${PORT}`);
});
