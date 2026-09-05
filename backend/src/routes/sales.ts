import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { sanitizeSaleForUser, sanitizeSalesListForUser } from '../middleware/piiSanitizer';
import { requireRoles } from '../middleware/rbac';
import { broadcast } from '../sockets';
import { PaymentMethod, Role } from '@prisma/client';

const router = Router();

// GET /api/sales: Full sales table (supports all-time or per-event filter)
router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { eventId, productId, memberId, startDate, endDate, paymentMethod, search } = req.query;

    // Check permission: if user is HEAD and doesn't have view_event_breakdown when filtering by event
    if (
      req.user?.role === Role.HEAD &&
      eventId &&
      !req.user.permissions?.['view_event_breakdown']
    ) {
      res.status(403).json({ error: 'Access denied: missing view_event_breakdown permission' });
      return;
    }

    try {
      const whereClause: any = {};

      if (eventId) {
        whereClause.eventId = String(eventId);
      }
      if (productId) {
        whereClause.productId = String(productId);
      }
      if (memberId) {
        whereClause.memberId = String(memberId);
      }
      if (paymentMethod && (paymentMethod === 'CASH' || paymentMethod === 'UPI')) {
        whereClause.paymentMethod = paymentMethod as PaymentMethod;
      }
      if (startDate || endDate) {
        whereClause.saleTime = {};
        if (startDate) whereClause.saleTime.gte = new Date(String(startDate));
        if (endDate) whereClause.saleTime.lte = new Date(String(endDate));
      }

      // If user is MEMBER, they can only view sales they recorded
      if (req.user?.role === Role.MEMBER) {
        whereClause.memberId = req.user.id;
      }

      const sales = await prisma.sale.findMany({
        where: whereClause,
        include: {
          event: {
            select: {
              id: true,
              name: true,
              location: true,
              status: true,
            },
          },
          product: {
            include: {
              project: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                },
              },
            },
          },
          member: {
            select: {
              id: true,
              name: true,
              username: true,
              department: true,
            },
          },
        },
        orderBy: { saleTime: 'desc' },
      });

      // Format and sanitize for permissions
      const formatted = sales.map(s => ({
        id: s.id, // Serial No.
        clientTxId: s.clientTxId,
        eventId: s.eventId,
        eventName: s.event.name,
        productId: s.productId,
        productName: s.product.name,
        projectId: s.product.project.id,
        projectName: s.product.project.name,
        memberId: s.memberId,
        memberName: s.member.name,
        memberUsername: s.member.username,
        memberDepartment: s.member.department,
        quantity: s.quantity,
        unitPrice: Number(s.unitPrice),
        totalAmount: Number(s.totalAmount),
        paymentMethod: s.paymentMethod,
        customerName: s.customerName,
        customerPhone: s.customerPhone,
        saleTime: s.saleTime,
        createdAt: s.createdAt,
      }));

      // Apply PII & revenue sanitization based on user permissions
      const sanitized = sanitizeSalesListForUser(formatted, req.user);

      res.json({
        sales: sanitized,
        totalCount: sanitized.length,
      });
    } catch (error) {
      console.error('Fetch sales error:', error);
      res.status(500).json({ error: 'Failed to fetch sales' });
    }
  }
);

