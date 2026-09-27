import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role, ComboType, ComboStatus, Prisma } from '@prisma/client';
import { broadcast } from '../sockets';

const router = Router();

// GET /api/combos: List all combos with filtering and live pricing/stock calculation
router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        eventId,
        projectId,
        status,
        comboType,
        includeArchived,
        search,
      } = req.query;

      const whereClause: Prisma.ComboWhereInput = {
        ...(includeArchived === 'true' ? {} : { isArchived: false }),
        ...(status && (status === 'ACTIVE' || status === 'INACTIVE')
          ? { status: status as ComboStatus }
          : {}),
        ...(comboType ? { comboType: comboType as ComboType } : {}),
        ...(projectId ? { projectId: String(projectId) } : {}),
      };

      if (eventId) {
        // Event-specific combos + global combos (eventId: null)
        whereClause.OR = [
          { eventId: String(eventId) },
          { eventId: null },
        ];
      }

      if (search && typeof search === 'string' && search.trim() !== '') {
        const term = search.trim();
        whereClause.AND = [
          {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
              { items: { some: { product: { name: { contains: term, mode: 'insensitive' } } } } },
            ],
          },
        ];
      }

      // Fetch combos with items, products, event allocations and sale statistics
      const combos = await prisma.combo.findMany({
        where: whereClause,
        include: {
          event: {
            include: {
              allocations: true,
            },
          },
          project: true,
          items: {
            include: {
              product: {
                include: {
                  inventory: true,
                  project: true,
                },
              },
            },
          },
          sales: {
            select: {
              id: true,
              totalAmount: true,
            },
          },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      });

      // Enrich combos with live normal price, savings, and stock status
      const enriched = combos.map(combo => {
        let normalValue = 0;
        let isOutOfStock = false;
        let minAvailableStock = Infinity;

        const enrichedItems = combo.items.map(item => {
          const product = item.product;
          let unitPrice = Number(product.basePrice || 0);

          // If combo is tied to an event, check event allocation price
          if (combo.event) {
            const alloc = combo.event.allocations.find(a => a.productId === item.productId);
            if (alloc) {
              unitPrice = Number(alloc.priceAtEvent);
            }
          }

          if (!item.isFree) {
            normalValue += unitPrice * item.quantity;
          }

          const stock = product.inventory?.quantityOnHand ?? 0;
          if (item.quantity > 0) {
            const possibleCombos = Math.floor(stock / item.quantity);
            if (possibleCombos < minAvailableStock) {
              minAvailableStock = possibleCombos;
            }
          }

          if (stock < item.quantity) {
            isOutOfStock = true;
          }

          return {
            id: item.id,
            productId: item.productId,
            productName: product.name,
            projectId: product.projectId,
            projectName: product.project.name,
            quantity: item.quantity,
            isFree: item.isFree,
            unitPrice,
            lineTotal: unitPrice * item.quantity,
            availableStock: stock,
            isOutOfStock: stock < item.quantity,
          };
        });

        const comboPrice = Number(combo.price);
        const savings = Math.max(0, normalValue - comboPrice);
        const savingsPercent = normalValue > 0 ? Math.round((savings / normalValue) * 100) : 0;
        const availableStock = minAvailableStock === Infinity ? 0 : minAvailableStock;

        return {
          id: combo.id,
          name: combo.name,
          description: combo.description,
          comboType: combo.comboType,
          price: comboPrice,
          normalValue: Math.round(normalValue * 100) / 100,
          savings: Math.round(savings * 100) / 100,
          savingsPercent,
          status: combo.status,
          isArchived: combo.isArchived,
          eventId: combo.eventId,
          eventName: combo.event?.name || 'All Events (Global)',
          projectId: combo.projectId,
          projectName: combo.project?.name || null,
          minItems: combo.minItems,
          freeItemsCount: combo.freeItemsCount,
          items: enrichedItems,
          totalComponentUnits: enrichedItems.reduce((sum, i) => sum + i.quantity, 0),
          availableStock,
          isOutOfStock: isOutOfStock || availableStock <= 0,
          salesCount: combo.sales.length,
          revenueGenerated: combo.sales.reduce((sum, s) => sum + Number(s.totalAmount), 0),
          createdAt: combo.createdAt,
          updatedAt: combo.updatedAt,
        };
      });

      res.json({ combos: enriched });
    } catch (error) {
      console.error('Fetch combos error:', error);
      res.status(500).json({ error: 'Failed to fetch combos' });
    }
  }
);

