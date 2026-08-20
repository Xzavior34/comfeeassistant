import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken, requireRole } from '../middleware/auth';
import { UserRole } from '@prisma/client';

const router = Router();
router.use(authenticateToken);

router.get('/', requireRole(UserRole.ADMIN, UserRole.CLINICIAN), (req: AuthenticatedRequest, res: Response) => {
  res.json({
    organisationId: req.user!.organisationId,
    auditTrail: [
      {
        id: 'audit-001',
        eventType: 'AUTH_LOGIN',
        actorId: req.user!.id,
        resourceType: 'User',
        resourceId: req.user!.id,
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        recordHash: 'a7c9f82d1e0582319f0a7b4c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e'
      },
      {
        id: 'audit-002',
        eventType: 'CONSENT_GRANTED',
        actorId: req.user!.id,
        resourceType: 'ConsentRecord',
        resourceId: 'demo-meeting-101',
        timestamp: new Date(Date.now() - 3000000).toISOString(),
        recordHash: 'b8d0e93f2a1693420a1b8c5d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f'
      }
    ]
  });
});

export default router;
