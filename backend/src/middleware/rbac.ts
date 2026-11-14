import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, AuthUserPayload } from '../types';

/**
 * Checks whether an authenticated user has a specific granular permission.
 * - DEVELOPER always has full access (protected system-level rule).
 * - Backward compatibility with legacy permission keys is maintained.
 */
export function hasPermission(user: AuthUserPayload | undefined, permissionKey: string): boolean {
  if (!user) return false;
  if (user.role === Role.DEVELOPER) return true;

  // Direct grant in user's permissions
  if (user.permissions?.[permissionKey] === true) return true;

  // Backward compatibility with legacy keys (8 keys)
  if (permissionKey.startsWith('inventory.view_') && user.permissions?.['view_inventory'] === true) return true;
  if ((permissionKey === 'inventory.bulk_intake' || permissionKey === 'inventory.adjust' || permissionKey === 'inventory.allocate') && user.permissions?.['edit_inventory'] === true) return true;
  if (permissionKey.startsWith('events.') && !permissionKey.includes('revenue') && user.permissions?.['edit_events'] === true) return true;
  if ((permissionKey === 'events.view' || permissionKey === 'events.view_stock') && (user.permissions?.['view_inventory'] === true || user.permissions?.['edit_events'] === true)) return true;
  if (permissionKey.includes('revenue') && user.permissions?.['view_revenue'] === true) return true;
  if (permissionKey.includes('customer_pii') && user.permissions?.['view_customer_pii'] === true) return true;
  if (permissionKey === 'analytics.access' && user.permissions?.['view_analytics'] === true) return true;
  if (permissionKey === 'analytics.view_operational' && user.permissions?.['view_analytics'] === true) return true;
  if (permissionKey === 'analytics.view_financial' && user.permissions?.['view_revenue'] === true && user.permissions?.['view_analytics'] === true) return true;
  if (permissionKey === 'events.view_revenue' && user.permissions?.['view_revenue'] === true) return true;
  if (permissionKey === 'sales.view_revenue' && user.permissions?.['view_revenue'] === true) return true;
  if (permissionKey === 'sales.view_amounts' && user.permissions?.['view_revenue'] === true) return true;
  if (permissionKey.includes('export') && user.permissions?.['export_data'] === true) return true;

  return false;
}

/**
 * Middleware: Requires ANY of the listed permissions (OR logic).
 * Developer always passes.
 */
export const requirePermission = (...permissionKeys: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: Authentication required' });
      return;
    }

    if (req.user.role === Role.DEVELOPER) {
      next();
      return;
    }

    const isAuthorized = permissionKeys.some(key => hasPermission(req.user, key));

    if (!isAuthorized) {
      res.status(403).json({
        error: `Access denied: missing required permission [${permissionKeys.join(' or ')}]`,
        requiredPermissions: permissionKeys,
      });
      return;
    }

    next();
  };
};

/**
 * Middleware: Requires ALL of the listed permissions (AND logic).
 * Developer always passes.
 */
export const requireAllPermissions = (...permissionKeys: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: Authentication required' });
      return;
    }

    if (req.user.role === Role.DEVELOPER) {
      next();
      return;
    }

    const missing = permissionKeys.filter(key => !hasPermission(req.user, key));

    if (missing.length > 0) {
      res.status(403).json({
        error: `Access denied: missing required permissions [${missing.join(', ')}]`,
        missingPermissions: missing,
      });
      return;
    }

    next();
  };
};

/**
 * Legacy role-check middleware (kept for developer-protected endpoints)
 */
export const requireRoles = (...roles: Role[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Access denied: insufficient role privileges' });
      return;
    }

    next();
  };
};
