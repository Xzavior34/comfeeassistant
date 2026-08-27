import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { MeetingState } from '@prisma/client';
import { prisma } from '../db';
import { getStorageProvider } from '../providers/storage';
import { auditLogger } from '../services/auditLogger';

const router = Router();
router.use(authenticateToken);

/**
 * Consultation audio upload.
 *
 * This endpoint previously accepted no audio, stored nothing, and replied
 * `processingStatus: 'COMPLETED'`. The clinician saw a successful upload for a recording
 * that had never left the browser, which is why speaker-differentiated transcription could
 * never have worked regardless of the provider behind it.
 */

const UploadSchema = z.object({
  meetingId: z.string().min(1),
  /** Base64-encoded audio. */
  audioBase64: z.string().min(1),
  mimeType: z.string().default('audio/webm'),
  durationMs: z.number().int().nonnegative().optional(),
  /** Terms known to occur in this session: equipment models, the person's own vocabulary. */
  sessionPhrases: z.array(z.string()).max(200).optional(),
  expectedSpeakerCount: z.number().int().min(1).max(6).optional()
});

// Roughly 25 minutes of 32 kbps Opus. Beyond this the request body itself becomes the
// bottleneck and the upload should be chunked or go direct to object storage.
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

const EXTENSION: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav'
};

router.post('/upload', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Authorisation and consent are checked before the payload, so a recording is never
    // examined — not even to validate its shape — for a session that has no consent.
    const meetingId = typeof req.body?.meetingId === 'string' ? req.body.meetingId : '';
    if (!meetingId) {
      return res.status(400).json({ error: 'meetingId is required.' });
    }

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    if (meeting.organisationId !== req.user!.organisationId) {
      return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
    }

    if (!meeting.consentStatus) {
      return res.status(400).json({
        error: 'Consent required. Recording upload blocked until valid consent is recorded.'
      });
    }

    const parsed = UploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid upload',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      });
    }

    const { audioBase64, mimeType, durationMs, sessionPhrases, expectedSpeakerCount } = parsed.data;

    const audio = Buffer.from(audioBase64, 'base64');
    if (audio.length === 0) {
      return res.status(400).json({ error: 'Audio payload decoded to zero bytes.' });
    }
    if (audio.length > MAX_AUDIO_BYTES) {
      return res.status(413).json({
        error: `Recording is ${(audio.length / 1024 / 1024).toFixed(1)} MB, above the ${
          MAX_AUDIO_BYTES / 1024 / 1024
        } MB limit for a single upload.`
      });
    }

    const base = mimeType.split(';')[0];
    const key = `recordings/${meetingId}.${EXTENSION[base] ?? 'webm'}`;

    const storage = getStorageProvider();
    await storage.upload(key, audio, base);

    auditLogger.log({
      organisationId: req.user!.organisationId,
      actorId: req.user!.id,
      eventType: 'RECORDING_UPLOADED',
      resourceType: 'Meeting',
      resourceId: meetingId,
      details: { bytes: audio.length, mimeType: base, durationMs: durationMs ?? null }
    });

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: MeetingState.UPLOADED }
    });

    // Queue diarised transcription and note generation. Processing is asynchronous because
    // cloud recognition of a full consultation takes minutes, not seconds.
    //
    // Imported here rather than at module scope: the queue opens a Redis connection on
    // construction, and importing it eagerly would make simply loading the API depend on
    // Redis being reachable.
    let processingStatus: 'QUEUED' | 'PENDING' = 'PENDING';
    let queueMessage =
      'Recording stored. Background processing is not currently available; it will be ' +
      'transcribed when the processing service is restored.';

    try {
      const { queueManager } = await import('../queues/queueManager');

      if (queueManager.isQueueAvailable()) {
        await queueManager.enqueueMeetingJob(
          meetingId,
          key,
          req.user!.email ?? 'Clinician',
          meeting.clientReference,
          'INITIAL_ASSESSMENT',
          'FACE_TO_FACE',
          { sessionPhrases, expectedSpeakerCount }
        );
        processingStatus = 'QUEUED';
        queueMessage =
          'Recording stored and queued for speaker-differentiated transcription. The draft ' +
          'note will be available for review when processing completes.';
      }
      // Deliberately not run inline when the queue is down: cloud recognition of a full
      // consultation takes minutes, and holding an HTTP request open for that would time
      // out and lose the job. The recording is safely stored either way.
    } catch (queueError: any) {
      // A queueing failure must not lose a stored recording, so it is reported rather than
      // thrown.
      console.error('[recordings] Failed to enqueue processing job:', queueError);
    }

    res.json({
      recording: {
        meetingId,
        storageKey: key,
        bytes: audio.length,
        durationMs: durationMs ?? null,
        processingStatus
      },
      pipelineState: MeetingState.UPLOADED,
      message: queueMessage
    });
  } catch (error: any) {
    console.error('Recording upload error:', error);
    res.status(500).json({ error: error?.message ?? 'Failed to upload recording' });
  }
});

export default router;
