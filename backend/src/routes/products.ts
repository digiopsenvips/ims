import { stockTransaction } from '../services/stock';
import { responsePolicy } from '../middleware/responsePolicy';
import { broadcast } from '../sockets';
import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';

const router = Router();
router.use(responsePolicy);

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

      const updated = await stockTransaction(tx => tx.product.update({
        where: { id },
        data: updateData,
        include: {
          project: true,
          inventory: true,
        },
      }));

      res.json({ product: updated, message: `Product '${updated.name}' updated successfully` });
    } catch (error) {
      console.error('Update product error:', error);
      res.status(500).json({ error: 'Failed to update product' });
    }
  }
);

// PATCH /api/products/:id/archive: Toggle archive/restore status (Developer/Admin)
router.patch(
  ['/:id/archive', '/:id/retire', '/:id'],
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const isArchived = typeof req.body.isArchived === 'boolean' ? req.body.isArchived : true;

    try {
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }

      const updated = await stockTransaction(tx =>
        tx.product.update({
          where: { id },
          data: { isArchived },
          include: { project: true, inventory: true },
        })
      );

      broadcast('inventory:updated', {
        action: isArchived ? 'retired' : 'restored',
        productId: id,
      });

      res.json({
        product: updated,
        message: `Product '${updated.name}' ${isArchived ? 'safely archived/retired' : 'restored to active products'}.`,
      });
    } catch (error) {
      console.error('Archive product error:', error);
      res.status(500).json({ error: 'Failed to update product archive status' });
    }
  }
);

// DELETE /api/products/:id: Delete or soft-retire (Developer/Admin)
router.delete(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      await stockTransaction(tx => tx.product.update({ where: { id: req.params.id }, data: { isArchived: true } }));
      broadcast('inventory:updated', { action: 'retired', productId: req.params.id });
      res.json({ retired: true, message: 'Retired for future use. Existing records and history are preserved.' });
    } catch {
      res.status(400).json({ error: 'Unable to retire record. No history was deleted.' });
    }
  }
);

export default router;
