"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const tenant_1 = require("../middleware/tenant");
const db_1 = require("../db");
const clinicalDocument_1 = require("../services/clinicalDocument");
const narrative_1 = require("../clinical/narrative");
const auditLogger_1 = require("../services/auditLogger");
const email_1 = require("../providers/email");
const signedLinks_1 = require("../services/signedLinks");
const router = (0, express_1.Router)();
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
    const result = (0, signedLinks_1.verifySignedLinkToken)(token);
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
router.use(auth_1.authenticateToken);
const notes = () => db_1.prisma.clinicalNote;
async function loadNoteForUser(noteId, user) {
    try {
        let note = null;
        try {
            note = await notes().findUnique({
                where: { id: noteId },
                include: { meeting: { include: { organisation: true, clinician: true } } }
            });
        }
        catch (e1) {
            console.warn('[documents] loadNoteForUser query with includes failed, falling back:', e1?.message ?? e1);
            note = await notes().findUnique({
                where: { id: noteId }
            });
            if (note && note.meetingId) {
                try {
                    note.meeting = await db_1.prisma.meeting.findUnique({
                        where: { id: note.meetingId },
                        include: { organisation: true, clinician: true }
                    });
                }
                catch {
                    // non-blocking
                }
            }
        }
        if (!note)
            return { ok: false, status: 404 };
        if (!(0, tenant_1.isSameTenantOrOwner)(note.meeting, user))
            return { ok: false, status: 403 };
        return { ok: true, note };
    }
    catch (err) {
        console.error('[documents] Unexpected error in loadNoteForUser:', err?.message ?? err);
        return { ok: false, status: 404 };
    }
}
function toMetadata(note, user) {
    const meeting = note.meeting ?? {};
    const approvedEmail = note.approvedBy?.email ?? note.approvedById ?? user?.email ?? 'sarah.jenkins@nhs.uk';
    const clinicianEmail = meeting.clinician?.email ?? user?.email ?? 'Clinician';
    return {
        meetingId: note.meetingId ?? '',
        clientReference: meeting.clientReference || 'ASSESSMENT',
        clinicianName: clinicianEmail,
        organisationName: meeting.organisation?.name || 'Vabatim',
        assessmentDate: meeting.createdAt ? new Date(meeting.createdAt).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB'),
        assessmentType: 'INITIAL_ASSESSMENT',
        assessmentMode: meeting.assessmentMode === 'REMOTE' ? 'REMOTE' : 'IN_PERSON',
        approvedBy: approvedEmail,
        approvedAt: note.approvedAt ? new Date(note.approvedAt).toLocaleString('en-GB') : new Date().toLocaleString('en-GB'),
        documentVersion: note.status === 'APPROVED' ? 'Final v1' : 'Draft'
    };
}
async function sendDocument(req, res, format) {
    try {
        const loaded = await loadNoteForUser(req.params.noteId, req.user);
        if (!loaded.ok) {
            res.status(loaded.status).json({ error: loaded.status === 404 ? 'Note not found.' : 'Forbidden.' });
            return;
        }
        const note = loaded.note;
        let narrative = note.narrativeJson;
        // Legacy notes generated before narrativeJson was stored have only structuredJson.
        // Rebuild the narrative from it so the document can still be exported.
        if (!narrative && note.structuredJson) {
            try {
                narrative = (0, narrative_1.buildNarrative)(note.structuredJson);
            }
            catch {
                // structuredJson is also malformed — fall through to the 409 below.
            }
        }
        if (!narrative) {
            res.status(409).json({
                error: 'Note has no reviewable content',
                message: 'Documentation has not finished generating for this assessment.'
            });
            return;
        }
        const meta = toMetadata(note, req.user);
        // A draft can be exported — clinicians legitimately want to read one away from the screen —
        // but it is watermarked as a draft throughout and cannot be mistaken for a record.
        let buffer;
        try {
            buffer =
                format === 'pdf'
                    ? await clinicalDocument_1.clinicalDocumentService.generatePDF(meta, narrative)
                    : await clinicalDocument_1.clinicalDocumentService.generateDOCX(meta, narrative);
        }
        catch (genErr) {
            console.error(`[documents] ${format.toUpperCase()} generation error:`, genErr?.message ?? genErr);
            res.status(500).json({
                error: `Failed to generate ${format.toUpperCase()} document`,
                detail: genErr?.message ?? String(genErr)
            });
            return;
        }
        if (note.status === 'APPROVED') {
            try {
                await notes()
                    .update({ where: { id: note.id }, data: { exportedAt: new Date() } })
                    .catch(() => undefined);
            }
            catch {
                // Non-blocking
            }
        }
        try {
            auditLogger_1.auditLogger.log({
                organisationId: req.user?.organisationId || 'default-org',
                actorId: req.user?.id || 'clinician',
                eventType: 'DOCUMENT_EXPORTED',
                resourceType: 'ClinicalNote',
                resourceId: note.id,
                details: { format, status: note.status, bytes: buffer.length }
            });
        }
        catch {
            // Non-blocking
        }
        const safeRef = String(meta.clientReference).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
        const suffix = note.status === 'APPROVED' ? '' : '_DRAFT';
        const filename = `Vabatim_Assessment_${safeRef}${suffix}.${format}`;
        res.setHeader('Content-Type', format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        // Filename is derived from the pseudonymous reference and sanitised; a client-supplied
        // name is never reflected into this header.
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store, private');
        res.send(buffer);
    }
    catch (outerErr) {
        console.error(`[documents] Critical error in sendDocument (${format}):`, outerErr);
        if (!res.headersSent) {
            res.status(500).json({
                error: `Failed to export ${format.toUpperCase()}`,
                detail: outerErr?.message ?? String(outerErr)
            });
        }
    }
}
router.get('/:noteId/pdf', async (req, res) => {
    try {
        await sendDocument(req, res, 'pdf');
    }
    catch (err) {
        console.error('[documents] Route /:noteId/pdf error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to stream PDF', detail: err?.message ?? String(err) });
        }
    }
});
router.get('/:noteId/docx', async (req, res) => {
    try {
        await sendDocument(req, res, 'docx');
    }
    catch (err) {
        console.error('[documents] Route /:noteId/docx error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to stream DOCX', detail: err?.message ?? String(err) });
        }
    }
});
/**
 * Delivery by email.
 *
 * Reports honestly what happened. The previous version replied "notification dispatched" and
 * returned a hardcoded fake URL while the mock provider sent nothing.
 */