// GET /api/combos/:id: Single combo details
router.get(
  '/:id',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const combo = await prisma.combo.findUnique({
        where: { id },
        include: {
          event: {
            include: {
              allocations: true,
            },
          },
          project: true,
          items: {
            include: {
              product: {
                include: {
                  inventory: true,
                  project: true,
                },
              },
            },
          },
          sales: {
            include: {
              member: { select: { id: true, name: true, username: true } },
            },
            orderBy: { saleTime: 'desc' },
            take: 20,
          },
        },
      });

      if (!combo) {
        res.status(404).json({ error: 'Combo not found' });
        return;
      }

      let normalValue = 0;
      let minAvailableStock = Infinity;

      const enrichedItems = combo.items.map(item => {
        const product = item.product;
        let unitPrice = Number(product.basePrice || 0);

        if (combo.event) {
          const alloc = combo.event.allocations.find(a => a.productId === item.productId);
          if (alloc) {
            unitPrice = Number(alloc.priceAtEvent);
          }
        }

        if (!item.isFree) {
          normalValue += unitPrice * item.quantity;
        }

        const stock = product.inventory?.quantityOnHand ?? 0;
        if (item.quantity > 0) {
          const possibleCombos = Math.floor(stock / item.quantity);
          if (possibleCombos < minAvailableStock) {
            minAvailableStock = possibleCombos;
          }
        }

        return {
          id: item.id,
          productId: item.productId,
          productName: product.name,
          projectId: product.projectId,
          projectName: product.project.name,
          quantity: item.quantity,
          isFree: item.isFree,
          unitPrice,
          lineTotal: unitPrice * item.quantity,
          availableStock: stock,
          isOutOfStock: stock < item.quantity,
        };
      });

      const comboPrice = Number(combo.price);
      const savings = Math.max(0, normalValue - comboPrice);
      const savingsPercent = normalValue > 0 ? Math.round((savings / normalValue) * 100) : 0;
      const availableStock = minAvailableStock === Infinity ? 0 : minAvailableStock;

      res.json({
        combo: {
          id: combo.id,
          name: combo.name,
          description: combo.description,
          comboType: combo.comboType,
          price: comboPrice,
          normalValue: Math.round(normalValue * 100) / 100,
          savings: Math.round(savings * 100) / 100,
          savingsPercent,
          status: combo.status,
          isArchived: combo.isArchived,
          eventId: combo.eventId,
          eventName: combo.event?.name || 'All Events (Global)',
          projectId: combo.projectId,
          projectName: combo.project?.name || null,
          minItems: combo.minItems,
          freeItemsCount: combo.freeItemsCount,
          items: enrichedItems,
          availableStock,
          isOutOfStock: availableStock <= 0,
          salesCount: combo.sales.length,
          revenueGenerated: combo.sales.reduce((sum, s) => sum + Number(s.totalAmount), 0),
          recentSales: combo.sales.map(s => ({
            id: s.id,
            receiptNumber: s.receiptNumber,
            totalAmount: Number(s.totalAmount),
            paymentMethod: s.paymentMethod,
            saleTime: s.saleTime,
            memberName: s.sellerNameAtSale || s.member?.name || 'Member',
          })),
          createdAt: combo.createdAt,
          updatedAt: combo.updatedAt,
        },
      });
    } catch (error) {
      console.error('Fetch combo details error:', error);
      res.status(500).json({ error: 'Failed to fetch combo details' });
    }
  }
);

