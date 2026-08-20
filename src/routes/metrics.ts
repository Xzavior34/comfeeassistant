import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken, requireRole } from '../middleware/auth';
import { DEMO_MEETINGS } from './meetings';
import { UserRole, MeetingState } from '@prisma/client';

const router = Router();
router.use(authenticateToken);

// Documentation Quality Metrics endpoint (Admin/Clinician)
router.get('/documentation-quality', (req: AuthenticatedRequest, res: Response) => {
  const orgId = req.user!.organisationId;
  
  // Aggregate metrics from all approved notes for the organisation
  const orgMeetings = Object.values(DEMO_MEETINGS).filter(m => m.organisationId === orgId);
  
  const metrics = {
    totalNotesGenerated: orgMeetings.filter(m => m.status === MeetingState.APPROVED || m.status === MeetingState.UNDER_REVIEW || m.status === MeetingState.PENDING_REVIEW).length,
    totalNotesReviewed: orgMeetings.filter(m => m.status === MeetingState.APPROVED || m.status === MeetingState.UNDER_REVIEW).length,
    totalNotesApproved: orgMeetings.filter(m => m.status === MeetingState.APPROVED).length,
    notesApprovedWithoutEdits: 0,
    notesRequiringMinorEdits: 0,
    notesRequiringSubstantialEdits: 0,
    averageReviewDurationMs: 0,
    totalSpeechCorrectionsProposed: 0,
    totalSpeechCorrectionsAccepted: 0,
    totalGroundingViolations: 0,
    correctionRate: 0, // percentage of notes requiring some edit
  };

  let totalReviewTimeMs = 0;
  let notesWithReviewTime = 0;
  let totalEditedNotes = 0;

  for (const m of orgMeetings) {
    if (m.status === MeetingState.APPROVED && m.noteMetrics) {
      const cls = m.noteMetrics.editClassification;
      if (cls === 'UNCHANGED') metrics.notesApprovedWithoutEdits++;
      else if (cls === 'MINOR_EDIT' || cls === 'ADDITION' || cls === 'REMOVAL') metrics.notesRequiringMinorEdits++;
      else if (cls === 'SUBSTANTIAL_EDIT') metrics.notesRequiringSubstantialEdits++;

      if (cls !== 'UNCHANGED') totalEditedNotes++;

      metrics.totalSpeechCorrectionsProposed += m.noteMetrics.speechCorrectionsProposed || 0;
      metrics.totalSpeechCorrectionsAccepted += m.noteMetrics.speechCorrectionsAccepted || 0;
      metrics.totalGroundingViolations += m.noteMetrics.groundingViolations || 0;

      // Calculate review duration based on first version to approval time
      if (m.noteVersions && m.noteVersions.length > 0 && m.approvalRecord?.approvedAt) {
        const firstVersionTime = new Date(m.noteVersions[0].createdAt).getTime();
        const approvedTime = new Date(m.approvalRecord.approvedAt).getTime();
        totalReviewTimeMs += (approvedTime - firstVersionTime);
        notesWithReviewTime++;
      }
    }
  }

  if (metrics.totalNotesApproved > 0) {
    metrics.correctionRate = Math.round((totalEditedNotes / metrics.totalNotesApproved) * 100);
  }
  if (notesWithReviewTime > 0) {
    metrics.averageReviewDurationMs = Math.round(totalReviewTimeMs / notesWithReviewTime);
  }

  res.json({
    metrics,
    message: 'Aggregate documentation quality metrics. Patient identifiers are strictly isolated and not included.'
  });
});

export default router;
