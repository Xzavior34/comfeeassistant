import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { DEMO_MEETINGS } from './meetings';
import { MeetingState } from '@prisma/client';
import { auditLogger } from '../services/auditLogger';

const router = Router();
router.use(authenticateToken);

router.post('/:meetingId', (req: AuthenticatedRequest, res: Response) => {
  const { meetingId } = req.params;
  const { consentStatus, consentVersion, policyVersion, participantRef } = req.body;

  const meeting = DEMO_MEETINGS[meetingId];
  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

  if (meeting.organisationId !== req.user!.organisationId) {
    return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
  }

  const isGranted = consentStatus === 'GRANTED';
  meeting.consentStatus = isGranted;
  if (isGranted && meeting.status === MeetingState.CREATED) {
    meeting.status = MeetingState.READY;
  }

  auditLogger.log({
    organisationId: req.user!.organisationId,
    actorId: req.user!.id,
    eventType: isGranted ? 'CONSENT_GRANTED' : 'CONSENT_DENIED',
    resourceType: 'ConsentRecord',
    resourceId: meetingId,
    details: { consentVersion, policyVersion, participantRef }
  });

  res.json({
    meetingId,
    consentStatus: isGranted ? 'GRANTED' : 'DENIED',
    meetingState: meeting.status,
    timestamp: new Date().toISOString()
  });
});

export default router;
