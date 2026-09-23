"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const tenant_1 = require("../middleware/tenant");
const client_1 = require("@prisma/client");
const db_1 = require("../db");
const storage_1 = require("../providers/storage");
const auditLogger_1 = require("../services/auditLogger");
const env_1 = require("../config/env");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
/**
 * Optional consultation audio upload.
 *
 * Audio is not required. In the free configuration the transcript is produced on the
 * clinician's device and is the clinical artefact; the recording is a convenience a
 * deployment may choose to keep, and STORE_AUDIO=false means it never leaves the browser.
 * That is the smallest data footprint that still does the job.
 *
 * The body is raw binary. The previous version accepted base64 inside JSON, which inflates a
 * recording by a third, forces the whole consultation through a string in memory, and needed
 * a 20 MB JSON body limit across the API to work at all.
 */
const ALLOWED_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/mpeg']);
const EXTENSION = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/mpeg': 'mp3'
};
function audioStorageEnabled() {
    return env_1.env.STORE_AUDIO === 'true';
}
router.post('/upload', async (req, res) => {
    try {
        const meetingId = String(req.query.meetingId ?? '');
        if (!meetingId) {
            return res.status(400).json({ error: 'meetingId query parameter is required.' });
        }
        const meeting = await db_1.prisma.meeting.findUnique({ where: { id: meetingId } });
        if (!meeting)
            return res.status(404).json({ error: 'Meeting not found.' });
        if (!(0, tenant_1.isSameTenantOrOwner)(meeting, req.user)) {
            return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
        }
        // Consent is checked before the payload is examined at all: a recording for a session
        // with no consent is not something to validate, it is something to refuse.
        if (!meeting.consentStatus) {
            return res.status(400).json({
                error: 'Consent required. Recording upload blocked until valid consent is recorded.'
            });
        }
        if (!audioStorageEnabled()) {
            return res.status(200).json({
                stored: false,
                message: 'Audio retention is disabled in this deployment. The recording was not uploaded and ' +
                    'remains only in the browser. The transcript is the clinical record.'
            });
        }
        // The declared content type is a hint from the client, so it is checked against an
        // allowlist and used only to choose a file extension — never trusted as a filename.
        const declaredType = String(req.headers['content-type'] ?? '').split(';')[0].trim();
        if (!ALLOWED_TYPES.has(declaredType)) {
            return res.status(415).json({
                error: 'Unsupported audio type',
                message: `Content-Type must be one of: ${[...ALLOWED_TYPES].join(', ')}`
            });
        }
        const audio = req.body;
        if (!Buffer.isBuffer(audio) || audio.length === 0) {
            return res.status(400).json({ error: 'No audio data was received.' });
        }
        // Filename is derived from the meeting id and the allowlisted type, so nothing the
        // client sends reaches the storage key.
        const key = `recordings/${meetingId}.${EXTENSION[declaredType]}`;
        await (0, storage_1.getStorageProvider)().upload(key, audio, declaredType);
        auditLogger_1.auditLogger.log({
            organisationId: req.user.organisationId,
            actorId: req.user.id,
            eventType: 'RECORDING_UPLOADED',
            resourceType: 'Meeting',
            resourceId: meetingId,
            details: { bytes: audio.length, mimeType: declaredType, retentionHours: env_1.env.AUDIO_RETENTION_HOURS }
        });
        await db_1.prisma.meeting.update({
            where: { id: meetingId },
            data: { status: client_1.MeetingState.UPLOADED }
        });
        return res.json({
            stored: true,
            recording: { meetingId, storageKey: key, bytes: audio.length },
            retentionHours: Number(env_1.env.AUDIO_RETENTION_HOURS),
            message: 'Recording stored. Documentation is generated from the transcript, not the audio.'
        });
    }
    catch (error) {
        console.error('[recordings] Upload error:', error?.message ?? error);
        return res.status(500).json({ error: 'Failed to store recording' });
    }
});
exports.default = router;
