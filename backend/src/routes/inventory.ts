import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { broadcast } from '../sockets';
import { stockTransaction, StockConflict } from '../services/stock';
import { positiveInteger, nonnegativeInteger } from '../services/payment';

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

      // Get all active events to compute remaining stock at live stalls
      const activeEvents = await prisma.event.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, location: true },
      });
      const activeEventIds = activeEvents.map(e => e.id);

      // Aggregate sold units across active events
      const activeSales = activeEventIds.length > 0
        ? await prisma.saleItem.groupBy({
            by: ['productId'],
            where: {
              sale: { eventId: { in: activeEventIds } },
            },
            _sum: { quantity: true },
          })
        : [];

      const soldMap = new Map<string, number>();
      for (const s of activeSales) {
        soldMap.set(s.productId, s._sum.quantity || 0);
      }

      // Calculate total allocated to active events and total sales
      const formatted = inventory.map(item => {
        const totalAllocated = item.product.allocations.reduce(
          (sum, a) => sum + a.allocatedQty,
          0
        );
        const totalSoldAtActive = soldMap.get(item.productId) || 0;
        const activeStallStock = Math.max(0, totalAllocated - totalSoldAtActive);
        const warehouseStock = item.quantityOnHand;
        const totalAvailable = warehouseStock + activeStallStock;

        return {
          id: item.id,
          productId: item.productId,
          productName: item.product.name,
          projectId: item.product.projectId,
          projectName: item.product.project.name,
          basePrice: item.product.basePrice,
          warehouseStock,
          quantityOnHand: warehouseStock,
          activeAllocatedQty: activeStallStock,
          totalAvailable,
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
      const results = await stockTransaction(async tx => {
      const results = [];
      for (const item of items) {
        const { productId, quantity, notes } = item;
        const qty = positiveInteger(quantity, 'Intake quantity');

        if (!productId || isNaN(qty) || qty <= 0) {
          throw new StockConflict('Every intake item needs a product and positive quantity.');
        }

        // Upsert inventory record
        const updated = await tx.inventory.upsert({
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
      return results;
      });

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

    let qty: number;
    try { qty = nonnegativeInteger(quantityOnHand, 'Stock quantity'); }
    catch { res.status(400).json({ error: 'Stock quantity must be a non-negative whole number.' }); return; }
    if (!Number.isSafeInteger(qty) || qty < 0) {
      res.status(400).json({ error: 'Valid quantityOnHand (>= 0) is required' });
      return;
    }

    try {
      const expected = req.body.expectedQuantityOnHand;
      if (!Number.isSafeInteger(expected) || expected < 0) throw new StockConflict('Refresh stock before applying a count adjustment.');
      const updated = await stockTransaction(async tx => {
        const result = await tx.inventory.updateMany({
          where: { productId, quantityOnHand: expected },
          data: { quantityOnHand: qty, notes: typeof notes === 'string' ? notes.trim() : undefined, lastUpdated: new Date() },
        });
        if (result.count !== 1) throw new StockConflict('Stock changed since this count was opened. Refresh and reconcile before retrying.');
        return tx.inventory.findUnique({ where: { productId }, include: { product: { include: { project: true } } } });
      });

      broadcast('inventory:updated', {
        action: 'stock_adjusted',
        productId,
        newQuantity: qty,
      });

      res.json({ inventory: updated });
    } catch (error) {
      console.error('Adjust inventory error:', error);
      res.status((error as any).status || 500).json({ error: (error as any).status ? (error as Error).message : 'Failed to adjust inventory' });
    }
  }
);

export default router;
