import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { ENV } from '../config/env';
import { prisma } from '../config/prisma';
import { AuthenticatedRequest, AuthUserPayload } from '../types';
import { Role } from '@prisma/client';
import { ALL_PERMISSION_KEYS, PERMISSION_TEMPLATES } from '../constants/permissions';

export const credentialVersion = (hash: string) => createHash('sha256').update(hash).digest('hex');

export async function userForToken(token: string): Promise<AuthUserPayload> {
  const decoded = jwt.verify(token, ENV.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || typeof decoded.id !== 'string') throw new Error('Invalid token subject');
  const user = await prisma.user.findUnique({ where: { id: decoded.id }, include: { permissions: true } });
  if (!user || !Object.values(Role).includes(user.role)) throw new Error('User revoked');
  if (user.status && user.status !== 'ACTIVE') throw new Error(`User account is ${user.status.toLowerCase()}`);
  // Newly issued sessions are revoked on password reset. Legacy tokens remain compatible
  // until expiry; full legacy revocation requires an approved signing-key rotation.
  if (decoded.credentialVersion && decoded.credentialVersion !== credentialVersion(user.passwordHash)) throw new Error('Session revoked');

  const permissions: Record<string, boolean> = {};

  if (user.role === Role.DEVELOPER) {
    // Developer has full unrestricted access across all modules
    for (const key of ALL_PERMISSION_KEYS) {
      permissions[key] = true;
    }
  } else {
    // 1. If user has explicit permissions stored in DB, load them
    const hasDbPerms = user.permissions.length > 0;
    if (hasDbPerms) {
      for (const p of user.permissions) {
        permissions[p.permissionKey] = p.allowed;
      }
    } else {
      // 2. Fall back to standard role templates for backward compatibility if not yet configured
      if (user.role === Role.ADMIN) {
        const adminTpl = PERMISSION_TEMPLATES.find(t => t.id === 'ADMIN_DEFAULT');
        if (adminTpl) Object.assign(permissions, adminTpl.permissions);
      } else if (user.role === Role.HEAD) {
        const headTpl = PERMISSION_TEMPLATES.find(t => t.id === 'EVENT_OPERATIONS_MANAGER');
        if (headTpl) Object.assign(permissions, headTpl.permissions);
      } else if (user.role === Role.MEMBER) {
        const memberTpl = PERMISSION_TEMPLATES.find(t => t.id === 'SALES_OPERATOR');
        if (memberTpl) Object.assign(permissions, memberTpl.permissions);
      }
    }
  }

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    status: user.status,
    department: user.department,
    permissions,
  };
}
export const authenticateToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'Access token required' }); return; }
  try { req.user = await userForToken(header.slice(7)); next(); }
  catch { res.status(401).json({ error: 'Invalid, expired or revoked session' }); }
};
