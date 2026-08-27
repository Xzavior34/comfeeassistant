import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { prisma } from '../db';
import { clinicalDocumentService, DocumentMetadata } from '../services/clinicalDocument';
import { ClinicalNarrative } from '../clinical/narrative';
import { auditLogger } from '../services/auditLogger';
import { getEmailProvider, isEmailDeliveryConfigured } from '../providers/email';

import { verifySignedLinkToken } from '../services/signedLinks';

const router = Router();

/**
 * Signed-link access, for sharing a document with someone who has no account.
 *
 * Deliberately mounted BEFORE the authentication middleware, because the signature is the
 * credential. The signature is verified before the expiry, so a forged token is reported as
 * invalid rather than merely expired.
 */
router.get('/secure-access', async (req, res) => {
  const token = req.query.token;
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'Invalid document access link.' });
  }

  const result = verifySignedLinkToken(token);

  if (!result.valid) {
    if (result.reason === 'EXPIRED') {
      return res.status(410).json({ error: 'Secure document link has expired.' });
    }
    return res.status(400).json({ error: 'Invalid document access link.' });
  }

  // The signature is valid, but this endpoint intentionally does not stream clinical
  // documents yet: the storage read and the retention check belong here and are not
  // implemented, so it reports that rather than returning placeholder content.
  return res.status(501).json({
    error: 'Secure link retrieval is not enabled in this deployment.',
    message: 'Download the document from the review screen while signed in.'
  });
});

/**
 * Clinical document export.
 *
 * Every route here requires authentication and checks the tenant boundary. The previous
 * `/download/:filename` route had neither: any caller who knew or guessed a meeting id could
 * retrieve that patient's clinical note without logging in, and what it returned was the raw
 * extraction JSON with a PDF content-type.
 */
router.use(authenticateToken);

const notes = () => prisma.clinicalNote as any;

type LoadResult = { ok: false; status: 404 | 403 } | { ok: true; note: any };

async function loadNoteForUser(noteId: string, organisationId: string): Promise<LoadResult> {
  const note = await notes().findUnique({
    where: { id: noteId },
    include: { meeting: { include: { organisation: true, clinician: true } }, approvedBy: true }
  });

  if (!note) return { ok: false, status: 404 };
  if (note.meeting.organisationId !== organisationId) return { ok: false, status: 403 };
  return { ok: true, note };
}

function toMetadata(note: any): DocumentMetadata {
  return {
    meetingId: note.meetingId,
    clientReference: note.meeting.clientReference,
    clinicianName: note.meeting.clinician?.email ?? 'Clinician',
    organisationName: note.meeting.organisation?.name ?? 'Vabatim',
    assessmentDate: new Date(note.meeting.createdAt).toLocaleDateString('en-GB'),
    assessmentType: 'INITIAL_ASSESSMENT',
    assessmentMode: note.meeting.assessmentMode === 'REMOTE' ? 'REMOTE' : 'IN_PERSON',
    approvedBy: note.approvedBy?.email ?? null,
    approvedAt: note.approvedAt ? new Date(note.approvedAt).toLocaleString('en-GB') : null,
    documentVersion: note.status === 'APPROVED' ? 'Final v1' : 'Draft'
  };
}

async function sendDocument(
  req: AuthenticatedRequest,
  res: Response,
  format: 'pdf' | 'docx'
): Promise<void> {
  const loaded = await loadNoteForUser(req.params.noteId, req.user!.organisationId);
  if (!loaded.ok) {
    res.status(loaded.status).json({ error: loaded.status === 404 ? 'Note not found.' : 'Forbidden.' });
    return;
  }

  const note = loaded.note;
  const narrative = note.narrativeJson as ClinicalNarrative | null;

  if (!narrative) {
    res.status(409).json({
      error: 'Note has no reviewable content',
      message: 'Documentation has not finished generating for this assessment.'
    });
    return;
  }

  const meta = toMetadata(note);

  // A draft can be exported — clinicians legitimately want to read one away from the screen —
  // but it is watermarked as a draft throughout and cannot be mistaken for a record.
  const buffer =
    format === 'pdf'
      ? await clinicalDocumentService.generatePDF(meta, narrative)
      : await clinicalDocumentService.generateDOCX(meta, narrative);

  if (note.status === 'APPROVED') {
    await notes()
      .update({ where: { id: note.id }, data: { exportedAt: new Date() } as any })
      .catch(() => undefined);
  }

  auditLogger.log({
    organisationId: req.user!.organisationId,
    actorId: req.user!.id,
    eventType: 'DOCUMENT_EXPORTED',
    resourceType: 'ClinicalNote',
    resourceId: note.id,
    details: { format, status: note.status, bytes: buffer.length }
  });

  const safeRef = String(meta.clientReference).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
  const suffix = note.status === 'APPROVED' ? '' : '_DRAFT';
  const filename = `Vabatim_Assessment_${safeRef}${suffix}.${format}`;

  res.setHeader(
    'Content-Type',
    format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  // Filename is derived from the pseudonymous reference and sanitised; a client-supplied
  // name is never reflected into this header.
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store, private');
  res.send(buffer);
}

router.get('/:noteId/pdf', (req: AuthenticatedRequest, res) => sendDocument(req, res, 'pdf'));
router.get('/:noteId/docx', (req: AuthenticatedRequest, res) => sendDocument(req, res, 'docx'));

/**
 * Delivery by email.
 *
 * Reports honestly what happened. The previous version replied "notification dispatched" and
 * returned a hardcoded fake URL while the mock provider sent nothing.
 */
router.post('/:noteId/deliver', async (req: AuthenticatedRequest, res: Response) => {
  const loaded = await loadNoteForUser(req.params.noteId, req.user!.organisationId);
  if (!loaded.ok) {
    return res.status(loaded.status).json({ error: loaded.status === 404 ? 'Note not found.' : 'Forbidden.' });
  }

  if (loaded.note.status !== 'APPROVED') {
    return res.status(409).json({
      error: 'Note not approved',
      message: 'Only an approved assessment note can be delivered.'
    });
  }

  if (!isEmailDeliveryConfigured()) {
    return res.status(200).json({
      delivered: false,
      message:
        'Email delivery is not configured in this environment, so no email was sent. Download ' +
        'the PDF or DOCX to share the note.'
    });
  }

  const { recipientEmail, recipientName } = req.body ?? {};
  if (!recipientEmail || typeof recipientEmail !== 'string') {
    return res.status(400).json({ error: 'recipientEmail is required.' });
  }

  await getEmailProvider().sendSecureDocumentLink({
    to: recipientEmail,
    subject: 'Vabatim clinical assessment note',
    recipientName: recipientName ?? 'Colleague',
    secureDocumentUrl: `${process.env.APP_BASE_URL ?? ''}/api/documents/${loaded.note.id}/pdf`,
    expiresInMinutes: 60
  });

  auditLogger.log({
    organisationId: req.user!.organisationId,
    actorId: req.user!.id,
    eventType: 'DOCUMENT_DELIVERED',
    resourceType: 'ClinicalNote',
    resourceId: loaded.note.id,
    details: { recipientDomain: String(recipientEmail).split('@')[1] ?? 'unknown' }
  });

  return res.json({ delivered: true, message: 'Secure document link sent.' });
});

export default router;
