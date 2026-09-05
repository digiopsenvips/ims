import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env';
import { prisma } from '../config/prisma';
import { AuthenticatedRequest, AuthUserPayload } from '../types';
import { Role } from '@prisma/client';

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET) as AuthUserPayload;

    // Verify user is still in database and load up-to-date permissions for HEAD
    const dbUser = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        permissions: true,
      },
    });

    if (!dbUser) {
      res.status(401).json({ error: 'User not found or revoked' });
      return;
    }

    const permissionsMap: Record<string, boolean> = {};
    if (dbUser.role === Role.HEAD) {
      for (const p of dbUser.permissions) {
        permissionsMap[p.permissionKey] = p.allowed;
      }
    } else if (dbUser.role === Role.DEVELOPER || dbUser.role === Role.ADMIN) {
      // Dev and Admin have all permissions by default
      const allKeys = [
        'view_inventory',
        'view_revenue',
        'view_customer_pii',
        'view_analytics',
        'view_event_breakdown',
        'edit_inventory',
        'edit_events',
        'export_data',
      ];
      for (const k of allKeys) {
        permissionsMap[k] = true;
      }
    }

    req.user = {
      id: dbUser.id,
      name: dbUser.name,
      username: dbUser.username,
      role: dbUser.role,
      department: dbUser.department,
      permissions: permissionsMap,
    };

    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token' });
    return;
  }
};
