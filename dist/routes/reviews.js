"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const client_1 = require("@prisma/client");
const auditLogger_1 = require("../services/auditLogger");
const db_1 = require("../db");
const crypto_1 = __importDefault(require("crypto"));
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
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
const notes = () => db_1.prisma.clinicalNote;
/** Content hash over the approved note, so a later change is detectable. */
function hashNote(payload) {
    return crypto_1.default.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
/** The draft awaiting review, with everything the clinician needs to judge it. */
router.get('/:meetingId', async (req, res) => {
    const meeting = await db_1.prisma.meeting.findUnique({ where: { id: req.params.meetingId } });
    if (!meeting)
        return res.status(404).json({ error: 'Meeting not found.' });
    if (meeting.organisationId !== req.user.organisationId) {
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
    const narrative = note.narrativeJson;
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
        frozenTranscript: meeting.frozenTranscript ?? null
    });
});
const EditSchema = zod_1.z.object({
    sections: zod_1.z
        .array(zod_1.z.object({
        id: zod_1.z.string(),
        entries: zod_1.z.array(zod_1.z.object({
            text: zod_1.z.string(),
            requiresReview: zod_1.z.boolean().optional(),
            fieldId: zod_1.z.string().optional()
        }))
    }))
        .min(1)
});
/**
 * Records a clinician's edits as a new version.
 *
 * Edits are additive: the AI version stays in the version history untouched, so it is always
 * possible to establish what the machine produced versus what the clinician wrote. That
 * distinction is the whole point of the audit trail.
 */
router.patch('/:noteId', (0, auth_1.requireRole)(client_1.UserRole.CLINICIAN), async (req, res) => {
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
    if (!note)
        return res.status(404).json({ error: 'Note not found.' });
    if (note.meeting.organisationId !== req.user.organisationId) {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    if (note.status === 'APPROVED' || note.status === 'FINALISED' || note.status === 'EXPORTED') {
        return res.status(409).json({
            error: 'Note is finalised',
            message: 'This note has been approved and can no longer be edited.'
        });
    }
    const narrative = (note.narrativeJson ?? { sections: [] });
    const edited = {
        ...narrative,
        sections: narrative.sections.map((section) => {
            const replacement = parsed.data.sections.find((s) => s.id === section.id);
            if (!replacement)
                return section;
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
            narrativeJson: edited,
            status: 'UNDER_REVIEW',
            reviewedAt: new Date(),
            versions: {
                create: [
                    {
                        versionNumber: nextVersion,
                        structuredJson: note.structuredJson,
                        authorType: 'CLINICIAN',
                        authorId: req.user.id,
                        status: 'UNDER_REVIEW'
                    }
                ]
            }
        }
    });
    auditLogger_1.auditLogger.log({
        organisationId: req.user.organisationId,
        actorId: req.user.id,
        eventType: 'NOTE_EDITED',
        resourceType: 'ClinicalNote',
        resourceId: note.id,
        details: { version: nextVersion, sectionsEdited: parsed.data.sections.map((s) => s.id) }
    });
    return res.json({ noteId: note.id, status: 'UNDER_REVIEW', version: nextVersion });
});
const ApproveSchema = zod_1.z.object({
    meetingId: zod_1.z.string().optional(),
    noteId: zod_1.z.string().optional(),
    /**
     * The clinician's explicit attestation. Approval is a deliberate act, so it requires a
     * deliberate signal rather than defaulting to true.
     */
    attested: zod_1.z.literal(true, {
        errorMap: () => ({ message: 'Approval requires explicit clinician attestation' })
    }),
    approvedBy: zod_1.z.string().optional()
});
router.post('/approve', (0, auth_1.requireRole)(client_1.UserRole.CLINICIAN), async (req, res) => {
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
        if (note.meeting.organisationId !== req.user.organisationId) {
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
                approvedById: req.user.id,
                reviewedAt: note.reviewedAt ?? approvedAt
            }
        });
        await db_1.prisma.meeting.update({
            where: { id: note.meetingId },
            data: { status: client_1.MeetingState.APPROVED }
        });
        auditLogger_1.auditLogger.log({
            organisationId: req.user.organisationId,
            actorId: req.user.id,
            eventType: 'NOTE_APPROVED',
            resourceType: 'ClinicalNote',
            resourceId: note.id,
            details: {
                approvedBy: approvedBy || req.user.email,
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
                approvedBy: approvedBy || req.user.email,
                approvedAt: approvedAt.toISOString()
            },
            pdfUrl: `/api/documents/${note.id}/pdf`,
            docxUrl: `/api/documents/${note.id}/docx`
        });
    }
    catch (error) {
        console.error('[reviews] Approve error:', error?.message ?? error);
        return res.status(500).json({ error: 'Failed to approve note' });
    }
});
exports.default = router;