// POST /api/sales: Record a single sale (real-time entry)
router.post(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const {
      eventId,
      productId,
      quantity,
      items,
      paymentMethod,
      customerName,
      customerPhone,
      clientTxId,
      saleTime,
    } = req.body;

    // Normalize items to process: supports array of items or single product
    const itemsToProcess: Array<{ productId: string; quantity: number }> =
      Array.isArray(items) && items.length > 0
        ? items.map((i: any) => ({
            productId: String(i.productId),
            quantity: parseInt(i.quantity, 10),
          }))
        : productId && quantity
        ? [{ productId: String(productId), quantity: parseInt(quantity, 10) }]
        : [];

    if (!eventId || itemsToProcess.length === 0 || !paymentMethod) {
      res.status(400).json({ error: 'Event, at least one product with quantity, and payment method are required' });
      return;
    }

    for (const item of itemsToProcess) {
      if (isNaN(item.quantity) || item.quantity <= 0) {
        res.status(400).json({ error: `Quantity must be a positive integer for product ${item.productId}` });
        return;
      }
    }

    const normMethod = (paymentMethod as string).toUpperCase() as PaymentMethod;
    if (!['CASH', 'UPI'].includes(normMethod)) {
      res.status(400).json({ error: 'Payment method must be CASH or UPI' });
      return;
    }

    try {
      // Check event and product allocations
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
          allocations: {
            include: { product: true },
          },
        },
      });

      if (!event || event.isDeleted) {
        res.status(404).json({ error: 'Event not found or inactive' });
        return;
      }

      if (event.status === 'ENDED') {
        res.status(400).json({ error: 'Cannot record sales for an ended event.' });
        return;
      }

      // Pre-validate all items against remaining allocations
      for (const item of itemsToProcess) {
        const allocation = event.allocations.find(a => a.productId === item.productId);
        if (!allocation) {
          res.status(400).json({ error: `Product ${item.productId} is not allocated to this event` });
          return;
        }

        const salesCount = await prisma.sale.aggregate({
          where: {
            eventId,
            productId: item.productId,
          },
          _sum: {
            quantity: true,
          },
        });

        const soldSoFar = salesCount._sum.quantity || 0;
        const remainingAllocated = allocation.allocatedQty - soldSoFar;

        if (item.quantity > remainingAllocated) {
          res.status(400).json({
            error: `Sale quantity (${item.quantity}) exceeds remaining stock allocated for ${allocation.product.name} (${remainingAllocated} remaining).`,
            productId: item.productId,
            remainingAllocated,
          });
          return;
        }
      }

      // Create sales in a transaction
      const createdSales = await prisma.$transaction(async tx => {
        const list = [];
        for (let idx = 0; idx < itemsToProcess.length; idx++) {
          const item = itemsToProcess[idx];
          const allocation = event.allocations.find(a => a.productId === item.productId)!;
          const unitPrice = Number(allocation.priceAtEvent);
          const totalAmount = unitPrice * item.quantity;

          const itemTxId = clientTxId
            ? itemsToProcess.length > 1
              ? `${clientTxId}-${idx}-${item.productId}`
              : clientTxId
            : null;

          if (itemTxId) {
            const existing = await tx.sale.findUnique({
              where: { clientTxId: itemTxId },
              include: {
                event: true,
                product: { include: { project: true } },
                member: true,
              },
            });
            if (existing) {
              list.push(existing);
              continue;
            }
          }

          const newSale = await tx.sale.create({
            data: {
              clientTxId: itemTxId,
              eventId,
              productId: item.productId,
              memberId: req.user!.id,
              quantity: item.quantity,
              unitPrice,
              totalAmount,
              paymentMethod: normMethod,
              customerName: customerName ? customerName.trim() : null,
              customerPhone: customerPhone ? customerPhone.trim() : null,
              saleTime: saleTime ? new Date(saleTime) : new Date(),
            },
            include: {
              event: true,
              product: { include: { project: true } },
              member: true,
            },
          });
          list.push(newSale);
        }
        return list;
      });

      // Broadcast live updates via WebSocket
      for (const newSale of createdSales) {
        broadcast('sale:created', {
          id: newSale.id,
          eventId: newSale.eventId,
          eventName: newSale.event.name,
          productId: newSale.productId,
          productName: newSale.product.name,
          quantity: newSale.quantity,
          totalAmount: Number(newSale.totalAmount),
          paymentMethod: newSale.paymentMethod,
          memberName: newSale.member.name,
          saleTime: newSale.saleTime,
        });
      }

      broadcast('inventory:updated', {
        action: 'sales_recorded',
        eventId,
        count: createdSales.length,
      });

      const sanitizedList = sanitizeSalesListForUser(createdSales, req.user);

      res.status(201).json({
        message: `${createdSales.length} sale item(s) recorded successfully`,
        sale: sanitizedList[0], // Maintains backward compatibility
        sales: sanitizedList,
        totalItems: createdSales.reduce((acc, s) => acc + s.quantity, 0),
        totalOrderAmount: createdSales.reduce((acc, s) => acc + Number(s.totalAmount), 0),
      });
    } catch (error) {
      console.error('Record sale error:', error);
      res.status(500).json({ error: 'Failed to record sale' });
    }
  }
);