// POST /api/combos: Create a new custom combo
router.post(
  '/',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN, Role.HEAD, Role.MEMBER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        name,
        description,
        comboType = 'FIXED_QUANTITY',
        price,
        status = 'ACTIVE',
        eventId,
        projectId,
        minItems,
        freeItemsCount,
        items,
      } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Combo name is required' });
        return;
      }

      const parsedPrice = parseFloat(String(price));
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        res.status(400).json({ error: 'Combo price must be a valid positive number' });
        return;
      }

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'A combo must contain at least one product component' });
        return;
      }

      // Validate combo type
      const validTypes: ComboType[] = ['FIXED_QUANTITY', 'MULTI_PRODUCT', 'PICK_ANY', 'BUY_X_GET_Y'];
      if (!validTypes.includes(comboType)) {
        res.status(400).json({ error: `Invalid combo type. Allowed: ${validTypes.join(', ')}` });
        return;
      }

      // Verify event exists if provided
      if (eventId) {
        const ev = await prisma.event.findUnique({ where: { id: String(eventId) } });
        if (!ev || ev.isDeleted) {
          res.status(400).json({ error: 'Selected event does not exist' });
          return;
        }
      }

      // Verify products exist
      const productIds = items.map((i: any) => String(i.productId));
      const existingProducts = await prisma.product.findMany({
        where: {
          id: { in: productIds },
          isDeleted: false,
        },
      });

      if (existingProducts.length !== productIds.length) {
        res.status(400).json({ error: 'One or more selected products are invalid or deleted' });
        return;
      }

      // Create combo in transaction
      const newCombo = await prisma.$transaction(async tx => {
        const created = await tx.combo.create({
          data: {
            name: name.trim(),
            description: description?.trim() || null,
            comboType: comboType as ComboType,
            price: parsedPrice,
            status: status === 'INACTIVE' ? ComboStatus.INACTIVE : ComboStatus.ACTIVE,
            eventId: eventId ? String(eventId) : null,
            projectId: projectId ? String(projectId) : null,
            minItems: minItems ? parseInt(String(minItems), 10) : (comboType === 'PICK_ANY' ? 3 : 1),
            freeItemsCount: freeItemsCount ? parseInt(String(freeItemsCount), 10) : 0,
            items: {
              create: items.map((i: any) => ({
                productId: String(i.productId),
                quantity: Math.max(1, parseInt(String(i.quantity || 1), 10)),
                isFree: Boolean(i.isFree),
              })),
            },
          },
          include: {
            event: true,
            project: true,
            items: {
              include: {
                product: {
                  include: { project: true, inventory: true },
                },
              },
            },
          },
        });
        return created;
      });

      broadcast('combo:created', {
        id: newCombo.id,
        name: newCombo.name,
        price: Number(newCombo.price),
        status: newCombo.status,
      });

      res.status(201).json({
        message: `Combo "${newCombo.name}" created successfully!`,
        combo: newCombo,
      });
    } catch (error: any) {
      console.error('Create combo error:', error);
      res.status(500).json({ error: error.message || 'Failed to create combo' });
    }
  }
);

