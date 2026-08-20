import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { MeetingState } from '@prisma/client';
import { prisma } from '../db';
import { getLLMProvider } from '../providers/llm';

const router = Router();
router.use(authenticateToken);

router.post('/process', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { meetingId, segments, clinicianName, clientRef, templateType, sessionFormat } = req.body;

    if (!meetingId || !segments) {
      return res.status(400).json({ error: 'meetingId and segments are required' });
    }

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    if (meeting.organisationId !== req.user!.organisationId) {
      return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
    }

    // Ensure all segments have an ID so the LLM can reference them in evidence
    const canonicalSegments = segments.map((s: any, idx: number) => ({
      id: s.id || `seg-${Date.now()}-${idx}`,
      meetingId,
      speakerId: s.speakerId,
      mappedRole: s.mappedRole || (s.speakerId.includes('1') ? 'THERAPIST' : 'CLIENT'),
      text: s.text,
      startTimeMs: s.startTimeMs,
      endTimeMs: s.endTimeMs,
      confidence: s.confidence
    }));

    // Process using LLM
    const llm = getLLMProvider();
    
    // We expect the LLM to return a validated clinical note object
    const validatedNote = await llm.extractStructuredNote(canonicalSegments);

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: MeetingState.UNDER_REVIEW }
    });

    // Create the initial note version
    await prisma.clinicalNote.create({
      data: {
        meetingId,
        structuredJson: validatedNote as any,
        status: 'DRAFT',
        aiModel: llm.name,
        promptVersion: '1.0',
        versions: {
          create: [{
            versionNumber: 1,
            structuredJson: validatedNote as any,
            authorType: 'AI',
            status: 'DRAFT'
          }]
        }
      }
    });

    res.json({
      message: 'Processing complete',
      note: validatedNote
    });
  } catch (error: any) {
    console.error('Transcript processing error:', error);
    res.status(500).json({ error: error.message || 'Failed to process transcript' });
  }
});

router.get('/:meetingId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { meetingId } = req.params;
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { transcriptSegments: true }
    });

    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    if (meeting.organisationId !== req.user!.organisationId) {
      return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
    }

    res.json({
      meetingId,
      segments: meeting.transcriptSegments || []
    });
  } catch (error) {
    console.error('Error fetching transcript segments:', error);
    res.status(500).json({ error: 'Failed to fetch transcript segments' });
  }
});

export default router;
