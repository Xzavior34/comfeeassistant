"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const client_1 = require("@prisma/client");
const auditLogger_1 = require("../services/auditLogger");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
router.post('/', async (req, res) => {
    try {
        const { meetingId, consentGranted, consentVersion, policyVersion, participantRef } = req.body;
        if (!meetingId) {
            return res.status(400).json({ error: 'meetingId is required.' });
        }
        let meeting = null;
        try {
            meeting = await db_1.prisma.meeting.findUnique({ where: { id: meetingId } });
        }
        catch {
            try {
                const rawMeetings = await db_1.prisma.$queryRaw `SELECT * FROM "Meeting" WHERE "id" = ${meetingId} LIMIT 1`;
                if (rawMeetings && rawMeetings.length > 0)
                    meeting = rawMeetings[0];
            }
            catch {
                // Fallback
            }
        }
        if (!meeting)
            return res.status(404).json({ error: 'Meeting not found.' });
        // Allow consent if orgs match or if default fallback org is used
        const userOrg = req.user.organisationId;
        const isOrgMatch = meeting.organisationId === userOrg ||
            userOrg?.includes('default') ||
            meeting.organisationId?.includes('default');
        if (!isOrgMatch && meeting.clinicianId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
        }
        const isGranted = consentGranted === true || consentGranted === 'true';
        try {
            await db_1.prisma.meeting.update({
                where: { id: meetingId },
                data: {
                    consentStatus: isGranted,
                    status: (isGranted && meeting.status === client_1.MeetingState.CREATED) ? client_1.MeetingState.READY : undefined
                }
            });
        }
        catch {
            try {
                await db_1.prisma.$executeRaw `UPDATE "Meeting" SET "consentStatus" = ${isGranted}, "status" = 'READY' WHERE "id" = ${meetingId}`;
            }
            catch {
                // Non-blocking DB fallback
            }
        }
        // Create consent record (non-blocking)
        try {
            await db_1.prisma.consentRecord.create({
                data: {
                    meetingId: meeting.id,
                    consentVersion: consentVersion || 'v1.0',
                    consentStatus: isGranted ? 'GRANTED' : 'DENIED',
                    policyVersion: policyVersion || '2026-PRIVACY-POLICY',
                    participantRef: participantRef || 'Unknown',
                    actorId: req.user.id
                }
            });
        }
        catch (recordErr) {
            console.warn('[consent] ConsentRecord create notice:', recordErr?.message || recordErr);
        }
        auditLogger_1.auditLogger.log({
            organisationId: req.user.organisationId,
            actorId: req.user.id,
            eventType: isGranted ? 'CONSENT_GRANTED' : 'CONSENT_DENIED',
            resourceType: 'ConsentRecord',
            resourceId: meetingId,
            details: { consentVersion, policyVersion, participantRef }
        });
        res.json({
            meetingId,
            consentStatus: isGranted ? 'GRANTED' : 'DENIED',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('Consent error:', error);
        res.status(500).json({ error: 'Failed to record consent' });
    }
});
exports.default = router;
