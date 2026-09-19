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
        const meeting = await db_1.prisma.meeting.findUnique({ where: { id: meetingId } });
        if (!meeting)
            return res.status(404).json({ error: 'Meeting not found.' });
        if (meeting.organisationId !== req.user.organisationId) {
            return res.status(403).json({ error: 'Forbidden: Multi-tenant boundary violation.' });
        }
        const isGranted = consentGranted === true || consentGranted === 'true';
        await db_1.prisma.meeting.update({
            where: { id: meetingId },
            data: {
                consentStatus: isGranted,
                status: (isGranted && meeting.status === client_1.MeetingState.CREATED) ? client_1.MeetingState.READY : undefined
            }
        });
        // Create consent record
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
