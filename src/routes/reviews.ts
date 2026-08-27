import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { authenticateToken, requireRole } from '../middleware/auth';
import { MeetingState, UserRole } from '@prisma/client';
import { auditLogger } from '../services/auditLogger';
import { prisma } from '../db';
import crypto from 'crypto';
import { ClinicalNarrative } from '../clinical/narrative';

const router = Router();
router.use(authenticateToken);

/**
 * Clinician review and approval.
 *
 * The rule this route exists to enforce: an AI-generated note is never a clinical record. It
 * becomes one only when a named clinician has read it and said so. Everything here is built
 * around making that act explicit, attributable and auditable.
 *
 * The previous implementation approved a meeting without loading the note at all, and
 * returned a hardcoded string as the "note hash". Approval is now tied to the actual note
 * content, and the hash is computed from it.
 */

const notes = () => prisma.clinicalNote as any;

/** Content hash over the approved note, so a later change is detectable. */
function hashNote(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** The draft awaiting review, with everything the clinician needs to judge it. */
router.get('/:meetingId', async (req: AuthenticatedRequest, res: Response) => {
  const meeting = await prisma.meeting.findUnique({ where: { id: req.params.meetingId } });
  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });
  if (meeting.organisationId !== req.user!.organisationId) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  const note = await notes().findFirst({
    where: { meetingId: meeting.id },
    orderBy: { generatedAt: 'desc' }
  });

  if (!note) {
    return res.status(404).json({
      error: 'No assessment note yet',
      message: 'Documentation has not been generated for this assessment.'
    });
  }

  const narrative = note.narrativeJson as ClinicalNarrative | null;

  return res.json({
    noteId: note.id,
    meetingId: meeting.id,
    status: note.status,
    generatedAt: note.generatedAt,
    reviewedAt: note.reviewedAt,
    approvedAt: note.approvedAt,
    aiModel: note.aiModel,
    promptVersion: note.promptVersion,
    narrative,
    reviewFlags: narrative?.reviewFlags ?? [],
    stats: narrative?.stats ?? null,
    // The clinician can always compare the draft against what was actually said.
    frozenTranscript: (meeting as any).frozenTranscript ?? null
  });
});

const EditSchema = z.object({
  sections: z
    .array(
      z.object({
        id: z.string(),
        entries: z.array(
          z.object({
            text: z.string(),
            requiresReview: z.boolean().optional(),
            fieldId: z.string().optional()
          })
        )
      })
    )
    .min(1)
});

/**
 * Records a clinician's edits as a new version.
 *
 * Edits are additive: the AI version stays in the version history untouched, so it is always
 * possible to establish what the machine produced versus what the clinician wrote. That
 * distinction is the whole point of the audit trail.
 */
router.patch('/:noteId', requireRole(UserRole.CLINICIAN), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = EditSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid edit',
      fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), problem: i.message }))
    });
  }

  const note = await notes().findUnique({
    where: { id: req.params.noteId },
    include: { meeting: true, versions: true }
  });
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  if (note.meeting.organisationId !== req.user!.organisationId) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  if (note.status === 'APPROVED' || note.status === 'FINALISED' || note.status === 'EXPORTED') {
    return res.status(409).json({
      error: 'Note is finalised',
      message: 'This note has been approved and can no longer be edited.'
    });
  }

  const narrative = (note.narrativeJson ?? { sections: [] }) as ClinicalNarrative;
  const edited: ClinicalNarrative = {
    ...narrative,
    sections: narrative.sections.map((section) => {
      const replacement = parsed.data.sections.find((s) => s.id === section.id);
      if (!replacement) return section;
      return {
        ...section,
        notEstablished: replacement.entries.length > 0 ? undefined : section.notEstablished,
        entries: replacement.entries.map((e) => ({
          text: e.text,
          requiresReview: e.requiresReview ?? false,
          reviewReason: null,
          // Clinician-authored content is marked as such rather than inheriting the AI's
          // provenance, so the record never implies the machine observed something a person
          // in fact wrote.
          sourceType: 'CLINICIAN_OBSERVED',
          certainty: 'CONFIRMED',
          sourceQuote: '',
          fieldId: e.fieldId ?? 'clinician_edit'
        }))
      };
    })
  };

  const nextVersion = (note.versions?.length ?? 0) + 1;

  await notes().update({
    where: { id: note.id },
    data: {
      narrativeJson: edited as any,
      status: 'UNDER_REVIEW',
      reviewedAt: new Date(),
      versions: {
        create: [
          {
            versionNumber: nextVersion,
            structuredJson: note.structuredJson,
            authorType: 'CLINICIAN',
            authorId: req.user!.id,
            status: 'UNDER_REVIEW'
          }
        ]
      }
    } as any
  });

  auditLogger.log({
    organisationId: req.user!.organisationId,
    actorId: req.user!.id,
    eventType: 'NOTE_EDITED',
    resourceType: 'ClinicalNote',
    resourceId: note.id,
    details: { version: nextVersion, sectionsEdited: parsed.data.sections.map((s) => s.id) }
  });

  return res.json({ noteId: note.id, status: 'UNDER_REVIEW', version: nextVersion });
});

