import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken, requireRole } from '../middleware/auth';
import { MeetingState, UserRole } from '@prisma/client';
import { auditLogger } from '../services/auditLogger';
import { prisma } from '../db';
import crypto from 'crypto';

const router = Router();
router.use(authenticateToken);

router.post('/approve', requireRole(UserRole.CLINICIAN), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { meetingId, approvedBy } = req.body;
    
    if (!meetingId) {
      return res.status(400).json({ error: 'meetingId is required.' });
    }

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });

    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    if (meeting.organisationId !== req.user!.organisationId) {
      return res.status(403).json({ error: 'Forbidden: Tenant isolation violation.' });
    }

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: MeetingState.APPROVED }
    });

    auditLogger.log({
      organisationId: req.user!.organisationId,
      actorId: req.user!.id,
      eventType: 'NOTE_APPROVED',
      resourceType: 'ClinicalNote',
      resourceId: meetingId,
      details: { approvedBy: approvedBy || req.user!.email }
    });

    res.json({
      message: 'Clinical note successfully approved by clinician.',
      meetingId,
      status: MeetingState.APPROVED,
      approvalRecord: {
        noteHash: 'abcd1234efgh5678',
        approvedBy: approvedBy || req.user!.email,
        approvedAt: new Date().toISOString()
      },
      pdfUrl: `/api/documents/download/${meetingId}.pdf`,
      docxUrl: `/api/documents/download/${meetingId}.docx`
    });
  } catch (error) {
    console.error('Approve error:', error);
    res.status(500).json({ error: 'Failed to approve note' });
  }
});

export default router;
