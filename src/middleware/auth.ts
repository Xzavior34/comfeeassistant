import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AuthenticatedRequest, AuthenticatedUser } from '../types';
import { UserRole } from '@prisma/client';

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // A token in a query string is written to server access logs, browser history and the
  // Referer header. It is accepted only for document downloads, where a browser navigation
  // cannot carry a header, and never for the rest of the API.
  // originalUrl, not path: this middleware runs inside a mounted router, where req.path is
  // relative to the mount point and would never match the full route.
  const requestPath = (req.originalUrl ?? '').split('?')[0];
  const isDocumentDownload = /^\/api\/documents\/[^/]+\/(pdf|docx)$/.test(requestPath);
  if (!token && isDocumentDownload && typeof req.query.token === 'string' && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthenticatedUser;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden. Role ${req.user.role} does not have required permissions.` });
    }
    next();
  };
}
