import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { MeetingState } from '@prisma/client';
import { prisma } from '../db';

const router = Router();
router.use(authenticateToken);

router.post('/upload', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { meetingId } = req.body;

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    if (!meeting.consentStatus) {
      return res.status(400).json({ error: 'Consent required. Recording upload blocked until valid consent is recorded.' });
    }

    res.json({
      recording: {
        meetingId,
        processingStatus: 'COMPLETED'
      },
      pipelineState: MeetingState.UPLOADED
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload' });
  }
});

export default router;
