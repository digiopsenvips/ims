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

    const payload = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      permissions,
    };

    const token = jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
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

export default router;
