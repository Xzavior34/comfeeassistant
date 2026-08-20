import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { MeetingState } from '@prisma/client';
import { canTransition } from '../state/meetingStateMachine';

const router = Router();

// In-memory meeting store for test path
export const DEMO_MEETINGS: Record<string, any> = {
  'demo-meeting-101': {
    id: 'demo-meeting-101',
    organisationId: 'NHS-UK-TRUST-01',
    clinicianId: 'user-clinician-1',
    clientReference: 'CLIENT-REF-8842',
    meetingType: 'PHYSICAL_SEATING_ASSESSMENT',
    status: MeetingState.CREATED,
    expectedSpeakerCount: 2,
    consentStatus: false,
    createdAt: new Date().toISOString()
  }
};

router.use(authenticateToken);

router.get('/', (req: AuthenticatedRequest, res: Response) => {
  const userOrgId = req.user!.organisationId;
  const meetings = Object.values(DEMO_MEETINGS).filter((m) => m.organisationId === userOrgId);
  res.json({ meetings });
});

router.post('/', (req: AuthenticatedRequest, res: Response) => {
  const { clientReference, meetingType, expectedSpeakerCount } = req.body;

  if (!clientReference) {
    return res.status(400).json({ error: 'clientReference pseudonymous code is required.' });
  }

  const newMeeting = {
    id: `m-${Date.now()}`,
    organisationId: req.user!.organisationId,
    clinicianId: req.user!.id,
    clientReference,
    meetingType: meetingType || 'PHYSICAL_SEATING_ASSESSMENT',
    status: MeetingState.CREATED,
    expectedSpeakerCount: expectedSpeakerCount || 2,
    consentStatus: false,
    createdAt: new Date().toISOString()
  };

  DEMO_MEETINGS[newMeeting.id] = newMeeting;
  res.status(201).json({ meeting: newMeeting });
});

router.patch('/:id/state', (req: AuthenticatedRequest, res: Response) => {
  const meeting = DEMO_MEETINGS[req.params.id];
  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

  // Cross-tenant protection
  if (meeting.organisationId !== req.user!.organisationId) {
    return res.status(403).json({ error: 'Forbidden: Access denied to foreign organisation resource.' });
  }

  const { targetState } = req.body;
  if (!canTransition(meeting.status, targetState)) {
    return res.status(400).json({ error: `Invalid state transition from ${meeting.status} to ${targetState}` });
  }

  meeting.status = targetState;
  res.json({ meeting });
});

export default router;
