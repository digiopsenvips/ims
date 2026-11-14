import { responsePolicy } from '../middleware/responsePolicy';
import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role, UserStatus } from '@prisma/client';
import { broadcast } from '../sockets';
import { logAuditEvent } from '../services/auditLogger';
import { PERMISSION_TEMPLATES, ALL_PERMISSION_KEYS } from '../constants/permissions';

const router = Router();
router.use(responsePolicy);

// GET /api/users: Accessible by Developer and Admin (view only for Admin)
router.get(
  '/',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const isDeveloper = req.user?.role === Role.DEVELOPER;
      const statusParam = req.query.status as string | undefined;

      let whereClause: any = {};
      if (!isDeveloper) {
        // Non-developers can only see active accounts
        whereClause.status = 'ACTIVE';
      } else if (statusParam === 'ACTIVE') {
        whereClause.status = 'ACTIVE';
      } else if (statusParam === 'RETIRED') {
        whereClause.status = 'RETIRED';
      } else if (statusParam === 'SUSPENDED') {
        whereClause.status = 'SUSPENDED';
      }
      // If statusParam is ALL or omitted by Developer, whereClause returns all accounts

      const users = await prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          status: true,
          retiredAt: true,
          retiredById: true,
          retiredByName: true,
          retireReason: true,
          department: true,
          createdAt: true,
          updatedAt: true,
          permissions: {
            select: {
              permissionKey: true,
              allowed: true,
            },
          },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      });

      const formatted = users.map(u => ({
        ...u,
        permissions: u.permissions.reduce((acc, p) => {
          acc[p.permissionKey] = p.allowed;
          return acc;
        }, {} as Record<string, boolean>),
      }));

      res.json({ users: formatted });
    } catch (error) {
      console.error('Fetch users error:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }
);

// POST /api/users: Accessible by Developer and Admin (Admin cannot create Developer accounts)
router.post(
  '/',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { name, username, email, password, role, permissions } = req.body;

    if (!name || !username || !password || !role) {
      res.status(400).json({ error: 'Name, username, password, and role are required' });
      return;
    }

    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }

    const normalizedRole = role.toUpperCase() as Role;
    if (!Object.values(Role).includes(normalizedRole)) {
      res.status(400).json({ error: 'Invalid role specified' });
      return;
    }

    // Role hierarchy & privilege escalation guard:
    // Admin users cannot create Developer accounts
    if (req.user?.role === Role.ADMIN && normalizedRole === Role.DEVELOPER) {
      res.status(403).json({ error: 'Admin users are not authorized to create Developer accounts' });
      return;
    }

    try {
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { username: username.trim().toLowerCase() },
            ...(email ? [{ email: email.trim().toLowerCase() }] : []),
          ],
        },
      });

      if (existingUser) {
        if (existingUser.status === 'RETIRED') {
          res.status(409).json({
            error: `Username '@${existingUser.username}' belongs to a retired account whose historical records and attribution are preserved. You can reactivate this account from the Retired Accounts view, or choose another username.`,
          });
          return;
        }
        res.status(409).json({ error: 'Username or email already exists' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const newUser = await prisma.user.create({
        data: {
          name: name.trim(),
          username: username.trim().toLowerCase(),
          email: email ? email.trim().toLowerCase() : null,
          passwordHash,
          role: normalizedRole,
        },
      });

      // Initialize permissions for non-developer roles
      if (normalizedRole !== Role.DEVELOPER) {
        let permsToSave: Record<string, boolean> = {};

        if (permissions && typeof permissions === 'object') {
          permsToSave = permissions;
        } else {
          // Fall back to template defaults for the role
          if (normalizedRole === Role.ADMIN) {
            permsToSave = PERMISSION_TEMPLATES.find(t => t.id === 'ADMIN_DEFAULT')?.permissions || {};
          } else if (normalizedRole === Role.HEAD) {
            permsToSave = PERMISSION_TEMPLATES.find(t => t.id === 'EVENT_OPERATIONS_MANAGER')?.permissions || {};
          } else if (normalizedRole === Role.MEMBER) {
            permsToSave = PERMISSION_TEMPLATES.find(t => t.id === 'SALES_OPERATOR')?.permissions || {};
          }
        }

        const permsToInsert = Object.entries(permsToSave).map(([key, value]) => ({
          userId: newUser.id,
          permissionKey: key,
          allowed: Boolean(value),
        }));

        if (permsToInsert.length > 0) {
          await prisma.headPermission.createMany({
            data: permsToInsert,
            skipDuplicates: true,
          });
        }
      }

      await logAuditEvent({
        action: 'USER_CREATED',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.role,
        targetUserId: newUser.id,
        targetUsername: newUser.username,
        details: { role: normalizedRole, name: newUser.name, email: newUser.email },
        ipAddress: req.ip,
      });

      const created = await prisma.user.findUnique({
        where: { id: newUser.id },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          permissions: {
            select: {
              permissionKey: true,
              allowed: true,
            },
          },
        },
      });

      res.status(201).json({
        user: {
          ...created,
          permissions: created?.permissions.reduce((acc, p) => {
            acc[p.permissionKey] = p.allowed;
            return acc;
          }, {} as Record<string, boolean>),
        },
      });
    } catch (error) {
      console.error('Create user error:', error);
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

// PUT /api/users/:id: DEVELOPER ONLY (Admin cannot edit account metadata)
router.put(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, username, email, role } = req.body;

    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const updated = await prisma.user.update({
        where: { id },
        data: {
          name: name ? name.trim() : undefined,
          username: username ? username.trim().toLowerCase() : undefined,
          email: email !== undefined ? (email ? email.trim().toLowerCase() : null) : undefined,
          role: role ? (role.toUpperCase() as Role) : undefined,
        },
      });

      await logAuditEvent({
        action: 'USER_UPDATED',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.role,
        targetUserId: user.id,
        targetUsername: user.username,
        details: { changes: { name, username, email, role } },
        ipAddress: req.ip,
      });

      res.json({ user: updated });
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

// Reusable retirement handler: safe retirement that permanently preserves all historical attribution
async function handleRetireUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const reason = req.body?.reason || req.query?.reason;

  if (id === req.user?.id) {
    res.status(400).json({ error: 'Cannot retire your own Developer account' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            sales: true,
            gameSessions: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.role === Role.DEVELOPER) {
      res.status(403).json({
        error: 'Developer accounts cannot be retired. Demote the account first if retirement is required.',
      });
      return;
    }

    if (user.status === 'RETIRED') {
      res.status(400).json({ error: 'This user account is already retired' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        status: 'RETIRED',
        retiredAt: new Date(),
        retiredById: req.user!.id,
        retiredByName: req.user!.name,
        retireReason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'Account retired by Developer',
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        status: true,
        retiredAt: true,
        retiredById: true,
        retiredByName: true,
        retireReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logAuditEvent({
      action: 'USER_RETIRED',
      actorId: req.user!.id,
      actorName: req.user!.name,
      actorRole: req.user!.role,
      targetUserId: user.id,
      targetUsername: user.username,
      details: { reason },
      ipAddress: req.ip,
    });

    broadcast('user:retired', { userId: updated.id, username: updated.username });
    broadcast('user:updated', { userId: updated.id });

    res.json({
      success: true,
      retired: true,
      message: `Account @${user.username} successfully retired. Historical sales (${user._count.sales}) and game records (${user._count.gameSessions}) remain permanently attributed.`,
      user: updated,
    });
  } catch (error) {
    console.error('Retire user error:', error);
    res.status(500).json({ error: 'Failed to retire user account' });
  }
}

// POST /api/users/:id/retire: DEVELOPER ONLY
router.post(
  '/:id/retire',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  handleRetireUser
);

// DELETE /api/users/:id: DEVELOPER ONLY (Account retirement replacing destructive deletion)
router.delete(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  handleRetireUser
);

// POST /api/users/:id/reactivate: DEVELOPER ONLY
router.post(
  '/:id/reactivate',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (user.status !== 'RETIRED' && user.status !== 'SUSPENDED') {
        res.status(400).json({ error: 'Only retired or suspended accounts can be reactivated' });
        return;
      }

      const updated = await prisma.user.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          retiredAt: null,
          retiredById: null,
          retiredByName: null,
          retireReason: null,
        },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          status: true,
          retiredAt: true,
          retiredById: true,
          retiredByName: true,
          retireReason: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await logAuditEvent({
        action: 'USER_REACTIVATED',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.role,
        targetUserId: user.id,
        targetUsername: user.username,
        details: { previousStatus: user.status },
        ipAddress: req.ip,
      });

      broadcast('user:reactivated', { userId: updated.id, username: updated.username });
      broadcast('user:updated', { userId: updated.id });

      res.json({
        success: true,
        reactivated: true,
        message: `Account @${user.username} reactivated successfully. User can now log in.`,
        user: updated,
      });
    } catch (error) {
      console.error('Reactivate user error:', error);
      res.status(500).json({ error: 'Failed to reactivate user account' });
    }
  }
);

// POST /api/users/:id/reset-password: DEVELOPER ONLY
router.post(
  '/:id/reset-password',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters long' });
      return;
    }

    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id },
        data: { passwordHash },
      });

      await logAuditEvent({
        action: 'PASSWORD_RESET',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.role,
        targetUserId: user.id,
        targetUsername: user.username,
        details: { targetUsername: user.username },
        ipAddress: req.ip,
      });

      res.json({ message: `Password reset successfully for ${user.username}` });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  }
);

