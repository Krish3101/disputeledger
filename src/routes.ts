import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import type { Database } from 'better-sqlite3';
import { DomainError, ForbiddenError, UnauthenticatedError } from './domain.js';
import { deleteSession, getSessionUser, loginUser, type AuthUser } from './auth.js';
import {
  addEvidence,
  getDispute,
  getDisputeEvents,
  listDisputes,
  raiseDispute,
  resolveDispute,
} from './disputes.js';
import { verifyLedgerIntegrity } from './ledger/reconcile.js';
import { getLedgerKey } from './config.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const wellFormedUnicode = (s: string) => typeof s.isWellFormed === 'function' ? s.isWellFormed() : true;

const loginSchema = z.object({
  username: z
    .string()
    .trim()
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

export interface RateLimitOptions {
  integrityPerMinute?: number;
  writesPerMinute?: number;
}

export function createRouter(db: Database, limits: RateLimitOptions = {}): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    // Counted per IP and username, so one user's typos don't lock out everyone behind the same NAT
    keyGenerator: (req) => {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
      return `${ipKeyGenerator(req.ip ?? '')}:${username}`;
    },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many login attempts. Please try again later.',
      },
    },
  });

  // The integrity check replays the whole chain on the main thread, so it gets a tight per-IP cap
  const integrityLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: limits.integrityPerMinute ?? 10,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many integrity checks. Please try again later.',
      },
    },
  });

  // Runs after requireAuth, so writes are counted per user rather than per shared IP
  const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: limits.writesPerMinute ?? 60,
    keyGenerator: (req) => (req as AuthenticatedRequest).user?.id ?? ipKeyGenerator(req.ip ?? ''),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many changes in a short time. Please try again later.',
      },
    },
  });

  function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthenticatedError();
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new UnauthenticatedError();
    }
    const user = getSessionUser(db, token);
    if (!user) {
      throw new UnauthenticatedError();
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

  // Public login route with rate limiting
  router.post('/login', loginLimiter, (req: Request, res: Response) => {
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

  router.post('/disputes', requireAuth, writeLimiter, (req: AuthenticatedRequest, res: Response) => {
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

  router.post('/disputes/:id/evidence', requireAuth, writeLimiter, (req: AuthenticatedRequest, res: Response) => {
    const data = addEvidenceSchema.parse(req.body);
    const dispute = addEvidence(db, req.user!, req.params.id, data);
    res.status(201).json(dispute);
  });

  router.post('/disputes/:id/resolution', requireAuth, writeLimiter, (req: AuthenticatedRequest, res: Response) => {
    const data = resolveDisputeSchema.parse(req.body);
    const dispute = resolveDispute(db, req.user!, req.params.id, data);
    res.json(dispute);
  });

  router.get('/disputes/:id/events', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const items = getDisputeEvents(db, req.user!, req.params.id);
    res.json({ items });
  });

  // Only the arbiter can run the full check: it reads every dispute, not just the caller's own
  router.get('/integrity', requireAuth, integrityLimiter, (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'arbiter') {
      throw new ForbiddenError('Only the arbiter can verify the ledger.');
    }
    res.json(verifyLedgerIntegrity(db));
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

  // API router error handler
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainError) {
      return res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
        },
      });
    }

    if (err instanceof ZodError) {
      const firstIssue = err.issues[0];
      const pathPrefix = firstIssue && firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ` : '';
      const message = firstIssue ? `${pathPrefix}${firstIssue.message}` : 'Validation failed';
      return res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message,
        },
      });
    }

    // Pass to app-level error handler
    _next(err);
  });

  return router;
}
