import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';

const router = Router();

const ALL_HEAD_PERMISSIONS = [
  'view_inventory',
  'view_revenue',
  'view_customer_pii',
  'view_analytics',
  'view_event_breakdown',
  'edit_inventory',
  'edit_events',
  'export_data',
];

// GET /api/users: Accessible by Developer and Admin (view only for Admin)
router.get(
  '/',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          permissions: {
            select: {
              permissionKey: true,
              allowed: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
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

// POST /api/users: DEVELOPER ONLY (Admin cannot create new login accounts)
router.post(
  '/',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { name, username, email, password, role, permissions } = req.body;

    if (!name || !username || !password || !role) {
      res.status(400).json({ error: 'Name, username, password, and role are required' });
      return;
    }

    const normalizedRole = role.toUpperCase() as Role;
    if (!Object.values(Role).includes(normalizedRole)) {
      res.status(400).json({ error: 'Invalid role specified' });
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

      // If user is HEAD, initialize permissions
      if (normalizedRole === Role.HEAD) {
        const permsToInsert = ALL_HEAD_PERMISSIONS.map(key => ({
          userId: newUser.id,
          permissionKey: key,
          allowed: permissions && typeof permissions[key] === 'boolean' ? permissions[key] : false,
        }));

        await prisma.headPermission.createMany({
          data: permsToInsert,
        });
      }

      const created = await prisma.user.findUnique({
        where: { id: newUser.id },
        include: { permissions: true },
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

      res.json({ user: updated });
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

// DELETE /api/users/:id: DEVELOPER ONLY (Admin cannot delete accounts)
router.delete(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    if (req.user?.id === id) {
      res.status(400).json({ error: 'You cannot delete your own active account' });
      return;
    }

    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Check if user has sales recorded
      const salesCount = await prisma.sale.count({ where: { memberId: id } });
      if (salesCount > 0) {
        res.status(400).json({
          error: `Cannot delete member who has recorded ${salesCount} sales. Historical records must be preserved.`,
        });
        return;
      }

      await prisma.headPermission.deleteMany({ where: { userId: id } });
      await prisma.user.delete({ where: { id } });

      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ error: 'Failed to delete user' });
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

      res.json({ message: `Password reset successfully for ${user.username}` });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ error: 'Failed to reset password' });
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
      const perms = await prisma.headPermission.findMany({
        where: { userId: id },
      });

      const permsMap = perms.reduce((acc, p) => {
        acc[p.permissionKey] = p.allowed;
        return acc;
      }, {} as Record<string, boolean>);

      res.json({ permissions: permsMap });
    } catch (error) {
      console.error('Get permissions error:', error);
      res.status(500).json({ error: 'Failed to get permissions' });
    }
  }
);

// PUT /api/users/:id/permissions: DEVELOPER ONLY
router.put(
  '/:id/permissions',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const { permissions } = req.body; // e.g. { view_inventory: true, view_revenue: false }

    if (!permissions || typeof permissions !== 'object') {
      res.status(400).json({ error: 'Permissions object required' });
      return;
    }

    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user || user.role !== Role.HEAD) {
        res.status(400).json({ error: 'Permissions checklist only applies to HEAD accounts' });
        return;
      }

      for (const [key, value] of Object.entries(permissions)) {
        if (ALL_HEAD_PERMISSIONS.includes(key)) {
          await prisma.headPermission.upsert({
            where: {
              userId_permissionKey: {
                userId: id,
                permissionKey: key,
              },
            },
            update: { allowed: Boolean(value) },
            create: {
              userId: id,
              permissionKey: key,
              allowed: Boolean(value),
            },
          });
        }
      }

      const updatedPerms = await prisma.headPermission.findMany({
        where: { userId: id },
      });

      res.json({
        message: 'Permissions updated successfully',
        permissions: updatedPerms.reduce((acc, p) => {
          acc[p.permissionKey] = p.allowed;
          return acc;
        }, {} as Record<string, boolean>),
      });
    } catch (error) {
      console.error('Update permissions error:', error);
      res.status(500).json({ error: 'Failed to update permissions' });
    }
  }
);

export default router;
