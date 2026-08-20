import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { MeetingState } from '@prisma/client';
import { auditLogger } from '../services/auditLogger';
import { prisma } from '../db';

const router = Router();
router.use(authenticateToken);

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { meetingId, consentGranted, consentVersion, policyVersion, participantRef } = req.body;

    if (!meetingId) {
      return res.status(400).json({ error: 'meetingId is required.' });
    }

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    if (meeting.organisationId !== req.user!.organisationId) {
      return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
    }

    const isGranted = consentGranted === true || consentGranted === 'true';
    
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        consentStatus: isGranted,
        status: (isGranted && meeting.status === MeetingState.CREATED) ? MeetingState.READY : undefined
      }
    });
    
    // Create consent record
    await prisma.consentRecord.create({
      data: {
        meetingId: meeting.id,
        consentVersion: consentVersion || 'v1.0',
        consentStatus: isGranted ? 'GRANTED' : 'DENIED',
        policyVersion: policyVersion || '2026-PRIVACY-POLICY',
        participantRef: participantRef || 'Unknown',
        actorId: req.user!.id
      }
    });

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
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Consent error:', error);
    res.status(500).json({ error: 'Failed to record consent' });
  }
});

export default router;
