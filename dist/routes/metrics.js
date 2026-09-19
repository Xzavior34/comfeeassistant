"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
// Documentation Quality Metrics endpoint
router.get('/documentation-quality', async (req, res) => {
    try {
        const orgId = req.user.organisationId;
        // Very basic metrics query
        const meetings = await db_1.prisma.meeting.findMany({
            where: { organisationId: orgId },
            include: { clinicalNotes: true }
        });
        const metrics = {
            totalNotesGenerated: meetings.filter(m => m.clinicalNotes.length > 0).length,
            totalNotesReviewed: 0,
            totalNotesApproved: meetings.filter(m => m.status === 'APPROVED').length,
            notesApprovedWithoutEdits: 0,
            notesRequiringMinorEdits: 0,
            notesRequiringSubstantialEdits: 0,
            averageReviewDurationMs: 0,
            totalSpeechCorrectionsProposed: 0,
            totalSpeechCorrectionsAccepted: 0,
            totalGroundingViolations: 0,
            correctionRate: 0,
        };
        res.json({
            metrics,
            message: 'Aggregate documentation quality metrics. Patient identifiers are strictly isolated and not included.'
        });
    }
    catch (error) {
        console.error('Metrics error:', error);
        res.status(500).json({ error: 'Failed to generate metrics' });
    }
});
exports.default = router;
