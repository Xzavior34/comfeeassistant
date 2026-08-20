import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { DEMO_MEETINGS } from './meetings';

const router = Router();
router.use(authenticateToken);

router.get('/:meetingId', (req: AuthenticatedRequest, res: Response) => {
  const { meetingId } = req.params;
  const meeting = DEMO_MEETINGS[meetingId];

  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

  if (meeting.organisationId !== req.user!.organisationId) {
    return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
  }

  res.json({
    meetingId,
    segments: meeting.canonicalSegments || []
  });
});

export default router;
