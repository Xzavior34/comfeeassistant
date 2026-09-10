import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken, requireRole } from '../middleware/auth';
import { UserRole } from '@prisma/client';
import { prisma } from '../db';

const router = Router();
router.use(authenticateToken);

/**
 * This used to return two hardcoded example rows, always, for every organisation — a false
 * "audit trail" that never reflected anything that actually happened. It now reads the real,
 * persisted AuditLog table (see auditLogger.ts), scoped to the caller's own organisation.
 */
router.get('/', requireRole(UserRole.ADMIN, UserRole.CLINICIAN), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);

    const auditTrail = await prisma.auditLog.findMany({
      where: { organisationId: req.user!.organisationId },
      orderBy: { timestamp: 'desc' },
      take: limit
    });

    res.json({ organisationId: req.user!.organisationId, auditTrail });
  } catch (error) {
    console.error('[audit] Failed to load audit trail:', error);
    res.status(500).json({ error: 'Failed to load audit trail.' });
  }
});

export default router;
