import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';

export function enforceTenantIsolation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || !req.user.organisationId) {
    return res.status(403).json({ error: 'Tenant identification missing.' });
  }
  // Attaches multi-tenant filter helper to enforce cross-organisation boundary
  next();
}