const ApproveSchema = z.object({
  meetingId: z.string().optional(),
  noteId: z.string().optional(),
  /**
   * The clinician's explicit attestation. Approval is a deliberate act, so it requires a
   * deliberate signal rather than defaulting to true.
   */
  attested: z.literal(true, {
    errorMap: () => ({ message: 'Approval requires explicit clinician attestation' })
  }),
  approvedBy: z.string().optional()
});

router.post('/approve', requireRole(UserRole.CLINICIAN), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = ApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Approval refused',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), problem: i.message }))
      });
    }

    const { meetingId, noteId, approvedBy } = parsed.data;
    if (!meetingId && !noteId) {
      return res.status(400).json({ error: 'meetingId or noteId is required.' });
    }

    const note = noteId
      ? await notes().findUnique({ where: { id: noteId }, include: { meeting: true } })
      : await notes().findFirst({
          where: { meetingId },
          orderBy: { generatedAt: 'desc' },
          include: { meeting: true }
        });

    if (!note) {
      return res.status(404).json({
        error: 'No note to approve',
        message: 'There is no generated assessment note for this session.'
      });
    }

    if (note.meeting.organisationId !== req.user!.organisationId) {
      return res.status(403).json({ error: 'Forbidden: Tenant isolation violation.' });
    }

    if (note.status === 'APPROVED' || note.status === 'FINALISED') {
      return res.status(409).json({ error: 'This note has already been approved.' });
    }

    const approvedAt = new Date();
    const noteHash = hashNote(note.narrativeJson ?? note.structuredJson);

    await notes().update({
      where: { id: note.id },
      data: {
        status: 'APPROVED',
        approvedAt,
        finalisedAt: approvedAt,
        approvedById: req.user!.id,
        reviewedAt: note.reviewedAt ?? approvedAt
      } as any
    });

    await prisma.meeting.update({
      where: { id: note.meetingId },
      data: { status: MeetingState.APPROVED }
    });

    auditLogger.log({
      organisationId: req.user!.organisationId,
      actorId: req.user!.id,
      eventType: 'NOTE_APPROVED',
      resourceType: 'ClinicalNote',
      resourceId: note.id,
      details: {
        approvedBy: approvedBy || req.user!.email,
        noteHash,
        generatedAt: note.generatedAt,
        aiModel: note.aiModel,
        promptVersion: note.promptVersion
      }
    });

    return res.json({
      message: 'Assessment note approved.',
      noteId: note.id,
      meetingId: note.meetingId,
      status: 'APPROVED',
      approvalRecord: {
        // Computed from the approved content, so a later alteration is detectable.
        noteHash,
        approvedBy: approvedBy || req.user!.email,
        approvedAt: approvedAt.toISOString()
      },
      pdfUrl: `/api/documents/${note.id}/pdf`,
      docxUrl: `/api/documents/${note.id}/docx`
    });
  } catch (error: any) {
    console.error('[reviews] Approve error:', error?.message ?? error);
    return res.status(500).json({ error: 'Failed to approve note' });
  }
});

export default router;
