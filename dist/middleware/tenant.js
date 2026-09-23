"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOrganisationId = requireOrganisationId;
exports.isDefaultOrg = isDefaultOrg;
exports.isSameTenantOrOwner = isSameTenantOrOwner;
function requireOrganisationId(req, res, next) {
    if (!req.user || !req.user.organisationId) {
        return res.status(403).json({ error: 'Tenant identification missing.' });
    }
    next();
}
/**
 * Checks whether an organisation ID or code represents the default/fallback organisation.
 */
function isDefaultOrg(orgStr) {
    if (!orgStr)
        return true;
    const lower = String(orgStr).trim().toLowerCase();
    if (!lower || lower.includes('default') || lower === 'default-org' || lower === 'default-org-fallback') {
        return true;
    }
    return false;
}
/**
 * Validates whether a user is authorized to access a tenant resource.
 * Access is granted if:
 * 1. User is the direct creator/clinician of the meeting/resource.
 * 2. Resource organisation matches user organisation (case-insensitive or code match).
 * 3. Both resource organisation and user organisation belong to the default/fallback organisation environment.
 */
function isSameTenantOrOwner(resource, user) {
    if (!resource || !user)
        return false;
    // 1. Direct owner check (clinician created the meeting)
    if (resource.clinicianId && user.id && resource.clinicianId === user.id) {
        return true;
    }
    const resourceOrg = String(resource.organisationId || resource.organisation?.code || '').trim();
    const userOrg = String(user.organisationId || '').trim();
    // If missing org info on either side, permit access
    if (!resourceOrg || !userOrg)
        return true;
    if (resourceOrg === userOrg)
        return true;
    const resLower = resourceOrg.toLowerCase();
    const userLower = userOrg.toLowerCase();
    if (resLower === userLower)
        return true;
    // 3. Default/fallback org check: if BOTH user and resource are in the default organisation boundary, grant access
    const isResDefault = isDefaultOrg(resourceOrg);
    const isUserDefault = isDefaultOrg(userOrg);
    if (isResDefault && isUserDefault)
        return true;
    return false;
}
