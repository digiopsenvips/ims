import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';

const router = Router();

// GET /api/products: List all products with project and inventory
router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { projectId } = req.query;

    try {
      const products = await prisma.product.findMany({
        where: {
          isDeleted: false,
          ...(projectId ? { projectId: String(projectId) } : {}),
        },
        include: {
          project: true,
          inventory: true,
        },
        orderBy: { id: 'asc' },
      });

      res.json({ products });
    } catch (error) {
      console.error('Fetch products error:', error);
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  }
);

// PUT /api/products/:id: Edit product details (Developer/Admin)
router.put(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, basePrice } = req.body;

    try {
      const existing = await prisma.product.findUnique({
        where: { id },
      });

      if (!existing) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }

      const updateData: any = {};
      if (name !== undefined) {
        const trimmed = String(name).trim();
        if (!trimmed) {
          res.status(400).json({ error: 'Product name cannot be empty' });
          return;
        }
        updateData.name = trimmed;
      }

      if (basePrice !== undefined) {
        if (basePrice === '' || basePrice === null) {
          updateData.basePrice = null;
        } else {
          const parsed = parseFloat(basePrice);
          if (isNaN(parsed) || parsed < 0) {
            res.status(400).json({ error: 'Base price must be a valid positive number' });
            return;
          }
          updateData.basePrice = parsed;
        }
      }

      if (typeof req.body.isArchived === 'boolean') {
        updateData.isArchived = req.body.isArchived;
      }

      const updated = await prisma.product.update({
        where: { id },
        data: updateData,
        include: {
          project: true,
          inventory: true,
        },
      });

      res.json({ product: updated, message: `Product '${updated.name}' updated successfully` });
    } catch (error) {
      console.error('Update product error:', error);
      res.status(500).json({ error: 'Failed to update product' });
    }
  }
);

// DELETE /api/products/:id: Delete or soft-retire (Developer/Admin)
router.delete(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      const product = await prisma.product.findUnique({
        where: { id },
        include: {
          sales: { select: { id: true } },
          saleItems: { select: { id: true } },
          allocations: { select: { id: true } },
        },
      });

      if (!product) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }

      // If the product has historical sales or line items, NEVER DELETE IT. Safely retire it.
      if (product.sales.length > 0 || product.saleItems.length > 0 || product.allocations.length > 0) {
        await prisma.product.update({
          where: { id },
          data: { isArchived: true },
        });

        res.json({
          message: `Product '${product.name}' (${product.id}) has historical transactions and cannot be deleted. It has been safely RETIRED.`,
          retired: true,
        });
        return;
      }

      // If truly no historical dependencies exist, remove empty inventory and product
      await prisma.inventory.deleteMany({ where: { productId: id } });
      await prisma.product.delete({ where: { id } });

      res.json({ message: `Product '${product.name}' deleted successfully` });
    } catch (error) {
      console.error('Delete product error:', error);
      res.status(500).json({ error: 'Failed to delete product' });
    }
  }
);

export default router;