// POST /api/sales/sync: Bulk offline sync endpoint from PWA IndexedDB queue
router.post(
  '/sync',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { sales } = req.body;

    if (!Array.isArray(sales) || sales.length === 0) {
      res.status(400).json({ error: 'Sales array is required' });
      return;
    }

    try {
      const results: any[] = [];
      let syncedCount = 0;

      for (const item of sales) {
        const {
          clientTxId,
          eventId,
          productId,
          quantity,
          paymentMethod,
          customerName,
          customerPhone,
          saleTime,
        } = item;

        // Idempotency check
        if (clientTxId) {
          const existing = await prisma.sale.findUnique({
            where: { clientTxId },
          });
          if (existing) {
            results.push({ clientTxId, status: 'already_synced', saleId: existing.id });
            continue;
          }
        }

        // Validate allocation & pricing
        const alloc = await prisma.eventAllocation.findUnique({
          where: {
            eventId_productId: {
              eventId,
              productId,
            },
          },
        });

        if (!alloc) {
          results.push({ clientTxId, status: 'failed', error: 'Product not allocated to event' });
          continue;
        }

        const qty = parseInt(quantity, 10) || 1;
        const unitPrice = Number(alloc.priceAtEvent);
        const totalAmount = unitPrice * qty;

        const created = await prisma.sale.create({
          data: {
            clientTxId: clientTxId || null,
            eventId,
            productId,
            memberId: req.user!.id,
            quantity: qty,
            unitPrice,
            totalAmount,
            paymentMethod: paymentMethod === 'UPI' ? PaymentMethod.UPI : PaymentMethod.CASH,
            customerName: customerName ? customerName.trim() : null,
            customerPhone: customerPhone ? customerPhone.trim() : null,
            saleTime: saleTime ? new Date(saleTime) : new Date(),
          },
        });

        syncedCount++;
        results.push({ clientTxId, status: 'success', saleId: created.id });

        // Broadcast to listeners
        broadcast('sale:created', {
          id: created.id,
          eventId: created.eventId,
          productId: created.productId,
          quantity: created.quantity,
          totalAmount,
          saleTime: created.saleTime,
        });
      }

      if (syncedCount > 0) {
        broadcast('inventory:updated', { action: 'offline_sync_completed', count: syncedCount });
      }

      res.json({
        message: `Successfully processed sync for ${sales.length} items (${syncedCount} newly recorded)`,
        syncedCount,
        results,
      });
    } catch (error) {
      console.error('Offline sync error:', error);
      res.status(500).json({ error: 'Failed to process offline sync' });
    }
  }
);

// DELETE /api/sales/purge-all: Purge all sales records (DEVELOPER ONLY)
router.delete(
  '/purge-all',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { count } = await prisma.sale.deleteMany({});
      broadcast('inventory:updated', { action: 'sales_purged', count });
      res.json({ message: `Successfully deleted all ${count} sales records. Database is ready for actual project data.`, count });
    } catch (error) {
      console.error('Purge sales error:', error);
      res.status(500).json({ error: 'Failed to purge sales records' });
    }
  }
);

