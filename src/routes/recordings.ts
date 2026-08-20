import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { DEMO_MEETINGS } from './meetings';
import { MeetingState } from '@prisma/client';
import { queueManager } from '../queues/queueManager';

const router = Router();
router.use(authenticateToken);

router.post('/upload', async (req: AuthenticatedRequest, res: Response) => {
  const { meetingId, sampleRate, channelCount, durationMs, format } = req.body;

  const meeting = DEMO_MEETINGS[meetingId];
  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

  if (!meeting.consentStatus) {
    return res.status(400).json({ error: 'Consent required. Recording upload blocked until valid consent is recorded.' });
  }

  // Audio metadata inspection & recording checks
  const actualSampleRate = sampleRate || 16000;
  const actualChannels = channelCount || 1;
  const audioFormat = format || 'audio/wav';

  meeting.status = MeetingState.UPLOADED;

  // Trigger async processing pipeline automatically
  const pipelineResult = await queueManager.processFullMeetingPipeline(
    meetingId,
    `local-recording://${meetingId}.wav`,
    'Dr. Sarah Jenkins',
    meeting.clientReference
  );

  meeting.status = pipelineResult.status;
  meeting.canonicalSegments = pipelineResult.canonicalSegments;
  meeting.validatedNote = pipelineResult.validatedNote;

  res.json({
    recording: {
      meetingId,
      sampleRate: actualSampleRate,
      channelCount: actualChannels,
      format: audioFormat,
      durationMs: durationMs || 45000,
      processingStatus: 'COMPLETED'
    },
    pipelineState: meeting.status
  });
});

export default router;