// GET /api/users/audit-logs: DEVELOPER ONLY
router.get(
  '/audit-logs',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
      const logs = await prisma.auditLog.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
      });
      res.json({ logs });
    } catch (error) {
      console.error('Fetch audit logs error:', error);
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  }
);

// GET /api/users/:id/permissions: Developer & Admin
router.get(
  '/:id/permissions',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (user.role === Role.DEVELOPER) {
        const allPerms: Record<string, boolean> = {};
        for (const key of ALL_PERMISSION_KEYS) {
          allPerms[key] = true;
        }
        res.json({ permissions: allPerms, isDeveloper: true });
        return;
      }

      const perms = await prisma.headPermission.findMany({
        where: { userId: id },
      });

      const permsMap = perms.reduce((acc, p) => {
        acc[p.permissionKey] = p.allowed;
        return acc;
      }, {} as Record<string, boolean>);

      if (perms.length === 0) {
        let defaultPerms: Record<string, boolean> = {};
        if (user.role === Role.ADMIN) {
          defaultPerms = PERMISSION_TEMPLATES.find(t => t.id === 'ADMIN_DEFAULT')?.permissions || {};
        } else if (user.role === Role.HEAD) {
          defaultPerms = PERMISSION_TEMPLATES.find(t => t.id === 'EVENT_OPERATIONS_MANAGER')?.permissions || {};
        } else if (user.role === Role.MEMBER) {
          defaultPerms = PERMISSION_TEMPLATES.find(t => t.id === 'SALES_OPERATOR')?.permissions || {};
        }
        res.json({ permissions: defaultPerms, isDefault: true });
        return;
      }

      res.json({ permissions: permsMap });
    } catch (error) {
      console.error('Get permissions error:', error);
      res.status(500).json({ error: 'Failed to get permissions' });
    }
  }
);