// PUT /api/sales/:id: Edit an existing sale record (DEVELOPER ONLY)
router.put(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid sale ID' });
      return;
    }

    const {
      quantity,
      unitPrice,
      paymentMethod,
      customerName,
      customerPhone,
      saleTime,
    } = req.body;

    try {
      const existing = await prisma.sale.findUnique({
        where: { id },
        include: {
          product: { include: { project: true } },
          event: true,
          member: true,
        },
      });

      if (!existing) {
        res.status(404).json({ error: 'Sale record not found' });
        return;
      }

      const updateData: any = {};

      if (quantity !== undefined) {
        const newQty = parseInt(quantity, 10);
        if (isNaN(newQty) || newQty <= 0) {
          res.status(400).json({ error: 'Quantity must be a positive integer' });
          return;
        }
        updateData.quantity = newQty;
      }

      if (unitPrice !== undefined) {
        const newPrice = parseFloat(unitPrice);
        if (isNaN(newPrice) || newPrice < 0) {
          res.status(400).json({ error: 'Unit price must be a non-negative number' });
          return;
        }
        updateData.unitPrice = newPrice;
      }

      const effectiveQty = updateData.quantity !== undefined ? updateData.quantity : existing.quantity;
      const effectivePrice = updateData.unitPrice !== undefined ? updateData.unitPrice : Number(existing.unitPrice);
      updateData.totalAmount = effectiveQty * effectivePrice;

      if (paymentMethod !== undefined) {
        const normMethod = (paymentMethod as string).toUpperCase();
        if (!['CASH', 'UPI'].includes(normMethod)) {
          res.status(400).json({ error: 'Payment method must be CASH or UPI' });
          return;
        }
        updateData.paymentMethod = normMethod as PaymentMethod;
      }

      if (customerName !== undefined) {
        updateData.customerName = customerName ? String(customerName).trim() : null;
      }

      if (customerPhone !== undefined) {
        updateData.customerPhone = customerPhone ? String(customerPhone).trim() : null;
      }

      if (saleTime !== undefined) {
        updateData.saleTime = new Date(saleTime);
      }

      const updated = await prisma.sale.update({
        where: { id },
        data: updateData,
        include: {
          product: { include: { project: true } },
          event: true,
          member: true,
        },
      });

      broadcast('inventory:updated', { action: 'sale_updated', id });

      const formatted = {
        id: updated.id,
        clientTxId: updated.clientTxId,
        eventId: updated.eventId,
        eventName: updated.event.name,
        productId: updated.productId,
        productName: updated.product.name,
        projectId: updated.product.project.id,
        projectName: updated.product.project.name,
        memberId: updated.memberId,
        memberName: updated.member.name,
        memberUsername: updated.member.username,
        memberDepartment: updated.member.department,
        quantity: updated.quantity,
        unitPrice: Number(updated.unitPrice),
        totalAmount: Number(updated.totalAmount),
        paymentMethod: updated.paymentMethod,
        customerName: updated.customerName,
        customerPhone: updated.customerPhone,
        saleTime: updated.saleTime,
        createdAt: updated.createdAt,
      };

      res.json({
        message: 'Sale updated successfully',
        sale: sanitizeSaleForUser(formatted, req.user),
      });
    } catch (error) {
      console.error('Update sale error:', error);
      res.status(500).json({ error: 'Failed to update sale' });
    }
  }
);

// DELETE /api/sales/:id: Delete a single sale record (DEVELOPER ONLY)
router.delete(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid sale ID' });
      return;
    }

    try {
      const existing = await prisma.sale.findUnique({
        where: { id },
      });

      if (!existing) {
        res.status(404).json({ error: 'Sale record not found' });
        return;
      }

      await prisma.sale.delete({ where: { id } });
      broadcast('inventory:updated', { action: 'sale_deleted', id });

      res.json({ message: `Sale #${id} deleted successfully`, id });
    } catch (error) {
      console.error('Delete sale error:', error);
      res.status(500).json({ error: 'Failed to delete sale' });
    }
  }
);

export default router;

