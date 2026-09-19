"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOrganisationId = requireOrganisationId;
/**
 * NOT actual tenant isolation. This only checks that the JWT carries an organisationId at
 * all — it does not filter, scope, or enforce anything against the requested resource. The
 * previous comment here ("enforces cross-organisation boundary") was wrong and this
 * middleware is not wired into any route, so nothing was relying on it, but a comment
 * claiming enforcement that doesn't happen is exactly how a future route gets written
 * assuming a check exists here that doesn't. Every route in this codebase currently does its
 * own `resource.organisationId !== req.user.organisationId` check after loading the resource
 * (see routes/meetings.ts, transcripts.ts, reviews.ts, documents.ts, etc.) — that per-route
 * check, not this function, is what actually enforces the tenant boundary today.
 */
function requireOrganisationId(req, res, next) {
    if (!req.user || !req.user.organisationId) {
        return res.status(403).json({ error: 'Tenant identification missing.' });
    }
    next();
}
