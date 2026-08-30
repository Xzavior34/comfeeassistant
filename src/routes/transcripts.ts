import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { prisma } from '../db';
import { documentationService } from '../services/documentationService';
import { processingJobStore } from '../services/processingJobStore';
import { logRequestDiagnostics } from '../middleware/requestDiagnostics';

const router = Router();
router.use(authenticateToken);

/**
 * Transcript submission and documentation generation.
 *
 * Contract notes, written because the previous version of this route caused a production
 * outage reading "Invalid request body":
 *
 * 1. Timestamps are UI metadata, not clinical content. They are coerced — negatives clamped,
 *    floats rounded — rather than rejected. Refusing an entire consultation because a
 *    browser's clock arithmetic produced -1200ms is the wrong trade every time.
 * 2. The free path submits plain TEXT. A structured segment array is still accepted for
 *    diarised sources, but nothing requires it.
 * 3. An empty transcript is a distinct, explained condition, not a schema violation.
 * 4. Validation failures name the offending fields so the cause is visible from the client
 *    and the logs, without either carrying transcript content.
 */

/** Coerces a timestamp instead of rejecting the payload over it. */
const TimestampMs = z.preprocess(
  (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : undefined),
  z.number().int().nonnegative().optional()
);

const SegmentSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  startTimeMs: TimestampMs,
  endTimeMs: TimestampMs,
  confidence: z
    .preprocess((v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(1, v) : null), z.number().nullable())
    .optional()
    // Speaker attribution is intentionally absent. Nothing in the free pipeline knows who
    // spoke, and a field invites something to start guessing again.
});

const ProcessRequestSchema = z
  .object({
    meetingId: z.string().min(1, 'A meeting id is required'),
    /** Free-mode path: the frozen transcript as plain text. */
    transcriptText: z.string().optional(),
    /** Structured path, kept for diarised or imported sources. */
    segments: z.array(SegmentSchema).optional(),
    clinicianName: z.string().optional(),
    clientRef: z.string().optional(),
    templateType: z.enum(['INITIAL_ASSESSMENT', 'REVIEW']).default('INITIAL_ASSESSMENT'),
    sessionFormat: z.enum(['FACE_TO_FACE', 'VIRTUAL']).default('FACE_TO_FACE')
  })
  .refine((v) => v.transcriptText !== undefined || v.segments !== undefined, {
    message: 'Provide either transcriptText or segments',
    path: ['transcriptText']
  });

/** Joins whichever transcript representation the client sent into one text body. */
export function resolveTranscriptText(input: {
  transcriptText?: string;
  segments?: { text: string }[];
}): string {
  if (typeof input.transcriptText === 'string' && input.transcriptText.trim()) {
    return input.transcriptText.trim();
  }
  if (Array.isArray(input.segments)) {
    return input.segments
      .map((s) => (s?.text ?? '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

/** Below this there is not enough said to document an assessment from. */
const MIN_TRANSCRIPT_CHARS = 40;

router.post('/process', async (req: AuthenticatedRequest, res: Response) => {
  const diag = logRequestDiagnostics(req, 'POST /api/transcripts/process');

  try {
    const parsed = ProcessRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        problem: i.message
      }));
      diag.finish(400, { invalidFields: fields.map((f) => f.field) });

      return res.status(400).json({
        error: 'Invalid request body',
        message:
          'The transcript submission did not match the expected format. The consultation has ' +
          'not been lost — the details below say which field was wrong.',
        fields
      });
    }

    const { meetingId, templateType, sessionFormat, clinicianName, clientRef } = parsed.data;

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) {
      diag.finish(404);
      return res.status(404).json({ error: 'Meeting not found.' });
    }

    if (meeting.organisationId !== req.user!.organisationId) {
      diag.finish(403);
      return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
    }

    if (!meeting.consentStatus) {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { consentStatus: true }
      });
    }

    const transcript = resolveTranscriptText(parsed.data);

    // An empty or near-empty transcript is a real, explainable situation — the browser may
    // not support recognition, or the microphone may have been muted. It gets its own status
    // and a clinician-readable explanation rather than being reported as a malformed request.
    if (transcript.length < MIN_TRANSCRIPT_CHARS) {
      diag.finish(422, { transcriptChars: transcript.length });
      return res.status(422).json({
        error: 'Transcript too short to document',
        message:
          transcript.length === 0
            ? 'No transcript was captured for this assessment. Live transcription may not be ' +
              'available in this browser, or the microphone may not have picked up speech. ' +
              'Nothing has been submitted; you can paste or type the transcript to continue.'
            : `Only ${transcript.length} characters of transcript were captured, which is not ` +
              'enough to produce an assessment record.',
        transcriptChars: transcript.length
      });
    }

    // Freeze the transcript onto the meeting BEFORE generation starts. From this point a
    // failure anywhere downstream costs a retry, never the consultation.
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        frozenTranscript: transcript,
        frozenAt: new Date(),
        status: 'TRANSCRIPT_READY'
      } as any
    });

    const { jobId } = await documentationService.start({
      meetingId,
      organisationId: req.user!.organisationId,
      transcript,
      clinicianName: clinicianName || req.user!.email || 'Clinician',
      clientReference: clientRef || meeting.clientReference,
      templateType,
      sessionFormat,
      actorId: req.user!.id
    });

    diag.finish(202, { jobId, transcriptChars: transcript.length });

    return res.status(202).json({
      jobId,
      status: 'PENDING',
      message: 'Transcript saved. Generating the assessment note.',
      pollUrl: `/api/transcripts/job/${jobId}`
    });
  } catch (error: any) {
    diag.finish(500);
    console.error('[transcripts] Processing error:', error?.message ?? error);
    return res.status(500).json({
      error: 'Processing failed to start',
      message:
        'The transcript was saved but documentation could not be started. You can retry ' +
        'without re-recording the consultation.'
    });
  }
});

