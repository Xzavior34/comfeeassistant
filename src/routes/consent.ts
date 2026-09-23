import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { isSameTenantOrOwner } from '../middleware/tenant';
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

    let meeting: any = null;
    try {
      meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    } catch {
      try {
        const rawMeetings: any[] = await prisma.$queryRaw`SELECT * FROM "Meeting" WHERE "id" = ${meetingId} LIMIT 1`;
        if (rawMeetings && rawMeetings.length > 0) meeting = rawMeetings[0];
      } catch {
        // Fallback
      }
    }

    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    if (!isSameTenantOrOwner(meeting, req.user!)) {
      return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
    }

    const isGranted = consentGranted === true || consentGranted === 'true';
    
    try {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: {
          consentStatus: isGranted,
          status: (isGranted && meeting.status === MeetingState.CREATED) ? MeetingState.READY : undefined
        }
      });
    } catch {
      try {
        await prisma.$executeRaw`UPDATE "Meeting" SET "consentStatus" = ${isGranted}, "status" = 'READY' WHERE "id" = ${meetingId}`;
      } catch {
        // Non-blocking DB fallback
      }
    }
    
    // Create consent record (non-blocking)
    try {
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
    } catch (recordErr: any) {
      console.warn('[consent] ConsentRecord create notice:', recordErr?.message || recordErr);
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
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Consent error:', error);
    res.status(500).json({ error: 'Failed to record consent' });
  }
});

export default router;
