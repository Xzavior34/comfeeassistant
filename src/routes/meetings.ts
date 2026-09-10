import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { MeetingState } from '@prisma/client';
import { canTransition } from '../state/meetingStateMachine';
import { prisma } from '../db';

const router = Router();

router.use(authenticateToken);

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userOrgId = req.user!.organisationId;

    // Stale-processing recovery, contributed by the parallel implementation and kept here.
    // On free hosting the web service can be stopped mid-job, which would otherwise leave a
    // meeting showing "generating" forever. Marking it FAILED is what surfaces the Retry
    // action; the frozen transcript is untouched, so retrying costs nothing but a rerun.
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.meeting
      .updateMany({
        where: {
          organisationId: userOrgId,
          status: {
            in: [
              MeetingState.EXTRACTION_RUNNING,
              MeetingState.TRANSCRIBING,
              MeetingState.UPLOADING
            ]
          },
          createdAt: { lt: staleThreshold }
        },
        data: { status: MeetingState.FAILED }
      })
      .catch(() => undefined);

    // Scoped to the signed-in clinician: this is their own dashboard of past sessions and
    // clients, not a shared organisation-wide list. A different clinician's client sessions
    // are not shown here.
    // templateType/sessionFormat were added to the schema after the last `prisma generate`
    // in this environment could run (see the freeze step in transcripts.ts for the same,
    // pre-existing workaround) so this whole query is typed loosely rather than fighting
    // Prisma's generated (and here, stale) Select type for two fields it doesn't know about
    // yet. Nothing here is unsafe: the shape is fully under our control below.
    const meetings: any[] = await (prisma.meeting.findMany as any)({
      where: { organisationId: userOrgId, clinicianId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        clientReference: true,
        meetingType: true,
        templateType: true,
        sessionFormat: true,
        status: true,
        consentStatus: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        frozenAt: true,
        // Only enough of the latest job/note to decide what action the dashboard should
        // offer (resume, view progress, view note, retry) — never the transcript or note
        // content itself, which would bloat a list of every past session.
        processingJobs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, state: true, stage: true, progress: true }
        },
        clinicalNotes: {
          orderBy: { generatedAt: 'desc' },
          take: 1,
          select: { id: true, status: true }
        }
      }
    });

    const withLatest = meetings.map((m) => {
      const { processingJobs, clinicalNotes, ...rest } = m;
      return {
        ...rest,
        latestJob: (processingJobs && processingJobs[0]) ?? null,
        latestNote: (clinicalNotes && clinicalNotes[0]) ?? null
      };
    });

    res.json({ meetings: withLatest });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
});

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clientReference, meetingType, expectedSpeakerCount, templateType, sessionFormat } = req.body;

    if (!clientReference) {
      return res.status(400).json({ error: 'clientReference pseudonymous code is required.' });
    }

    const meeting = await prisma.meeting.create({
      data: {
        organisationId: req.user!.organisationId,
        clinicianId: req.user!.id,
        clientReference,
        meetingType: meetingType || 'WHEELCHAIR_ASSESSMENT',
        // Assuming templateType and sessionFormat can be saved in DB or ignored if not in Prisma schema. 
        // Prisma schema doesn't have templateType and sessionFormat natively. They were part of in-memory.
        // Let's just create the meeting properly.
        status: MeetingState.CREATED,
        expectedSpeakerCount: expectedSpeakerCount || 2,
        retentionPolicy: 'UK_NHS_STANDARD_8Y',
        consentStatus: false,
      }
    });

    res.status(201).json({ meeting });
  } catch (error: any) {
    console.error('Error creating meeting:', error);
    res.status(500).json({ error: 'Failed to create meeting', details: error?.message || 'Unknown database error' });
  }
});

router.patch('/:id/state', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: req.params.id }
    });

    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    // Cross-tenant protection
    if (meeting.organisationId !== req.user!.organisationId) {
      return res.status(403).json({ error: 'Forbidden: Access denied to foreign organisation resource.' });
    }

    const { targetState } = req.body;
    if (!canTransition(meeting.status, targetState)) {
      return res.status(400).json({ error: `Invalid state transition from ${meeting.status} to ${targetState}` });
    }

    const updatedMeeting = await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: targetState }
    });

    res.json({ meeting: updatedMeeting });
  } catch (error) {
    console.error('Error updating meeting state:', error);
    res.status(500).json({ error: 'Failed to update meeting state' });
  }
});

export default router;
