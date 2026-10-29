import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { ENV } from '../config/env';
import { prisma } from '../config/prisma';
import { AuthenticatedRequest, AuthUserPayload } from '../types';
import { Role } from '@prisma/client';

export const credentialVersion = (hash: string) => createHash('sha256').update(hash).digest('hex');
export async function userForToken(token: string): Promise<AuthUserPayload> {
  const decoded = jwt.verify(token, ENV.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || typeof decoded.id !== 'string') throw new Error('Invalid token subject');
  const user = await prisma.user.findUnique({ where: { id: decoded.id }, include: { permissions: true } });
  if (!user || !Object.values(Role).includes(user.role)) throw new Error('User revoked');
  // Newly issued sessions are revoked on password reset. Legacy tokens remain compatible
  // until expiry; full legacy revocation requires an approved signing-key rotation.
  if (decoded.credentialVersion && decoded.credentialVersion !== credentialVersion(user.passwordHash)) throw new Error('Session revoked');
  const permissions: Record<string, boolean> = {};
  if (user.role === Role.HEAD) for (const permission of user.permissions) permissions[permission.permissionKey] = permission.allowed;
  if (user.role === Role.DEVELOPER || user.role === Role.ADMIN) {
    for (const key of ['view_inventory','view_revenue','view_customer_pii','view_analytics','view_event_breakdown','edit_inventory','edit_events','export_data']) permissions[key] = true;
  }
  return { id: user.id, name: user.name, username: user.username, role: user.role, department: user.department, permissions };
}
export const authenticateToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'Access token required' }); return; }
  try { req.user = await userForToken(header.slice(7)); next(); }
  catch { res.status(401).json({ error: 'Invalid, expired or revoked session' }); }
};
