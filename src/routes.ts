import { Router, type Request, type Response, type NextFunction } from 'express';
import { z, ZodError } from 'zod';
import type { Database } from 'better-sqlite3';
import {
  DomainError,
  UnauthenticatedError,
  ValidationError,
  type UserRole,
} from './domain.js';
import { deleteSession, getSessionUser, loginUser, type AuthUser } from './auth.js';
import {
  addEvidence,
  getDispute,
  getDisputeEvents,
  listDisputes,
  raiseDispute,
  resolveDispute,
} from './disputes.js';
import { verifyLedgerIntegrity } from './audit.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9_.-]+$/, 'Username must be lowercase alphanumeric with _, ., or -'),
  password: z.string().min(8).max(200),
});

const raiseDisputeSchema = z.object({
  orderReference: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_\-/.]+$/, 'Order reference contains invalid characters'),
  description: z.string().trim().min(1).max(2000),
  respondentId: z.string().trim().min(1),
});

const addEvidenceSchema = z.object({
  notes: z.string().trim().min(1).max(2000),
});

const resolveDisputeSchema = z.object({
  resolutionNote: z.string().trim().min(1).max(2000),
});

const listQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED']).optional(),
});

export function createRouter(db: Database): Router {
  const router = Router();

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

  function getParamId(req: Request): string {
    const id = req.params.id;
    return Array.isArray(id) ? id[0] : id;
  }

  // Public routes
  router.post('/login', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = loginSchema.parse(req.body);
      const result = loginUser(db, username, password);
      res.json(result);
    } catch (err) {
      next(err);
    }
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

  router.get('/partners', requireAuth, (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const items = db
        .prepare('SELECT id, username, displayName, role FROM users WHERE role = ? ORDER BY displayName ASC')
        .all('partner');
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/disputes', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const data = raiseDisputeSchema.parse(req.body);
      const dispute = raiseDispute(db, req.user!, data);
      res.status(201).json(dispute);
    } catch (err) {
      next(err);
    }
  });

  router.get('/disputes', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = listQuerySchema.parse(req.query);
      const items = listDisputes(db, req.user!, query.status);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.get('/disputes/:id', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const dispute = getDispute(db, req.user!, getParamId(req));
      res.json(dispute);
    } catch (err) {
      next(err);
    }
  });

  router.post('/disputes/:id/evidence', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const data = addEvidenceSchema.parse(req.body);
      const dispute = addEvidence(db, req.user!, getParamId(req), data);
      res.status(201).json(dispute);
    } catch (err) {
      next(err);
    }
  });

  router.post('/disputes/:id/resolution', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const data = resolveDisputeSchema.parse(req.body);
      const dispute = resolveDispute(db, req.user!, getParamId(req), data);
      res.json(dispute);
    } catch (err) {
      next(err);
    }
  });

  router.get('/disputes/:id/events', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const items = getDisputeEvents(db, req.user!, getParamId(req));
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.get('/integrity', requireAuth, (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = verifyLedgerIntegrity(db);
      res.json(result);
    } catch (err) {
      next(err);
    }
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

  router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
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

    // Default internal server error - never leak internal stack, paths, or SQL
    console.error('Unhandled internal error:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'An internal server error occurred.',
      },
    });
  });

  return router;
}
