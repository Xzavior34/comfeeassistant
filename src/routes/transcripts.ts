import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { MeetingState, ParticipantRole } from '@prisma/client';
import { prisma } from '../db';
import { getLLMProvider } from '../providers/llm';
import { resolveParticipantRole } from '../services/canonicalTranscript';
import { PROMPT_VERSION } from '../services/aiExtraction';

const router = Router();
router.use(authenticateToken);

const SegmentSchema = z.object({
  id: z.string().optional(),
  speakerId: z.string().nullable().optional(),
  mappedRole: z.nativeEnum(ParticipantRole).nullable().optional(),
  text: z.string().min(1),
  rawText: z.string().optional(),
  startTimeMs: z.number().int().nonnegative(),
  endTimeMs: z.number().int().nonnegative(),
  // null means the engine reported no confidence. It must stay null, never be defaulted
  // to a high value: downstream safety checks read null as "unknown".
  confidence: z.number().min(0).max(1).nullable().optional(),
  isCorrected: z.boolean().optional(),
  engineTopHypothesis: z.string().optional()
});

const ProcessRequestSchema = z.object({
  meetingId: z.string().min(1),
  segments: z.array(SegmentSchema).min(1, 'At least one transcript segment is required'),
  clinicianName: z.string().optional(),
  clientRef: z.string().optional(),
  templateType: z.enum(['INITIAL_ASSESSMENT', 'REVIEW']).default('INITIAL_ASSESSMENT'),
  sessionFormat: z.enum(['FACE_TO_FACE', 'VIRTUAL']).default('FACE_TO_FACE')
});

router.post('/process', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = ProcessRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      });
    }
    const { meetingId, segments, templateType, sessionFormat } = parsed.data;

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    if (meeting.organisationId !== req.user!.organisationId) {
      return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
    }

    if (!meeting.consentStatus) {
      return res.status(409).json({
        error: 'Consent has not been recorded for this session. Processing refused.'
      });
    }

    const roleMap = {
      'Speaker 1': ParticipantRole.THERAPIST,
      'Speaker 2': ParticipantRole.CLIENT
    };

    // Speaker attribution is resolved, never guessed. The previous version derived the role
    // from whether the label happened to contain the character "1", which mislabelled
    // patient statements as clinician statements (and threw when speakerId was absent).
    const canonicalSegments = segments.map((s, idx) => {
      const wordCount = s.text.trim().split(/\s+/).filter(Boolean).length;
      const durationSeconds = Math.max(0.5, (s.endTimeMs - s.startTimeMs) / 1000);
      const speakingRateWps = parseFloat((wordCount / durationSeconds).toFixed(2));
      const confidence = s.confidence === undefined ? null : s.confidence;

      return {
        id: s.id || `seg-${idx + 1}`,
        meetingId,
        speakerId: s.speakerId ?? 'UNKNOWN',
        mappedRole: s.mappedRole ?? resolveParticipantRole(s.speakerId, roleMap),
        text: s.text,
        startTimeMs: s.startTimeMs,
        endTimeMs: s.endTimeMs,
        confidence,
        rapidSpeechDetected: speakingRateWps > 4.0 || (confidence !== null && confidence < 0.75),
        speakingRateWps
      };
    });

    // Process using LLM
    const llm = getLLMProvider();
    
    // We expect the LLM to return a validated clinical note object
    const validatedNote = await llm.extractStructuredNote(canonicalSegments as any);
    validatedNote.templateType = templateType;
    validatedNote.sessionFormat = sessionFormat;

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
        promptVersion: PROMPT_VERSION,
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
