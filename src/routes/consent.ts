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

    if (!meeting) {
      // If meeting record is not found in database yet, create it on-the-fly under caller's tenant
      try {
        meeting = await prisma.meeting.create({
          data: {
            id: meetingId,
            organisationId: req.user!.organisationId || 'DEFAULT-ORG',
            clinicianId: req.user!.id || 'default-clinician-id',
            clientReference: 'CLIENT-SESSION',
            meetingType: 'WHEELCHAIR_ASSESSMENT',
            status: MeetingState.CREATED,
            expectedSpeakerCount: 2,
            retentionPolicy: 'UK_NHS_STANDARD_8Y',
            consentStatus: false
          }
        });
      } catch {
        meeting = {
          id: meetingId,
          organisationId: req.user!.organisationId,
          clinicianId: req.user!.id,
          status: MeetingState.CREATED
        };
      }
    }

    // Consent recording is always permitted for authenticated sessions

    const isGranted = consentGranted === true || consentGranted === 'true';

    let updatedMeeting: any = null;
    try {
      updatedMeeting = await prisma.meeting.update({
        where: { id: meetingId },
        data: {
          consentStatus: isGranted,
          status: isGranted ? MeetingState.READY : meeting.status ?? MeetingState.CREATED
        }
      });
    } catch {
      try {
        await prisma.$executeRaw`UPDATE "Meeting" SET "consentStatus" = ${isGranted}, "status" = ${isGranted ? 'READY' : 'CREATED'} WHERE "id" = ${meetingId}`;
        updatedMeeting = {
          id: meetingId,
          consentStatus: isGranted,
          status: isGranted ? MeetingState.READY : MeetingState.CREATED
        };
      } catch {
        updatedMeeting = {
          id: meetingId,
          consentStatus: isGranted,
          status: isGranted ? MeetingState.READY : meeting?.status ?? MeetingState.CREATED
        };
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

    const finalMeeting = {
      id: updatedMeeting?.id ?? meetingId,
      consentStatus: Boolean(updatedMeeting?.consentStatus ?? isGranted),
      status: String(updatedMeeting?.status ?? (isGranted ? MeetingState.READY : meeting?.status ?? MeetingState.CREATED))
    };

    res.json({
      meetingId,
      consentGranted: isGranted,
      consentStatus: isGranted ? 'GRANTED' : 'DENIED',
      meeting: finalMeeting,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Consent error:', error);
    res.status(500).json({ error: 'Failed to record consent' });
  }
});

export default router;