// PUT /api/combos/:id: Update combo configuration
router.put(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN, Role.HEAD, Role.MEMBER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        comboType,
        price,
        status,
        eventId,
        projectId,
        minItems,
        freeItemsCount,
        items,
      } = req.body;

      const existing = await prisma.combo.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!existing) {
        res.status(404).json({ error: 'Combo not found' });
        return;
      }

      const updateData: any = {};
      if (name !== undefined) {
        if (!name.trim()) {
          res.status(400).json({ error: 'Combo name cannot be empty' });
          return;
        }
        updateData.name = name.trim();
      }

      if (description !== undefined) {
        updateData.description = description ? description.trim() : null;
      }

      if (price !== undefined) {
        const parsed = parseFloat(String(price));
        if (isNaN(parsed) || parsed <= 0) {
          res.status(400).json({ error: 'Combo price must be positive' });
          return;
        }
        updateData.price = parsed;
      }

      if (comboType !== undefined) {
        updateData.comboType = comboType as ComboType;
      }

      if (status !== undefined) {
        updateData.status = status as ComboStatus;
      }

      if (eventId !== undefined) {
        updateData.eventId = eventId ? String(eventId) : null;
      }

      if (projectId !== undefined) {
        updateData.projectId = projectId ? String(projectId) : null;
      }

      if (minItems !== undefined) {
        updateData.minItems = parseInt(String(minItems), 10) || 1;
      }

      if (freeItemsCount !== undefined) {
        updateData.freeItemsCount = parseInt(String(freeItemsCount), 10) || 0;
      }

      const updatedCombo = await prisma.$transaction(async tx => {
        // If items were sent, update components
        if (Array.isArray(items) && items.length > 0) {
          await tx.comboItem.deleteMany({ where: { comboId: id } });
          await tx.comboItem.createMany({
            data: items.map((i: any) => ({
              comboId: id,
              productId: String(i.productId),
              quantity: Math.max(1, parseInt(String(i.quantity || 1), 10)),
              isFree: Boolean(i.isFree),
            })),
          });
        }

        const updated = await tx.combo.update({
          where: { id },
          data: updateData,
          include: {
            event: true,
            project: true,
            items: {
              include: {
                product: {
                  include: { project: true, inventory: true },
                },
              },
            },
          },
        });
        return updated;
      });

      broadcast('combo:updated', {
        id: updatedCombo.id,
        name: updatedCombo.name,
        price: Number(updatedCombo.price),
        status: updatedCombo.status,
      });

      res.json({
        message: `Combo "${updatedCombo.name}" updated successfully!`,
        combo: updatedCombo,
      });
    } catch (error: any) {
      console.error('Update combo error:', error);
      res.status(500).json({ error: error.message || 'Failed to update combo' });
    }
  }
);

// PATCH /api/combos/:id/status: Toggle active/inactive
router.patch(
  '/:id/status',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN, Role.HEAD, Role.MEMBER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || (status !== 'ACTIVE' && status !== 'INACTIVE')) {
        res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE' });
        return;
      }

      const updated = await prisma.combo.update({
        where: { id },
        data: { status: status as ComboStatus },
      });

      broadcast('combo:status_changed', { id: updated.id, status: updated.status });

      res.json({
        message: `Combo status updated to ${updated.status}`,
        combo: updated,
      });
    } catch (error: any) {
      console.error('Toggle combo status error:', error);
      res.status(500).json({ error: error.message || 'Failed to update status' });
    }
  }
);

// PATCH /api/combos/:id/archive: Safely archive combo
router.patch(
  '/:id/archive',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN, Role.HEAD, Role.MEMBER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const updated = await prisma.combo.update({
        where: { id },
        data: {
          isArchived: true,
          status: ComboStatus.INACTIVE,
        },
      });

      broadcast('combo:archived', { id: updated.id });

      res.json({
        message: `Combo "${updated.name}" has been safely archived.`,
        combo: updated,
      });
    } catch (error: any) {
      console.error('Archive combo error:', error);
      res.status(500).json({ error: error.message || 'Failed to archive combo' });
    }
  }
);

// DELETE /api/combos/:id: Delete or Archive combo
router.delete(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN, Role.HEAD, Role.MEMBER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const combo = await prisma.combo.findUnique({
        where: { id },
        include: {
          sales: { select: { id: true } },
        },
      });

      if (!combo) {
        res.status(404).json({ error: 'Combo not found' });
        return;
      }

      // If combo has sales history, do NOT delete - archive instead!
      if (combo.sales.length > 0) {
        await prisma.combo.update({
          where: { id },
          data: {
            isArchived: true,
            status: ComboStatus.INACTIVE,
          },
        });

        res.json({
          message: `Combo "${combo.name}" has ${combo.sales.length} historical sales records and cannot be permanently deleted. It has been archived instead.`,
          archived: true,
        });
        return;
      }

      // If never used, delete
      await prisma.combo.delete({ where: { id } });
      broadcast('combo:deleted', { id });

      res.json({ message: `Combo "${combo.name}" deleted successfully.` });
    } catch (error: any) {
      console.error('Delete combo error:', error);
      res.status(500).json({ error: error.message || 'Failed to delete combo' });
    }
  }
);

export default router;