/** Job state. Polled by the client; deliberately cheap. */
router.get('/job/:jobId', async (req: AuthenticatedRequest, res: Response) => {
  const job = await processingJobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  if (job.organisationId !== req.user!.organisationId) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  return res.json({
    jobId: job.id,
    meetingId: job.meetingId,
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    clinicalNoteId: job.clinicalNoteId,
    error: job.state === 'FAILED' ? job.lastError : null,
    canRetry: job.state === 'FAILED'
  });
});

/**
 * Retry generation from the already-frozen transcript.
 *
 * The clinician never repeats a consultation because the model was rate limited.
 */
async function retryHandler(req: AuthenticatedRequest, res: Response) {
  const meeting = await prisma.meeting.findUnique({ where: { id: req.params.meetingId } });
  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

  if (meeting.organisationId !== req.user!.organisationId) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  const transcript = (meeting as any).frozenTranscript as string | null;
  if (!transcript) {
    return res.status(409).json({
      error: 'No frozen transcript',
      message: 'There is no saved transcript for this assessment to regenerate from.'
    });
  }

  const { jobId } = await documentationService.start({
    meetingId: meeting.id,
    organisationId: meeting.organisationId,
    transcript,
    clinicianName: req.user!.email ?? 'Clinician',
    clientReference: meeting.clientReference,
    templateType: 'INITIAL_ASSESSMENT',
    sessionFormat: 'FACE_TO_FACE',
    actorId: req.user!.id
  });

  return res.status(202).json({ jobId, status: 'PENDING', pollUrl: `/api/transcripts/job/${jobId}` });
}

router.post('/retry/:meetingId', retryHandler);

/**
 * Alias for the retry route.
 *
 * The parallel implementation on this repository used `/:meetingId/retry`. Both spellings
 * are supported so a frontend built against either one keeps working; the handler is the
 * same asynchronous, job-backed regeneration in both cases, never a held-open request.
 */
router.post('/:meetingId/retry', retryHandler);

router.get('/:meetingId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: req.params.meetingId },
      include: { transcriptSegments: true }
    });

    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });
    if (meeting.organisationId !== req.user!.organisationId) {
      return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
    }

    return res.json({
      meetingId: meeting.id,
      frozenTranscript: (meeting as any).frozenTranscript ?? null,
      frozenAt: (meeting as any).frozenAt ?? null,
      segments: meeting.transcriptSegments ?? []
    });
  } catch (error) {
    console.error('[transcripts] Fetch error');
    return res.status(500).json({ error: 'Failed to fetch transcript' });
  }
});

export default router;
