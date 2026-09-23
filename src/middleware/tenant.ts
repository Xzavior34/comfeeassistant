import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';

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
export function requireOrganisationId(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || !req.user.organisationId) {
    return res.status(403).json({ error: 'Tenant identification missing.' });
  }
  next();
}

/**
 * Validates whether a user is authorized to access a tenant resource.
 * Access is granted if:
 * 1. User is the direct creator/clinician of the meeting/resource.
 * 2. Resource organisation matches user organisation (case-insensitive).
 * 3. Both resource organisation and user organisation belong to default/fallback org names.
 */
export function isSameTenantOrOwner(
  resource: { organisationId?: string | null; clinicianId?: string | null } | null | undefined,
  user: { organisationId?: string | null; id?: string | null } | null | undefined
): boolean {
  if (!resource || !user) return false;

  // 1. Direct owner check (clinician created the meeting)
  if (resource.clinicianId && user.id && resource.clinicianId === user.id) {
    return true;
  }

  const resourceOrg = String(resource.organisationId || '').trim();
  const userOrg = String(user.organisationId || '').trim();

  if (!resourceOrg || !userOrg) return false;
  if (resourceOrg === userOrg) return true;

  const resLower = resourceOrg.toLowerCase();
  const userLower = userOrg.toLowerCase();
  if (resLower === userLower) return true;

  // 3. Default/fallback org name variations ('DEFAULT-ORG', 'default-org', 'default-org-fallback')
  const isResDefault = resLower.includes('default') || resLower === 'default-org' || resLower === 'default-org-fallback';
  const isUserDefault = userLower.includes('default') || userLower === 'default-org' || userLower === 'default-org-fallback';
  if (isResDefault && isUserDefault) return true;

  return false;
}

