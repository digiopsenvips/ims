import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { broadcast } from '../sockets';

const router = Router();

// GET /api/inventory: View inventory list with live stock
router.get(
  '/',
  authenticateToken,
  requirePermission('view_inventory'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const inventory = await prisma.inventory.findMany({
        include: {
          product: {
            include: {
              project: true,
              allocations: {
                where: {
                  event: {
                    status: 'ACTIVE',
                  },
                },
                include: {
                  event: {
                    select: {
                      id: true,
                      name: true,
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          productId: 'asc',
        },
      });

      // Calculate total allocated to active events and total sales
      const formatted = inventory.map(item => {
        const activeAllocated = item.product.allocations.reduce(
          (sum, a) => sum + a.allocatedQty,
          0
        );
        return {
          id: item.id,
          productId: item.productId,
          productName: item.product.name,
          projectId: item.product.projectId,
          projectName: item.product.project.name,
          basePrice: item.product.basePrice,
          quantityOnHand: item.quantityOnHand,
          activeAllocatedQty: activeAllocated,
          totalAvailable: item.quantityOnHand,
          notes: item.notes,
          lastUpdated: item.lastUpdated,
        };
      });

      res.json({ inventory: formatted });
    } catch (error) {
      console.error('Fetch inventory error:', error);
      res.status(500).json({ error: 'Failed to fetch inventory' });
    }
  }
);

// POST /api/inventory/bulk-intake: Bulk feeding form
router.post(
  '/bulk-intake',
  authenticateToken,
  requirePermission('edit_inventory'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { items } = req.body; // array of { productId, quantity, notes }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Items array is required' });
      return;
    }

    try {
      const results = [];

      for (const item of items) {
        const { productId, quantity, notes } = item;
        const qty = parseInt(quantity, 10);

        if (!productId || isNaN(qty) || qty <= 0) {
          continue;
        }

        // Upsert inventory record
        const updated = await prisma.inventory.upsert({
          where: { productId },
          update: {
            quantityOnHand: { increment: qty },
            notes: notes ? notes.trim() : undefined,
            lastUpdated: new Date(),
          },
          create: {
            productId,
            quantityOnHand: qty,
            notes: notes ? notes.trim() : 'Bulk intake intake batch',
            lastUpdated: new Date(),
          },
          include: {
            product: {
              include: { project: true },
            },
          },
        });

        results.push(updated);
      }

      // Broadcast inventory update via WebSocket
      broadcast('inventory:updated', {
        action: 'bulk_intake',
        count: results.length,
        timestamp: new Date().toISOString(),
      });

      res.status(200).json({
        message: `Successfully processed bulk intake for ${results.length} item(s)`,
        items: results,
      });
    } catch (error) {
      console.error('Bulk intake error:', error);
      res.status(500).json({ error: 'Failed to process bulk intake' });
    }
  }
);

// PUT /api/inventory/:productId: Manual count adjustment
router.put(
  '/:productId',
  authenticateToken,
  requirePermission('edit_inventory'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { productId } = req.params;
    const { quantityOnHand, notes } = req.body;

    const qty = parseInt(quantityOnHand, 10);
    if (isNaN(qty) || qty < 0) {
      res.status(400).json({ error: 'Valid quantityOnHand (>= 0) is required' });
      return;
    }

    try {
      const updated = await prisma.inventory.update({
        where: { productId },
        data: {
          quantityOnHand: qty,
          notes: notes !== undefined ? notes.trim() : undefined,
          lastUpdated: new Date(),
        },
        include: {
          product: { include: { project: true } },
        },
      });

      broadcast('inventory:updated', {
        action: 'stock_adjusted',
        productId,
        newQuantity: qty,
      });

      res.json({ inventory: updated });
    } catch (error) {
      console.error('Adjust inventory error:', error);
      res.status(500).json({ error: 'Failed to adjust inventory' });
    }
  }
);

export default router;
