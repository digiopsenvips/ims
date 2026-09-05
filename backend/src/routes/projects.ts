import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';

const router = Router();

// GET /api/projects: List projects with products and their stock
router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const projects = await prisma.project.findMany({
        include: {
          products: {
            where: { isDeleted: false },
            include: {
              inventory: true,
            },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      });

      res.json({ projects });
    } catch (error) {
      console.error('Fetch projects error:', error);
      res.status(500).json({ error: 'Failed to fetch projects' });
    }
  }
);

// POST /api/projects: Create project (Developer or Admin)
router.post(
  '/',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { name } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    try {
      const trimmedName = name.trim();

      // Derive a 3-character code (e.g. "Tahsin" -> "TAH", "Upcycle" -> "UPC")
      let baseCode = trimmedName.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase();
      if (baseCode.length < 3) {
        baseCode = (baseCode + 'PRJ').slice(0, 3);
      }

      // Check for duplicate name or code
      const existing = await prisma.project.findFirst({
        where: {
          OR: [
            { name: { equals: trimmedName, mode: 'insensitive' } },
            { code: baseCode },
          ],
        },
      });

      let finalCode = baseCode;
      if (existing) {
        if (existing.name.toLowerCase() === trimmedName.toLowerCase()) {
          res.status(409).json({ error: `Project '${trimmedName}' already exists` });
          return;
        }
        // Unique code generation
        finalCode = `${baseCode}${Math.floor(10 + Math.random() * 89)}`;
      }

      const project = await prisma.project.create({
        data: {
          name: trimmedName,
          code: finalCode,
        },
      });

      res.status(201).json({ project });
    } catch (error) {
      console.error('Create project error:', error);
      res.status(500).json({ error: 'Failed to create project' });
    }
  }
);

// POST /api/projects/:id/products: Add product under a project with AUTO-GENERATED product ID
router.post(
  '/:id/products',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id: projectId } = req.params;
    const { name, basePrice } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Product name is required' });
      return;
    }

    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { products: true },
      });

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      // Generate Auto Product ID: Prefix with project code e.g. TAH-001, UPC-001
      // Find highest existing numerical suffix for this prefix
      const prefix = project.code;
      const existingProducts = await prisma.product.findMany({
        where: { projectId },
        select: { id: true },
      });

      let maxIndex = 0;
      for (const p of existingProducts) {
        const parts = p.id.split('-');
        if (parts.length === 2 && !isNaN(parseInt(parts[1], 10))) {
          const num = parseInt(parts[1], 10);
          if (num > maxIndex) maxIndex = num;
        }
      }

      const nextNumber = (maxIndex + 1).toString().padStart(3, '0');
      const autoProductId = `${prefix}-${nextNumber}`;

      // Create product with auto-generated ID
      const product = await prisma.product.create({
        data: {
          id: autoProductId,
          name: name.trim(),
          projectId: project.id,
          basePrice: basePrice !== undefined && basePrice !== '' ? parseFloat(basePrice) : null,
          inventory: {
            create: {
              quantityOnHand: 0,
              notes: 'Initial registration',
            },
          },
        },
        include: {
          inventory: true,
          project: true,
        },
      });

      res.status(201).json({ product });
    } catch (error) {
      console.error('Create product error:', error);
      res.status(500).json({ error: 'Failed to create product' });
    }
  }
);

// DELETE /api/projects/:id: Delete a project and its products (DEVELOPER or ADMIN)
router.delete(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          products: { select: { id: true } },
        },
      });

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const productIds = project.products.map(p => p.id);

      await prisma.$transaction([
        prisma.sale.deleteMany({ where: { productId: { in: productIds } } }),
        prisma.eventAllocation.deleteMany({ where: { productId: { in: productIds } } }),
        prisma.inventory.deleteMany({ where: { productId: { in: productIds } } }),
        prisma.product.deleteMany({ where: { projectId: id } }),
        prisma.project.delete({ where: { id } }),
      ]);

      res.json({ message: `Project '${project.name}' and all its products were deleted successfully.` });
    } catch (error) {
      console.error('Delete project error:', error);
      res.status(500).json({ error: 'Failed to delete project' });
    }
  }
);

// PUT /api/projects/:id: Edit project name (DEVELOPER or ADMIN)
router.put(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    try {
      const existing = await prisma.project.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const trimmedName = String(name).trim();
      const updated = await prisma.project.update({
        where: { id },
        data: { name: trimmedName },
      });

      res.json({ project: updated, message: `Project '${updated.name}' updated successfully` });
    } catch (error) {
      console.error('Update project error:', error);
      res.status(500).json({ error: 'Failed to update project' });
    }
  }
);

export default router;
