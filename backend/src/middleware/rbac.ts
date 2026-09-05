import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, HeadPermissionKey } from '../types';

export const requireRoles = (...roles: Role[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Access denied: insufficient role privileges' });
      return;
    }

    next();
  };
};

export const requirePermission = (permissionKey: HeadPermissionKey) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Developer and Admin have full access
    if (req.user.role === Role.DEVELOPER || req.user.role === Role.ADMIN) {
      next();
      return;
    }

    // Member has no head permissions
    if (req.user.role === Role.MEMBER) {
      res.status(403).json({ error: 'Access denied: members cannot access this resource' });
      return;
    }

    // Head check
    if (req.user.role === Role.HEAD) {
      const allowed = req.user.permissions?.[permissionKey];
      if (allowed) {
        next();
        return;
      }
      res.status(403).json({ error: `Access denied: missing '${permissionKey}' permission` });
      return;
    }

    res.status(403).json({ error: 'Access denied' });
  };
};
