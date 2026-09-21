import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { sanitizeSaleForUser, sanitizeSalesListForUser } from '../middleware/piiSanitizer';
import { requireRoles } from '../middleware/rbac';
import { broadcast } from '../sockets';
import { PaymentMethod, Role, Prisma } from '@prisma/client';

const router = Router();

// GET /api/sales: Full sales table with server-side pagination, deterministic sorting, and filtering
router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const {
      eventId,
      productId,
      memberId,
      startDate,
      endDate,
      paymentMethod,
      search,
      page: rawPage,
      pageSize: rawPageSize,
      all,
    } = req.query;

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
        whereClause.OR = [
          { productId: String(productId) },
          { items: { some: { productId: String(productId) } } },
        ];
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

      // Server-side search filter across product, project, member, event, customer, and ID
      if (search && typeof search === 'string' && search.trim() !== '') {
        const term = search.trim();
        const searchConditions: any[] = [
          { product: { name: { contains: term, mode: 'insensitive' } } },
          { product: { id: { contains: term, mode: 'insensitive' } } },
          { product: { project: { name: { contains: term, mode: 'insensitive' } } } },
          { items: { some: { product: { name: { contains: term, mode: 'insensitive' } } } } },
          { items: { some: { productId: { contains: term, mode: 'insensitive' } } } },
          { items: { some: { product: { project: { name: { contains: term, mode: 'insensitive' } } } } } },
          { member: { name: { contains: term, mode: 'insensitive' } } },
          { member: { username: { contains: term, mode: 'insensitive' } } },
          { event: { name: { contains: term, mode: 'insensitive' } } },
          { customerName: { contains: term, mode: 'insensitive' } },
          { customerPhone: { contains: term, mode: 'insensitive' } },
        ];
        const num = parseInt(term.replace(/^#/, ''), 10);
        if (!isNaN(num)) {
          searchConditions.push({ id: num });
          try {
            const rankedMatch: Array<{ id: number }> = await prisma.$queryRaw`
              WITH ranked_sales AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY sale_time ASC, created_at ASC, id ASC)::int as serial_number
                FROM sales
              )
              SELECT id FROM ranked_sales WHERE serial_number = ${num}
            `;
            if (rankedMatch && rankedMatch.length > 0) {
              searchConditions.push({ id: rankedMatch[0].id });
            }
          } catch (e) {
            // Ignore search ranking error if raw query fails
          }
        }
        whereClause.AND = whereClause.AND ? [...whereClause.AND, { OR: searchConditions }] : [{ OR: searchConditions }];
      }

      const isAll = all === 'true' || all === '1';
      const page = Math.max(1, parseInt(String(rawPage || '1'), 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(String(rawPageSize || '10'), 10) || 10));
      const skip = isAll ? undefined : (page - 1) * pageSize;
      const take = isAll ? undefined : pageSize;

      // Deterministic reverse chronological ordering: NEWEST first (highest S.No. is newest sale)
      const orderBy = [
        { saleTime: 'desc' as const },
        { createdAt: 'desc' as const },
        { id: 'desc' as const },
      ];

      const [totalRecords, sales, summaryRevenue, summaryUnits] = await Promise.all([
        prisma.sale.count({ where: whereClause }),
        prisma.sale.findMany({
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
            items: {
              include: {
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
          orderBy,
          skip,
          take,
        }),
        prisma.sale.aggregate({
          where: whereClause,
          _sum: {
            totalAmount: true,
            quantity: true,
          },
        }),
        prisma.saleItem.aggregate({
          where: {
            sale: whereClause,
          },
          _sum: {
            quantity: true,
          },
        }),
      ]);

      // Calculate each returned sale's global chronological serial number
      const rankMap = new Map<number, number>();
      if (sales.length > 0) {
        try {
          const saleIds = sales.map(s => s.id);
          const rankedRows: Array<{ id: number; serial_number: number }> = await prisma.$queryRaw`
            WITH ranked_sales AS (
              SELECT id, ROW_NUMBER() OVER (ORDER BY sale_time ASC, created_at ASC, id ASC)::int as serial_number
              FROM sales
            )
            SELECT id, serial_number FROM ranked_sales WHERE id IN (${Prisma.join(saleIds)})
          `;
          for (const row of rankedRows) {
            rankMap.set(row.id, Number(row.serial_number));
          }
        } catch (rankErr) {
          console.error('Failed to query sales rank CTE:', rankErr);
        }
      }

      // Format and sanitize for permissions
      const formatted = sales.map((s, index) => {
        const serialNumber = rankMap.get(s.id) ?? Math.max(1, totalRecords - ((page - 1) * pageSize) - index);

        // Normalize items array
        const rawItems = (s.items && s.items.length > 0)
          ? s.items.map(item => ({
              id: item.id,
              productId: item.productId,
              productName: item.product?.name || item.productId,
              projectId: item.product?.project?.id || '',
              projectName: item.product?.project?.name || '',
              quantity: item.quantity,
              unitPrice: Number(item.unitPrice),
              lineTotal: Number(item.lineTotal),
            }))
          : s.productId
          ? [{
              id: s.id,
              productId: s.productId,
              productName: s.product?.name || s.productId,
              projectId: s.product?.project?.id || '',
              projectName: s.product?.project?.name || '',
              quantity: s.quantity || 1,
              unitPrice: Number(s.unitPrice || 0),
              lineTotal: Number(s.totalAmount || 0),
            }]
          : [];

        const totalUnits = rawItems.reduce((sum, item) => sum + item.quantity, 0) || s.quantity || 0;
        const uniqueProjects = Array.from(new Set(rawItems.map(item => item.projectName).filter(Boolean)));
        const primaryProject = uniqueProjects.length > 0 ? uniqueProjects.join(' + ') : (s.product?.project?.name || 'Multiple');
        const productSummary = rawItems.map(item => `${item.productName} × ${item.quantity}`).join(', ') || s.product?.name || 'No Products';

        const firstItem = rawItems[0] || {};

        return {
          id: s.id, // Internal database ID
          serialNumber, // Global chronological S.No. (1 = oldest sale, highest = newest)
          clientTxId: s.clientTxId,
          eventId: s.eventId,
          eventName: s.event.name,
          productId: firstItem.productId || s.productId || '',
          productName: productSummary,
          projectId: firstItem.projectId || s.product?.project?.id || '',
          projectName: primaryProject,
          projectNames: uniqueProjects,
          memberId: s.memberId,
          memberName: s.member.name,
          memberUsername: s.member.username,
          memberDepartment: s.member.department,
          items: rawItems,
          totalUnits,
          quantity: totalUnits, // alias for totalUnits
          unitPrice: Number(firstItem.unitPrice ?? s.unitPrice ?? 0),
          totalAmount: Number(s.totalAmount),
          paymentMethod: s.paymentMethod,
          customerName: s.customerName,
          customerPhone: s.customerPhone,
          saleTime: s.saleTime,
          createdAt: s.createdAt,
        };
      });

      // Apply PII & revenue sanitization based on user permissions
      const sanitized = sanitizeSalesListForUser(formatted, req.user);

      const effectivePageSize = isAll ? (totalRecords || 1) : pageSize;
      const totalPages = Math.max(1, Math.ceil(totalRecords / effectivePageSize));

      const canViewRevenue =
        req.user?.role === Role.DEVELOPER ||
        req.user?.role === Role.ADMIN ||
        Boolean(req.user?.permissions?.['view_revenue']);

      const totalCalculatedUnits = summaryUnits._sum.quantity ?? summaryRevenue._sum.quantity ?? 0;

      res.json({
        sales: sanitized,
        data: sanitized,
        pagination: {
          page: isAll ? 1 : page,
          pageSize: isAll ? totalRecords : pageSize,
          totalRecords,
          totalPages,
          hasNextPage: !isAll && page < totalPages,
          hasPreviousPage: !isAll && page > 1,
        },
        summary: {
          totalUnits: totalCalculatedUnits,
          totalRevenue: canViewRevenue ? Number(summaryRevenue._sum.totalAmount || 0) : null,
        },
        totalCount: totalRecords,
      });
    } catch (error) {
      console.error('Fetch sales error:', error);
      res.status(500).json({ error: 'Failed to fetch sales' });
    }
  }
);

// POST /api/sales: Record a single customer transaction (real-time entry)
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

    // Normalize and merge duplicate items if selected multiple times
    const mergedItemsMap = new Map<string, number>();
    if (Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        const pId = String(item.productId || '');
        const q = parseInt(String(item.quantity || 0), 10);
        if (pId && !isNaN(q) && q > 0) {
          mergedItemsMap.set(pId, (mergedItemsMap.get(pId) || 0) + q);
        }
      }
    } else if (productId && quantity) {
      const pId = String(productId);
      const q = parseInt(String(quantity), 10);
      if (pId && !isNaN(q) && q > 0) {
        mergedItemsMap.set(pId, q);
      }
    }

    if (!eventId || mergedItemsMap.size === 0 || !paymentMethod) {
      res.status(400).json({ error: 'Event, at least one valid product with quantity, and payment method are required' });
      return;
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
            include: { product: { include: { project: true } } },
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
      const validatedItems: Array<{
        productId: string;
        productName: string;
        projectName: string;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
      }> = [];

      for (const [pId, requestedQty] of mergedItemsMap.entries()) {
        const allocation = event.allocations.find(a => a.productId === pId);
        if (!allocation) {
          res.status(400).json({ error: `Product ${pId} is not allocated to this event` });
          return;
        }

        // Calculate sold quantity from sale_items
        const salesAgg = await prisma.saleItem.aggregate({
          where: {
            productId: pId,
            sale: { eventId },
          },
          _sum: { quantity: true },
        });

        const soldSoFar = salesAgg._sum.quantity || 0;
        const remainingAllocated = allocation.allocatedQty - soldSoFar;

        if (requestedQty > remainingAllocated) {
          res.status(400).json({
            error: `Sale quantity (${requestedQty}) exceeds remaining stock allocated for ${allocation.product.name} (${remainingAllocated} remaining).`,
            productId: pId,
            remainingAllocated,
          });
          return;
        }

        const unitPrice = Number(allocation.priceAtEvent);
        const lineTotal = unitPrice * requestedQty;

        validatedItems.push({
          productId: pId,
          productName: allocation.product.name,
          projectName: allocation.product.project.name,
          quantity: requestedQty,
          unitPrice,
          lineTotal,
        });
      }

      const grandTotal = validatedItems.reduce((sum, item) => sum + item.lineTotal, 0);

      // Create single customer transaction in atomic database transaction
      const newSale = await prisma.$transaction(async tx => {
        // Idempotency check if clientTxId supplied
        if (clientTxId) {
          const existing = await tx.sale.findUnique({
            where: { clientTxId: String(clientTxId) },
            include: {
              event: true,
              member: true,
              items: {
                include: {
                  product: { include: { project: true } },
                },
              },
            },
          });
          if (existing) {
            return existing;
          }
        }

        return await tx.sale.create({
          data: {
            clientTxId: clientTxId ? String(clientTxId) : null,
            eventId,
            memberId: req.user!.id,
            totalAmount: grandTotal,
            paymentMethod: normMethod,
            customerName: customerName ? String(customerName).trim() : null,
            customerPhone: customerPhone ? String(customerPhone).trim() : null,
            saleTime: saleTime ? new Date(saleTime) : new Date(),
            items: {
              create: validatedItems.map(item => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
              })),
            },
          },
          include: {
            event: true,
            member: true,
            items: {
              include: {
                product: { include: { project: true } },
              },
            },
          },
        });
      });

      const totalUnits = validatedItems.reduce((sum, i) => sum + i.quantity, 0);

      // WebSocket broadcasts
      broadcast('sale:created', {
        id: newSale.id,
        eventId: newSale.eventId,
        eventName: newSale.event.name,
        totalAmount: Number(newSale.totalAmount),
        paymentMethod: newSale.paymentMethod,
        memberName: newSale.member.name,
        saleTime: newSale.saleTime,
        itemsCount: newSale.items.length,
        totalUnits,
      });

      broadcast('inventory:updated', {
        action: 'sales_recorded',
        eventId,
        saleId: newSale.id,
      });

      const formatted = {
        id: newSale.id,
        clientTxId: newSale.clientTxId,
        eventId: newSale.eventId,
        eventName: newSale.event.name,
        totalAmount: Number(newSale.totalAmount),
        paymentMethod: newSale.paymentMethod,
        customerName: newSale.customerName,
        customerPhone: newSale.customerPhone,
        saleTime: newSale.saleTime,
        createdAt: newSale.createdAt,
        items: newSale.items.map(item => ({
          id: item.id,
          productId: item.productId,
          productName: item.product.name,
          projectName: item.product.project.name,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal),
        })),
        totalUnits,
        totalOrderAmount: grandTotal,
      };

      res.status(201).json({
        message: 'Customer transaction recorded successfully',
        sale: sanitizeSaleForUser(formatted, req.user),
        totalItems: totalUnits,
        totalOrderAmount: grandTotal,
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
    const { sales, transactions } = req.body;
    const rawList = Array.isArray(transactions) && transactions.length > 0
      ? transactions
      : Array.isArray(sales)
      ? sales
      : [];

    if (rawList.length === 0) {
      res.status(400).json({ error: 'Transactions or sales array is required' });
      return;
    }

    try {
      const results: any[] = [];
      let syncedCount = 0;

      for (const txData of rawList) {
        const {
          clientTxId,
          eventId,
          items,
          productId,
          quantity,
          unitPrice: clientUnitPrice,
          paymentMethod,
          customerName,
          customerPhone,
          saleTime,
        } = txData;

        // 1. Idempotency check
        if (clientTxId) {
          const existing = await prisma.sale.findUnique({
            where: { clientTxId: String(clientTxId) },
          });
          if (existing) {
            results.push({ clientTxId, status: 'already_synced', saleId: existing.id });
            continue;
          }
        }

        // 2. Normalize items
        const itemMap = new Map<string, number>();
        if (Array.isArray(items) && items.length > 0) {
          for (const item of items) {
            const pId = String(item.productId || '');
            const q = parseInt(String(item.quantity || 0), 10);
            if (pId && !isNaN(q) && q > 0) {
              itemMap.set(pId, (itemMap.get(pId) || 0) + q);
            }
          }
        } else if (productId && quantity) {
          const pId = String(productId);
          const q = parseInt(String(quantity), 10);
          if (pId && !isNaN(q) && q > 0) {
            itemMap.set(pId, q);
          }
        }

        if (!eventId || itemMap.size === 0) {
          results.push({ clientTxId, status: 'failed', error: 'Missing event or items' });
          continue;
        }

        // 3. Fetch event allocations
        const event = await prisma.event.findUnique({
          where: { id: eventId },
          include: { allocations: true },
        });

        if (!event || event.isDeleted) {
          results.push({ clientTxId, status: 'failed', error: 'Event not found or inactive' });
          continue;
        }

        const validatedItems: Array<{
          productId: string;
          quantity: number;
          unitPrice: number;
          lineTotal: number;
        }> = [];

        let allocError: string | null = null;
        for (const [pId, qty] of itemMap.entries()) {
          const alloc = event.allocations.find(a => a.productId === pId);
          if (!alloc) {
            allocError = `Product ${pId} not allocated to event`;
            break;
          }
          const price = Number(alloc.priceAtEvent || clientUnitPrice || 0);
          validatedItems.push({
            productId: pId,
            quantity: qty,
            unitPrice: price,
            lineTotal: price * qty,
          });
        }

        if (allocError) {
          results.push({ clientTxId, status: 'failed', error: allocError });
          continue;
        }

        const grandTotal = validatedItems.reduce((sum, i) => sum + i.lineTotal, 0);
        const normMethod = paymentMethod === 'UPI' ? PaymentMethod.UPI : PaymentMethod.CASH;

        // 4. Create single transaction record with items
        const created = await prisma.sale.create({
          data: {
            clientTxId: clientTxId ? String(clientTxId) : null,
            eventId,
            memberId: req.user!.id,
            totalAmount: grandTotal,
            paymentMethod: normMethod,
            customerName: customerName ? String(customerName).trim() : null,
            customerPhone: customerPhone ? String(customerPhone).trim() : null,
            saleTime: saleTime ? new Date(saleTime) : new Date(),
            items: {
              create: validatedItems.map(item => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
              })),
            },
          },
        });

        syncedCount++;
        results.push({ clientTxId, status: 'success', saleId: created.id });

        broadcast('sale:created', {
          id: created.id,
          eventId: created.eventId,
          totalAmount: Number(created.totalAmount),
          saleTime: created.saleTime,
        });
      }

      if (syncedCount > 0) {
        broadcast('inventory:updated', { action: 'offline_sync_completed', count: syncedCount });
      }

      res.json({
        message: `Successfully processed sync for ${rawList.length} transaction(s) (${syncedCount} newly recorded)`,
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
          items: {
            include: {
              product: { include: { project: true } },
            },
          },
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

      const effectiveQty = updateData.quantity !== undefined ? updateData.quantity : (existing.quantity || 1);
      const effectivePrice = updateData.unitPrice !== undefined ? updateData.unitPrice : Number(existing.unitPrice || 0);
      if (updateData.quantity !== undefined || updateData.unitPrice !== undefined) {
        updateData.totalAmount = effectiveQty * effectivePrice;
      }

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
          items: {
            include: {
              product: { include: { project: true } },
            },
          },
        },
      });

      broadcast('inventory:updated', { action: 'sale_updated', id });

      const rawItems = (updated.items && updated.items.length > 0)
        ? updated.items.map(item => ({
            id: item.id,
            productId: item.productId,
            productName: item.product?.name || item.productId,
            projectId: item.product?.project?.id || '',
            projectName: item.product?.project?.name || '',
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            lineTotal: Number(item.lineTotal),
          }))
        : updated.productId
        ? [{
            id: updated.id,
            productId: updated.productId,
            productName: updated.product?.name || updated.productId,
            projectId: updated.product?.project?.id || '',
            projectName: updated.product?.project?.name || '',
            quantity: updated.quantity || 1,
            unitPrice: Number(updated.unitPrice || 0),
            lineTotal: Number(updated.totalAmount || 0),
          }]
        : [];

      const totalUnits = rawItems.reduce((sum, item) => sum + item.quantity, 0) || updated.quantity || 0;
      const uniqueProjects = Array.from(new Set(rawItems.map(item => item.projectName).filter(Boolean)));
      const primaryProject = uniqueProjects.length > 0 ? uniqueProjects.join(' + ') : (updated.product?.project?.name || 'Multiple');
      const productSummary = rawItems.map(item => `${item.productName} × ${item.quantity}`).join(', ') || updated.product?.name || 'No Products';

      const firstItem = rawItems[0] || {};

      const formatted = {
        id: updated.id,
        clientTxId: updated.clientTxId,
        eventId: updated.eventId,
        eventName: updated.event.name,
        productId: firstItem.productId || updated.productId || '',
        productName: productSummary,
        projectId: firstItem.projectId || updated.product?.project?.id || '',
        projectName: primaryProject,
        projectNames: uniqueProjects,
        memberId: updated.memberId,
        memberName: updated.member.name,
        memberUsername: updated.member.username,
        memberDepartment: updated.member.department,
        items: rawItems,
        totalUnits,
        quantity: totalUnits,
        unitPrice: Number(firstItem.unitPrice ?? updated.unitPrice ?? 0),
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

