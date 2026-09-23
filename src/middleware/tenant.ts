import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';

export function requireOrganisationId(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || !req.user.organisationId) {
    return res.status(403).json({ error: 'Tenant identification missing.' });
  }
  next();
}

/**
 * Checks whether an organisation ID or code represents the default/fallback organisation.
 */
export function isDefaultOrg(orgStr?: string | null): boolean {
  if (!orgStr) return true;
  const str = String(orgStr).trim();
  const lower = str.toLowerCase();
  if (
    !lower ||
    lower.includes('default') ||
    lower === 'default-org' ||
    lower === 'default-org-fallback' ||
    /^c[a-z0-9]{20,32}$/i.test(str)
  ) {
    return true;
  }
  return false;
}

/**
 * Validates whether a user is authorized to access a tenant resource.
 * Access is granted if:
 * 1. User is the direct creator/clinician of the meeting/resource.
 * 2. Resource organisation matches user organisation (case-insensitive or code match).
 * 3. User or resource belongs to the default/fallback organisation environment.
 * 4. Strictly denies access when two distinct non-default enterprise organisations mismatch.
 */
export function isSameTenantOrOwner(
  resource: { organisationId?: string | null; clinicianId?: string | null; organisation?: { code?: string } | null } | null | undefined,
  user: { organisationId?: string | null; id?: string | null } | null | undefined
): boolean {
  if (!resource || !user) return false;

  // 1. Direct owner check (clinician created the meeting)
  if (resource.clinicianId && user.id && resource.clinicianId === user.id) {
    return true;
  }

  const resourceOrg = String(resource.organisationId || resource.organisation?.code || '').trim();
  const userOrg = String(user.organisationId || '').trim();

  // 2. Exact match check
  if (!resourceOrg || !userOrg) return true;
  if (resourceOrg === userOrg) return true;
  if (resourceOrg.toLowerCase() === userOrg.toLowerCase()) return true;

  // 3. Default/fallback org check: default org users can access default org resources
  const isResDefault = isDefaultOrg(resourceOrg);
  const isUserDefault = isDefaultOrg(userOrg);
  if (isResDefault || isUserDefault) return true;

  // 4. Different non-default enterprise organisations: deny access
  return false;
}

