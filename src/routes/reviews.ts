import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken, requireRole } from '../middleware/auth';
import { DEMO_MEETINGS } from './meetings';
import { MeetingState, UserRole } from '@prisma/client';
import { auditLogger } from '../services/auditLogger';
import { DocumentGeneratorService } from '../services/documentGenerator';
import crypto from 'crypto';

const router = Router();
router.use(authenticateToken);

const docGen = new DocumentGeneratorService();

// Clinician view draft note & canonical transcript
router.get('/:meetingId', (req: AuthenticatedRequest, res: Response) => {
  const { meetingId } = req.params;
  const meeting = DEMO_MEETINGS[meetingId];

  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

  if (meeting.organisationId !== req.user!.organisationId) {
    return res.status(403).json({ error: 'Forbidden: Foreign organisation access denied.' });
  }

  res.json({
    meetingId,
    status: meeting.status,
    canonicalSegments: meeting.canonicalSegments || [],
    validatedNote: meeting.validatedNote || null
  });
});

// Clinician edit draft note before approval
router.put('/:meetingId', requireRole(UserRole.CLINICIAN), (req: AuthenticatedRequest, res: Response) => {
  const { meetingId } = req.params;
  const { updatedNote } = req.body;
  const meeting = DEMO_MEETINGS[meetingId];

  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

  meeting.validatedNote = updatedNote;
  meeting.status = MeetingState.UNDER_REVIEW;

  auditLogger.log({
    organisationId: req.user!.organisationId,
    actorId: req.user!.id,
    eventType: 'NOTE_EDITED',
    resourceType: 'ClinicalNote',
    resourceId: meetingId
  });

  res.json({ meetingId, status: meeting.status, note: meeting.validatedNote });
});

// Clinician Approval & Cryptographic Hash Signing
router.post('/:meetingId/approve', requireRole(UserRole.CLINICIAN), async (req: AuthenticatedRequest, res: Response) => {
  const { meetingId } = req.params;
  const meeting = DEMO_MEETINGS[meetingId];

  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

  if (meeting.organisationId !== req.user!.organisationId) {
    return res.status(403).json({ error: 'Forbidden: Tenant isolation violation.' });
  }

  meeting.status = MeetingState.APPROVED;
  const approvalTimestamp = new Date().toISOString();

  const noteHash = crypto.createHash('sha256').update(JSON.stringify(meeting.validatedNote)).digest('hex');

  meeting.approvalRecord = {
    approvedBy: req.user!.email,
    approvedAt: approvalTimestamp,
    noteHash,
    documentVersion: 'Approved v1.0'
  };

  auditLogger.log({
    organisationId: req.user!.organisationId,
    actorId: req.user!.id,
    eventType: 'NOTE_APPROVED',
    resourceType: 'ClinicalNote',
    resourceId: meetingId,
    details: { noteHash, approvedBy: req.user!.email }
  });

  res.json({
    message: 'Clinical note successfully approved by clinician.',
    meetingId,
    status: meeting.status,
    approvalRecord: meeting.approvalRecord
  });
});

export default router;
