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

  // Save the original AI draft if this is the first edit
  if (!meeting.noteVersions) {
    meeting.noteVersions = [{
      versionNumber: 1,
      structuredJson: meeting.validatedNote,
      authorType: 'AI',
      createdAt: new Date().toISOString()
    }];
  }

  // Add the edited version
  meeting.noteVersions.push({
    versionNumber: meeting.noteVersions.length + 1,
    structuredJson: updatedNote,
    authorType: 'CLINICIAN',
    authorId: req.user!.id,
    createdAt: new Date().toISOString()
  });

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

  // If there were no edits, make sure we still record the initial AI version before calculating metrics
  if (!meeting.noteVersions) {
    meeting.noteVersions = [{
      versionNumber: 1,
      structuredJson: meeting.validatedNote,
      authorType: 'AI',
      createdAt: approvalTimestamp
    }];
  }
  
  // Compute metrics from the original AI draft (version 1) and the final approved note
  const { metricsService } = await import('../services/metricsService');
  const originalDraft = meeting.noteVersions[0].structuredJson;
  const metrics = metricsService.calculateEditDistance(originalDraft, meeting.validatedNote);
  meeting.noteMetrics = metrics;

  const noteHash = crypto.createHash('sha256').update(JSON.stringify(meeting.validatedNote)).digest('hex');

  meeting.approvalRecord = {
    approvedBy: req.user!.email,
    approvedAt: approvalTimestamp,
    noteHash,
    documentVersion: 'Approved v1.0',
    metrics
  };

  auditLogger.log({
    organisationId: req.user!.organisationId,
    actorId: req.user!.id,
    eventType: 'NOTE_APPROVED',
    resourceType: 'ClinicalNote',
    resourceId: meetingId,
    details: { noteHash, approvedBy: req.user!.email, metrics }
  });

  res.json({
    message: 'Clinical note successfully approved by clinician.',
    meetingId,
    status: meeting.status,
    approvalRecord: meeting.approvalRecord
  });
});

export default router;
