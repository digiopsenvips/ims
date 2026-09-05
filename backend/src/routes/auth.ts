import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { ENV } from '../config/env';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: username.trim().toLowerCase() },
          { email: username.trim().toLowerCase() },
        ],
      },
      include: {
        permissions: true,
      },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Build permissions dictionary
    const permissions: Record<string, boolean> = {};
    if (user.role === Role.HEAD) {
      for (const p of user.permissions) {
        permissions[p.permissionKey] = p.allowed;
      }
    } else if (user.role === Role.DEVELOPER || user.role === Role.ADMIN) {
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
        permissions[k] = true;
      }
    }

    // If volunteer/user name provided during login, update their active profile name and department
    let activeName = user.name;
    let activeDepartment = user.department;

    if (req.body.name && typeof req.body.name === 'string' && req.body.name.trim()) {
      activeName = req.body.name.trim();
      activeDepartment =
        req.body.department && typeof req.body.department === 'string' && req.body.department.trim()
          ? req.body.department.trim()
          : null;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          name: activeName,
          department: activeDepartment,
        },
      });
    }

    const payload = {
      id: user.id,
      name: activeName,
      username: user.username,
      role: user.role,
      department: activeDepartment,
      permissions,
    };

    const token = jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        name: activeName,
        username: user.username,
        email: user.email,
        role: user.role,
        department: activeDepartment,
        permissions,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  res.json({
    user: req.user,
  });
});

// POST /api/auth/volunteer-checkin
router.post('/volunteer-checkin', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { name, department } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }

  try {
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        name: name.trim(),
        department: department && typeof department === 'string' && department.trim() ? department.trim() : null,
      },
    });

    const payload = {
      id: updated.id,
      name: updated.name,
      username: updated.username,
      role: updated.role,
      department: updated.department,
      permissions: req.user.permissions,
    };

    const token = jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Check-in details updated successfully',
      token,
      user: {
        id: updated.id,
        name: updated.name,
        username: updated.username,
        email: updated.email,
        role: updated.role,
        department: updated.department,
        permissions: req.user.permissions,
      },
    });
  } catch (error) {
    console.error('Checkin update error:', error);
    res.status(500).json({ error: 'Internal server error updating checkin' });
  }
});

export default router;
