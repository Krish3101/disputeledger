import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import { AppError } from './rules.js';
import { deleteSession, getSessionUser, loginUser, type AuthUser } from './auth.js';
import {
  addEvidence,
  getDispute,
  getDisputeEvents,
  listDisputes,
  raiseDispute,
  resolveDispute,
} from './disputes.js';
import { verifyLedger } from './ledger.js';
import { getLedgerKey } from './config.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const wellFormedUnicode = (s: string) => typeof s.isWellFormed === 'function' ? s.isWellFormed() : true;

const loginSchema = z.object({
  // Lowercased first so "Supplier" logs in like "supplier"
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9_.-]+$/, 'Username must be lowercase alphanumeric with _, ., or -')
    .refine(wellFormedUnicode, 'invalid Unicode'),
  password: z
    .string()
    .min(8)
    .max(200)
    .refine(wellFormedUnicode, 'invalid Unicode'),
});

const raiseDisputeSchema = z.object({
  orderReference: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_\-/.]+$/, 'Order reference contains invalid characters')
    .refine(wellFormedUnicode, 'invalid Unicode'),
  description: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine(wellFormedUnicode, 'invalid Unicode'),
  respondentId: z
    .string()
    .trim()
    .min(1)
    .refine(wellFormedUnicode, 'invalid Unicode'),
});

const addEvidenceSchema = z.object({
  notes: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine(wellFormedUnicode, 'invalid Unicode'),
});

const resolveDisputeSchema = z.object({
  resolutionNote: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine(wellFormedUnicode, 'invalid Unicode'),
});

export function createRouter(db: Database): Router {
  const router = Router();

  function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
    }
    const user = getSessionUser(db, token);
    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
    }
    req.user = user;
    next();
  }

  // Public unauthenticated health check
  router.get('/health', (_req: Request, res: Response) => {
    let dbOk = false;
    try {
      db.prepare('SELECT 1').get();
      dbOk = true;
    } catch {
      dbOk = false;
    }

    let ledgerKeyOk = false;
    try {
      ledgerKeyOk = !!getLedgerKey();
    } catch {
      ledgerKeyOk = false;
    }

    res.json({
      status: dbOk && ledgerKeyOk ? 'healthy' : 'degraded',
      db: dbOk,
      ledgerKey: ledgerKeyOk,
    });
  });

  // Public login route
  router.post('/login', (req: Request, res: Response) => {
    const { username, password } = loginSchema.parse(req.body);
    const result = loginUser(db, username, password);
    res.json(result);
  });

  // Protected routes
  router.post('/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      deleteSession(db, token);
    }
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  router.get('/partners', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    // Usernames are left out so partners can't harvest login names
    const items = db
      .prepare('SELECT id, displayName, role FROM users WHERE role = ? ORDER BY displayName ASC')
      .all('partner');
    res.json({ items });
  });

  router.post('/disputes', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const data = raiseDisputeSchema.parse(req.body);
    const dispute = raiseDispute(db, req.user!, data);
    res.status(201).json(dispute);
  });

  router.get('/disputes', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const items = listDisputes(db, req.user!);
    res.json({ items });
  });

  router.get('/disputes/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const dispute = getDispute(db, req.user!, req.params.id);
    res.json(dispute);
  });

  router.post('/disputes/:id/evidence', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const data = addEvidenceSchema.parse(req.body);
    const dispute = addEvidence(db, req.user!, req.params.id, data);
    res.status(201).json(dispute);
  });

  router.post('/disputes/:id/resolution', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const data = resolveDisputeSchema.parse(req.body);
    const dispute = resolveDispute(db, req.user!, req.params.id, data);
    res.json(dispute);
  });

  router.get('/disputes/:id/events', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const items = getDisputeEvents(db, req.user!, req.params.id);
    res.json({ items });
  });

  // Only the arbiter can run the full check: it reads every dispute, not just the caller's own
  router.get('/ledger/verify', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'arbiter') {
      throw new AppError(403, 'FORBIDDEN', 'Only the arbiter can verify the ledger.');
    }
    res.json(verifyLedger(db));
  });

  // 404 handler for unmatched API routes
  router.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'API endpoint not found.',
      },
    });
  });

  return router;
}
