"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const client_1 = require("@prisma/client");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
/**
 * This used to return two hardcoded example rows, always, for every organisation — a false
 * "audit trail" that never reflected anything that actually happened. It now reads the real,
 * persisted AuditLog table (see auditLogger.ts), scoped to the caller's own organisation.
 */
router.get('/', (0, auth_1.requireRole)(client_1.UserRole.ADMIN, client_1.UserRole.CLINICIAN), async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
        const auditTrail = await db_1.prisma.auditLog.findMany({
            where: { organisationId: req.user.organisationId },
            orderBy: { timestamp: 'desc' },
            take: limit
        });
        res.json({ organisationId: req.user.organisationId, auditTrail });
    }
    catch (error) {
        console.error('[audit] Failed to load audit trail:', error);
        res.status(500).json({ error: 'Failed to load audit trail.' });
    }
});
exports.default = router;