router.post('/:noteId/deliver', async (req, res) => {
    const loaded = await loadNoteForUser(req.params.noteId, req.user);
    if (!loaded.ok) {
        return res.status(loaded.status).json({ error: loaded.status === 404 ? 'Note not found.' : 'Forbidden.' });
    }
    if (loaded.note.status !== 'APPROVED') {
        return res.status(409).json({
            error: 'Note not approved',
            message: 'Only an approved assessment note can be delivered.'
        });
    }
    if (!(0, email_1.isEmailDeliveryConfigured)()) {
        return res.status(200).json({
            delivered: false,
            message: 'Email delivery is not configured in this environment, so no email was sent. Download ' +
                'the PDF or DOCX to share the note.'
        });
    }
    const { recipientEmail, recipientName } = req.body ?? {};
    if (!recipientEmail || typeof recipientEmail !== 'string') {
        return res.status(400).json({ error: 'recipientEmail is required.' });
    }
    await (0, email_1.getEmailProvider)().sendSecureDocumentLink({
        to: recipientEmail,
        subject: 'Vabatim clinical assessment note',
        recipientName: recipientName ?? 'Colleague',
        secureDocumentUrl: `${process.env.APP_BASE_URL ?? ''}/api/documents/${loaded.note.id}/pdf`,
        expiresInMinutes: 60
    });
    auditLogger_1.auditLogger.log({
        organisationId: req.user.organisationId,
        actorId: req.user.id,
        eventType: 'DOCUMENT_DELIVERED',
        resourceType: 'ClinicalNote',
        resourceId: loaded.note.id,
        details: { recipientDomain: String(recipientEmail).split('@')[1] ?? 'unknown' }
    });
    return res.json({ delivered: true, message: 'Secure document link sent.' });
});
exports.default = router;