// PUT /api/users/:id/permissions: DEVELOPER ONLY (Can configure permissions for any non-developer user)
router.put(
  '/:id/permissions',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const { permissions } = req.body;

    if (!permissions || typeof permissions !== 'object') {
      res.status(400).json({ error: 'Permissions object required' });
      return;
    }

    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (user.role === Role.DEVELOPER) {
        res.status(400).json({ error: 'Developer accounts possess full system privileges and cannot be restricted' });
        return;
      }

      const existing = await prisma.headPermission.findMany({ where: { userId: id } });
      const oldMap = new Map(existing.map(p => [p.permissionKey, p.allowed]));

      const added: string[] = [];
      const removed: string[] = [];

      for (const [key, value] of Object.entries(permissions)) {
        const boolVal = Boolean(value);
        const oldVal = oldMap.get(key);

        if (boolVal && !oldVal) added.push(key);
        else if (!boolVal && oldVal) removed.push(key);

        await prisma.headPermission.upsert({
          where: {
            userId_permissionKey: {
              userId: id,
              permissionKey: key,
            },
          },
          update: { allowed: boolVal },
          create: {
            userId: id,
            permissionKey: key,
            allowed: boolVal,
          },
        });
      }

      const updatedPerms = await prisma.headPermission.findMany({
        where: { userId: id },
      });

      const permsMap = updatedPerms.reduce((acc, p) => {
        acc[p.permissionKey] = p.allowed;
        return acc;
      }, {} as Record<string, boolean>);

      await logAuditEvent({
        action: 'PERMISSIONS_UPDATED',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.role,
        targetUserId: user.id,
        targetUsername: user.username,
        details: {
          added,
          removed,
          totalGranted: Object.values(permsMap).filter(Boolean).length,
        },
        ipAddress: req.ip,
      });

      broadcast('user:permissions_updated', { userId: user.id });
      broadcast('user:updated', { userId: user.id });

      res.json({
        message: `Permissions updated successfully for ${user.name} (@${user.username})`,
        permissions: permsMap,
      });
    } catch (error) {
      console.error('Update permissions error:', error);
      res.status(500).json({ error: 'Failed to update permissions' });
    }
  }
);

export default router;
