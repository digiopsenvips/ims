import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { sanitizeSaleForUser, sanitizeSalesListForUser } from '../middleware/piiSanitizer';
import { requireRoles } from '../middleware/rbac';
import { broadcast } from '../sockets';
import { PaymentMethod, Role, Prisma, TransactionType } from '@prisma/client';
import { computeEventStatus, reconcileSingleEvent } from '../services/eventLifecycle';

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
      transactionType,
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
        const memId = String(memberId);
        const memberCond = [
          { memberId: memId },
          { sellerUserIdAtSale: memId },
        ];
        whereClause.AND = whereClause.AND ? [...whereClause.AND, { OR: memberCond }] : [{ OR: memberCond }];
      }
      if (paymentMethod && (paymentMethod === 'CASH' || paymentMethod === 'UPI' || paymentMethod === 'CASH_UPI')) {
        whereClause.paymentMethod = paymentMethod as PaymentMethod;
      }
      if (transactionType && (transactionType === 'SALE' || transactionType === 'GAME' || transactionType === 'COMBO')) {
        whereClause.transactionType = transactionType as TransactionType;
      }
      if (startDate || endDate) {
        whereClause.saleTime = {};
        if (startDate) whereClause.saleTime.gte = new Date(String(startDate));
        if (endDate) whereClause.saleTime.lte = new Date(String(endDate));
      }

      // If user is MEMBER, they can only view sales they recorded
      if (req.user?.role === Role.MEMBER) {
        const memberCond = [
          { memberId: req.user.id },
          { sellerUserIdAtSale: req.user.id },
        ];
        whereClause.AND = whereClause.AND ? [...whereClause.AND, { OR: memberCond }] : [{ OR: memberCond }];
      }

      // Server-side search filter across product, project, member, event, customer, game, combo, and ID
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
          { sellerNameAtSale: { contains: term, mode: 'insensitive' } },
          { sellerUsernameAtSale: { contains: term, mode: 'insensitive' } },
          { event: { name: { contains: term, mode: 'insensitive' } } },
          { customerName: { contains: term, mode: 'insensitive' } },
          { customerPhone: { contains: term, mode: 'insensitive' } },
          { game: { name: { contains: term, mode: 'insensitive' } } },
          { gameSession: { sessionCode: { contains: term, mode: 'insensitive' } } },
          { comboName: { contains: term, mode: 'insensitive' } },
          { combo: { name: { contains: term, mode: 'insensitive' } } },
        ];
        const num = parseInt(term.replace(/^#/, ''), 10);
        if (!isNaN(num)) {
          searchConditions.push({ receiptNumber: num });
          searchConditions.push({ id: num });
        }
        whereClause.AND = whereClause.AND ? [...whereClause.AND, { OR: searchConditions }] : [{ OR: searchConditions }];
      }

      const isAll = all === 'true' || all === '1';
      const page = Math.max(1, parseInt(String(rawPage || '1'), 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(String(rawPageSize || '10'), 10) || 10));
      const skip = isAll ? undefined : (page - 1) * pageSize;
      const take = isAll ? undefined : pageSize;

      // Deterministic reverse chronological ordering: NEWEST first (highest canonical receiptNumber is newest sale)
      const orderBy = [
        { receiptNumber: 'desc' as const },
        { saleTime: 'desc' as const },
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
            game: {
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
            gameSession: {
              include: {
                rewardProduct: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
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
            combo: {
              select: {
                id: true,
                name: true,
                comboType: true,
                price: true,
                projectId: true,
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

      // Format and sanitize for permissions using canonical stored receiptNumber
      const formatted = sales.map((s) => {
        const canonicalReceiptNumber = s.receiptNumber ?? s.id;

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

        const isGame = s.transactionType === 'GAME';
        const isCombo = s.transactionType === 'COMBO' || Boolean(s.comboId);
        const displayProductName = isGame
          ? (s.game?.name || 'Stall Game')
          : isCombo
          ? (s.comboName || s.combo?.name || 'Combo Bundle')
          : productSummary;
        const displayProjectName = isGame
          ? (s.game?.project?.name || 'Upcycle')
          : isCombo
          ? (s.combo?.project?.name || primaryProject)
          : primaryProject;

        const firstItem = rawItems[0] || {};

        return {
          id: s.id, // Internal database ID
          receiptNumber: canonicalReceiptNumber, // Canonical sequential receipt number (#1, #2, #3...)
          serialNumber: canonicalReceiptNumber, // Backward compatibility alias
          transactionType: s.transactionType || (s.comboId ? 'COMBO' : 'SALE'),
          comboId: s.comboId || null,
          comboName: s.comboName || s.combo?.name || null,
          combo: s.combo
            ? {
                id: s.combo.id,
                name: s.combo.name,
                type: s.combo.comboType,
                price: Number(s.combo.price),
              }
            : null,
          gameId: s.gameId || null,
          gameName: s.game?.name || null,
          gameSession: s.gameSession
            ? {
                sessionCode: s.gameSession.sessionCode,
                result: s.gameSession.result,
                rewardProductName: s.gameSession.rewardProduct?.name || 'Reward',
                rewardQuantity: s.gameSession.rewardQuantity,
                rewardDescription: `${s.gameSession.rewardProduct?.name || 'Reward'} × ${s.gameSession.rewardQuantity}`,
              }
            : null,
          clientTxId: s.clientTxId,
          eventId: s.eventId,
          eventName: s.event.name,
          productId: isGame ? (s.gameId || '') : (firstItem.productId || s.productId || ''),
          productName: displayProductName,
          description: displayProductName,
          projectId: isGame ? (s.game?.projectId || '') : (firstItem.projectId || s.product?.project?.id || ''),
          projectName: displayProjectName,
          projectNames: isGame ? [displayProjectName] : uniqueProjects,
          memberId: s.sellerUserIdAtSale || s.memberId || '',
          memberName: s.sellerNameAtSale || s.member?.name || 'Unknown Member',
          memberUsername: s.sellerUsernameAtSale || s.member?.username || '',
          memberDepartment: s.member?.department || null,
          sellerUserIdAtSale: s.sellerUserIdAtSale || s.memberId || undefined,
          sellerUsernameAtSale: s.sellerUsernameAtSale || s.member?.username || undefined,
          sellerNameAtSale: s.sellerNameAtSale || s.member?.name || undefined,
          items: rawItems,
          totalUnits,
          quantity: totalUnits, // alias for totalUnits
          unitPrice: Number(firstItem.unitPrice ?? s.unitPrice ?? 0),
          totalAmount: Number(s.totalAmount),
          paymentMethod: s.paymentMethod,
          cashAmount: s.cashAmount !== null && s.cashAmount !== undefined
            ? Number(s.cashAmount)
            : s.paymentMethod === 'CASH'
            ? Number(s.totalAmount)
            : 0,
          upiAmount: s.upiAmount !== null && s.upiAmount !== undefined
            ? Number(s.upiAmount)
            : s.paymentMethod === 'UPI'
            ? Number(s.totalAmount)
            : 0,
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
      comboId,
      comboQuantity,
      selectedItems,
      transactionType,
      paymentMethod,
      cashAmount,
      upiAmount,
      customerName,
      customerPhone,
      clientTxId,
      saleTime,
    } = req.body;

    // Handle combo sales atomically
    if (comboId || transactionType === 'COMBO') {
      const targetComboId = String(comboId || '');
      if (!targetComboId) {
        res.status(400).json({ error: 'comboId is required for COMBO transaction' });
        return;
      }
      if (!eventId || !paymentMethod) {
        res.status(400).json({ error: 'eventId and paymentMethod are required' });
        return;
      }

      const comboQty = Math.max(1, parseInt(String(comboQuantity || 1), 10) || 1);

      try {
        // 1. Fetch combo with items & project
        const combo = await prisma.combo.findUnique({
          where: { id: targetComboId },
          include: {
            items: {
              include: {
                product: {
                  include: { project: true },
                },
              },
            },
            project: true,
          },
        });

        if (!combo || combo.isArchived || combo.status !== 'ACTIVE') {
          res.status(404).json({ error: 'Combo not found, archived, or inactive' });
          return;
        }

        if (combo.eventId && combo.eventId !== eventId) {
          res.status(400).json({ error: 'This combo offer is not valid for the selected event' });
          return;
        }

        // 2. Validate event
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

        const eventStatus = computeEventStatus(event.startDatetime, event.endDatetime, event.status);
        const isPastEnd = new Date().getTime() >= new Date(event.endDatetime).getTime();

        if (eventStatus === 'ENDED' || event.status === 'ENDED' || isPastEnd) {
          if (!event.reconciledAt) {
            reconcileSingleEvent(event.id).catch(err =>
              console.error('Failed to reconcile ended event on sale:', err)
            );
          }
          res.status(400).json({ error: 'This event has ended and is no longer accepting sales.' });
          return;
        }

        if (eventStatus === 'UPCOMING' || new Date().getTime() < new Date(event.startDatetime).getTime()) {
          res.status(400).json({ error: 'This event has not started yet.' });
          return;
        }

        // 3. Resolve required components
        interface ResolvedComp {
          productId: string;
          productName: string;
          projectName: string;
          quantity: number;
          allocationPrice: number;
        }

        const resolvedComponents: ResolvedComp[] = [];

        if (combo.comboType === 'PICK_ANY') {
          const rawSelected = Array.isArray(selectedItems) ? selectedItems : (Array.isArray(items) ? items : []);
          const mergedSelected = new Map<string, number>();
          for (const item of rawSelected) {
            const pId = String(item.productId || '');
            const q = parseInt(String(item.quantity || 0), 10);
            if (pId && !isNaN(q) && q > 0) {
              mergedSelected.set(pId, (mergedSelected.get(pId) || 0) + q);
            }
          }

          const totalSelected = Array.from(mergedSelected.values()).reduce((sum, q) => sum + q, 0);
          const minItemsPerCombo = combo.minItems || 1;
          const requiredTotal = minItemsPerCombo * comboQty;
          if (totalSelected !== requiredTotal) {
            res.status(400).json({
              error: `For this combo, you must select exactly ${requiredTotal} items (${minItemsPerCombo} per combo bundle). Selected: ${totalSelected}`,
            });
            return;
          }

          const allowedProductIds = combo.items.length > 0 ? new Set(combo.items.map(ci => ci.productId)) : null;

          for (const [pId, qty] of mergedSelected.entries()) {
            if (allowedProductIds && !allowedProductIds.has(pId)) {
              res.status(400).json({ error: `Product ${pId} is not in the allowed items for this combo offer.` });
              return;
            }
            const alloc = event.allocations.find(a => a.productId === pId);
            if (!alloc) {
              res.status(400).json({ error: `Product ${pId} is not allocated to this event.` });
              return;
            }
            resolvedComponents.push({
              productId: pId,
              productName: alloc.product.name,
              projectName: alloc.product.project.name,
              quantity: qty,
              allocationPrice: Number(alloc.priceAtEvent),
            });
          }
        } else {
          // FIXED_QUANTITY, MULTI_PRODUCT, BUY_X_GET_Y
          for (const ci of combo.items) {
            const neededQty = ci.quantity * comboQty;
            const alloc = event.allocations.find(a => a.productId === ci.productId);
            if (!alloc) {
              res.status(400).json({ error: `Combo component product ${ci.product.name} (${ci.productId}) is not allocated to this event.` });
              return;
            }
            resolvedComponents.push({
              productId: ci.productId,
              productName: ci.product.name,
              projectName: ci.product.project.name,
              quantity: neededQty,
              allocationPrice: Number(alloc.priceAtEvent),
            });
          }
        }

        // 4. Validate stock for each component
        for (const comp of resolvedComponents) {
          const salesAgg = await prisma.saleItem.aggregate({
            where: {
              productId: comp.productId,
              sale: { eventId },
            },
            _sum: { quantity: true },
          });
          const soldSoFar = salesAgg._sum.quantity || 0;
          const allocation = event.allocations.find(a => a.productId === comp.productId)!;
          const remainingAllocated = allocation.allocatedQty - soldSoFar;

          if (comp.quantity > remainingAllocated) {
            res.status(400).json({
              error: `Insufficient stock for combo component ${comp.productName}. Only ${remainingAllocated} remaining (${comp.quantity} required).`,
              productId: comp.productId,
              remainingAllocated,
            });
            return;
          }
        }

        // 5. Calculate bundle pricing and line totals
        const comboPriceTotal = Number(combo.price) * comboQty;
        const totalUnits = resolvedComponents.reduce((sum, c) => sum + c.quantity, 0);

        // Distribute comboPriceTotal across component items proportionally based on normal value
        const totalNormalValue = resolvedComponents.reduce((sum, c) => sum + (c.allocationPrice * c.quantity), 0);

        let allocatedCents = 0;
        const totalCents = Math.round(comboPriceTotal * 100);

        const validatedItems = resolvedComponents.map((comp, idx) => {
          let lineTotalCents: number;
          if (idx === resolvedComponents.length - 1) {
            lineTotalCents = totalCents - allocatedCents;
          } else {
            const ratio = totalNormalValue > 0 ? (comp.allocationPrice * comp.quantity) / totalNormalValue : comp.quantity / totalUnits;
            lineTotalCents = Math.round(totalCents * ratio);
            allocatedCents += lineTotalCents;
          }
          const lineTotal = lineTotalCents / 100;
          const unitPrice = Math.round((lineTotal / comp.quantity) * 100) / 100;
          return {
            productId: comp.productId,
            productName: comp.productName,
            projectName: comp.projectName,
            quantity: comp.quantity,
            unitPrice,
            lineTotal,
          };
        });

        // 6. Payment method normalization
        let normMethod: PaymentMethod;
        const rawMethod = String(paymentMethod || '').toUpperCase().replace(/[\s\+]/g, '_');
        if (rawMethod === 'CASH') {
          normMethod = PaymentMethod.CASH;
        } else if (rawMethod === 'UPI') {
          normMethod = PaymentMethod.UPI;
        } else if (rawMethod === 'CASH_UPI' || rawMethod === 'CASH_AND_UPI' || rawMethod === 'SPLIT') {
          normMethod = PaymentMethod.CASH_UPI;
        } else {
          res.status(400).json({ error: 'Payment method must be CASH, UPI, or CASH + UPI' });
          return;
        }

        let resolvedCashAmount: number;
        let resolvedUpiAmount: number;

        if (normMethod === PaymentMethod.CASH_UPI) {
          const cashVal = parseFloat(String(cashAmount ?? ''));
          const upiVal = parseFloat(String(upiAmount ?? ''));

          if (isNaN(cashVal) || isNaN(upiVal) || cashVal < 0 || upiVal < 0) {
            res.status(400).json({
              error: 'Cash and UPI amounts must be non-negative numbers for split payment',
            });
            return;
          }

          const totalSplitCents = Math.round((cashVal + upiVal) * 100);
          if (totalSplitCents !== totalCents) {
            res.status(400).json({
              error: `Split payment total (₹${(totalSplitCents / 100).toFixed(2)}) must exactly match combo total (₹${comboPriceTotal.toFixed(2)})`,
              cashAmount: cashVal,
              upiAmount: upiVal,
              billTotal: comboPriceTotal,
            });
            return;
          }

          resolvedCashAmount = Math.round(cashVal * 100) / 100;
          resolvedUpiAmount = Math.round(upiVal * 100) / 100;
        } else if (normMethod === PaymentMethod.CASH) {
          resolvedCashAmount = comboPriceTotal;
          resolvedUpiAmount = 0;
        } else {
          resolvedCashAmount = 0;
          resolvedUpiAmount = comboPriceTotal;
        }

        // 7. Atomic transaction: allocate receipt number and record sale
        const newSale = await prisma.$transaction(async tx => {
          if (clientTxId) {
            const existing = await tx.sale.findUnique({
              where: { clientTxId: String(clientTxId) },
              include: {
                event: true,
                member: true,
                combo: true,
                items: {
                  include: { product: { include: { project: true } } },
                },
              },
            });
            if (existing) return existing;
          }

          const [{ nextVal }] = await tx.$queryRaw<[{ nextVal: bigint | number }]>`
            SELECT nextval('receipt_number_seq')::bigint as "nextVal"
          `;
          const receiptNumber = Number(nextVal);

          return await tx.sale.create({
            data: {
              receiptNumber,
              clientTxId: clientTxId ? String(clientTxId) : null,
              eventId,
              memberId: req.user!.id,
              sellerUserIdAtSale: req.user!.id,
              sellerUsernameAtSale: req.user!.username,
              sellerNameAtSale: req.user!.name,
              transactionType: TransactionType.COMBO,
              comboId: combo.id,
              comboName: combo.name,
              totalAmount: comboPriceTotal,
              paymentMethod: normMethod,
              cashAmount: resolvedCashAmount,
              upiAmount: resolvedUpiAmount,
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
              combo: true,
              items: {
                include: { product: { include: { project: true } } },
              },
            },
          });
        });

        // 8. WebSocket broadcasts
        broadcast('sale:created', {
          id: newSale.id,
          receiptNumber: newSale.receiptNumber,
          serialNumber: newSale.receiptNumber,
          eventId: newSale.eventId,
          eventName: newSale.event.name,
          totalAmount: Number(newSale.totalAmount),
          paymentMethod: newSale.paymentMethod,
          cashAmount: Number(newSale.cashAmount ?? resolvedCashAmount),
          upiAmount: Number(newSale.upiAmount ?? resolvedUpiAmount),
          memberName: newSale.sellerNameAtSale || newSale.member?.name || req.user!.name,
          memberUsername: newSale.sellerUsernameAtSale || newSale.member?.username || req.user!.username,
          saleTime: newSale.saleTime,
          itemsCount: newSale.items.length,
          totalUnits,
          transactionType: 'COMBO',
          comboName: newSale.comboName,
        });

        broadcast('inventory:updated', {
          action: 'sales_recorded',
          eventId,
          saleId: newSale.id,
        });

        broadcast('combo:sold', {
          comboId: combo.id,
          eventId,
          receiptNumber: newSale.receiptNumber,
        });

        const formatted = {
          id: newSale.id,
          receiptNumber: newSale.receiptNumber,
          serialNumber: newSale.receiptNumber,
          clientTxId: newSale.clientTxId,
          eventId: newSale.eventId,
          eventName: newSale.event.name,
          transactionType: 'COMBO',
          comboId: newSale.comboId,
          comboName: newSale.comboName,
          productName: newSale.comboName || 'Combo Offer',
          description: newSale.comboName || 'Combo Offer',
          projectName: newSale.combo?.projectId ? combo.project?.name : 'Multiple',
          totalAmount: Number(newSale.totalAmount),
          paymentMethod: newSale.paymentMethod,
          cashAmount: Number(newSale.cashAmount ?? resolvedCashAmount),
          upiAmount: Number(newSale.upiAmount ?? resolvedUpiAmount),
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
          totalOrderAmount: comboPriceTotal,
        };

        res.status(201).json({
          message: 'Combo transaction recorded successfully',
          sale: sanitizeSaleForUser(formatted, req.user),
          totalItems: totalUnits,
          totalOrderAmount: comboPriceTotal,
        });
        return;
      } catch (err) {
        console.error('Combo sale error:', err);
        res.status(500).json({ error: 'Failed to record combo transaction' });
        return;
      }
    }

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

    let normMethod: PaymentMethod;
    const rawMethod = String(paymentMethod || '').toUpperCase().replace(/[\s\+]/g, '_');
    if (rawMethod === 'CASH') {
      normMethod = PaymentMethod.CASH;
    } else if (rawMethod === 'UPI') {
      normMethod = PaymentMethod.UPI;
    } else if (rawMethod === 'CASH_UPI' || rawMethod === 'CASH_AND_UPI' || rawMethod === 'SPLIT') {
      normMethod = PaymentMethod.CASH_UPI;
    } else {
      res.status(400).json({ error: 'Payment method must be CASH, UPI, or CASH + UPI' });
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

      const eventStatus = computeEventStatus(event.startDatetime, event.endDatetime, event.status);
      const isPastEnd = new Date().getTime() >= new Date(event.endDatetime).getTime();

      if (eventStatus === 'ENDED' || event.status === 'ENDED' || isPastEnd) {
        if (!event.reconciledAt) {
          reconcileSingleEvent(event.id).catch(err =>
            console.error('Failed to reconcile ended event on sale:', err)
          );
        }
        res.status(400).json({ error: 'This event has ended and is no longer accepting sales.' });
        return;
      }

      if (eventStatus === 'UPCOMING' || new Date().getTime() < new Date(event.startDatetime).getTime()) {
        res.status(400).json({ error: 'This event has not started yet.' });
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

      // Validate payment method amounts
      let resolvedCashAmount: number;
      let resolvedUpiAmount: number;

      if (normMethod === PaymentMethod.CASH_UPI) {
        const cashVal = parseFloat(String(cashAmount ?? ''));
        const upiVal = parseFloat(String(upiAmount ?? ''));

        if (isNaN(cashVal) || isNaN(upiVal) || cashVal < 0 || upiVal < 0) {
          res.status(400).json({
            error: 'Cash and UPI amounts must be non-negative numbers for split payment',
          });
          return;
        }

        const totalSplitCents = Math.round((cashVal + upiVal) * 100);
        const grandTotalCents = Math.round(grandTotal * 100);

        if (totalSplitCents !== grandTotalCents) {
          res.status(400).json({
            error: `Split payment total (₹${(totalSplitCents / 100).toFixed(2)}) must exactly match bill total (₹${(grandTotalCents / 100).toFixed(2)})`,
            cashAmount: cashVal,
            upiAmount: upiVal,
            billTotal: grandTotalCents / 100,
          });
          return;
        }

        resolvedCashAmount = Math.round(cashVal * 100) / 100;
        resolvedUpiAmount = Math.round(upiVal * 100) / 100;
      } else if (normMethod === PaymentMethod.CASH) {
        resolvedCashAmount = grandTotal;
        resolvedUpiAmount = 0;
      } else {
        resolvedCashAmount = 0;
        resolvedUpiAmount = grandTotal;
      }

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

        // Atomically allocate next canonical sequential receipt number from Postgres sequence
        const [{ nextVal }] = await tx.$queryRaw<[{ nextVal: bigint | number }]>`
          SELECT nextval('receipt_number_seq')::bigint as "nextVal"
        `;
        const receiptNumber = Number(nextVal);

        return await tx.sale.create({
          data: {
            receiptNumber,
            clientTxId: clientTxId ? String(clientTxId) : null,
            eventId,
            memberId: req.user!.id,
            sellerUserIdAtSale: req.user!.id,
            sellerUsernameAtSale: req.user!.username,
            sellerNameAtSale: req.user!.name,
            totalAmount: grandTotal,
            paymentMethod: normMethod,
            cashAmount: resolvedCashAmount,
            upiAmount: resolvedUpiAmount,
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
        receiptNumber: newSale.receiptNumber,
        serialNumber: newSale.receiptNumber,
        eventId: newSale.eventId,
        eventName: newSale.event.name,
        totalAmount: Number(newSale.totalAmount),
        paymentMethod: newSale.paymentMethod,
        cashAmount: Number(newSale.cashAmount ?? resolvedCashAmount),
        upiAmount: Number(newSale.upiAmount ?? resolvedUpiAmount),
        memberName: newSale.sellerNameAtSale || newSale.member?.name || req.user!.name,
        memberUsername: newSale.sellerUsernameAtSale || newSale.member?.username || req.user!.username,
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
        receiptNumber: newSale.receiptNumber,
        serialNumber: newSale.receiptNumber,
        clientTxId: newSale.clientTxId,
        eventId: newSale.eventId,
        eventName: newSale.event.name,
        totalAmount: Number(newSale.totalAmount),
        paymentMethod: newSale.paymentMethod,
        cashAmount: Number(newSale.cashAmount ?? resolvedCashAmount),
        upiAmount: Number(newSale.upiAmount ?? resolvedUpiAmount),
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
          cashAmount,
          upiAmount,
          customerName,
          customerPhone,
          saleTime,
          comboId,
          comboQuantity,
          selectedItems,
          transactionType,
        } = txData;

        // 1. Idempotency check
        if (clientTxId) {
          const existing = await prisma.sale.findUnique({
            where: { clientTxId: String(clientTxId) },
          });
          if (existing) {
            results.push({
              clientTxId,
              status: 'already_synced',
              saleId: existing.id,
              receiptNumber: existing.receiptNumber,
            });
            continue;
          }
        }

        // Combo transaction sync branch
        if (comboId || transactionType === 'COMBO') {
          const targetComboId = String(comboId || '');
          if (!targetComboId || !eventId) {
            results.push({ clientTxId, status: 'failed', error: 'Missing comboId or eventId' });
            continue;
          }

          const comboQty = Math.max(1, parseInt(String(comboQuantity || 1), 10) || 1);
          const combo = await prisma.combo.findUnique({
            where: { id: targetComboId },
            include: {
              items: {
                include: { product: { include: { project: true } } },
              },
              project: true,
            },
          });

          if (!combo || combo.isArchived || combo.status !== 'ACTIVE') {
            results.push({ clientTxId, status: 'failed', error: 'Combo not found, archived, or inactive' });
            continue;
          }

          const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: { allocations: { include: { product: { include: { project: true } } } } },
          });

          if (!event || event.isDeleted) {
            results.push({ clientTxId, status: 'failed', error: 'Event not found or inactive' });
            continue;
          }

          interface ResolvedSyncComp {
            productId: string;
            quantity: number;
            allocationPrice: number;
          }
          const resolvedComponents: ResolvedSyncComp[] = [];

          if (combo.comboType === 'PICK_ANY') {
            const rawSelected = Array.isArray(selectedItems) ? selectedItems : (Array.isArray(items) ? items : []);
            const mergedSelected = new Map<string, number>();
            for (const item of rawSelected) {
              const pId = String(item.productId || '');
              const q = parseInt(String(item.quantity || 0), 10);
              if (pId && !isNaN(q) && q > 0) {
                mergedSelected.set(pId, (mergedSelected.get(pId) || 0) + q);
              }
            }

            const totalSelected = Array.from(mergedSelected.values()).reduce((sum, q) => sum + q, 0);
            const minItemsPerCombo = combo.minItems || 1;
            const requiredTotal = minItemsPerCombo * comboQty;
            if (totalSelected !== requiredTotal) {
              results.push({ clientTxId, status: 'failed', error: `Select exactly ${requiredTotal} items for combo` });
              continue;
            }

            for (const [pId, qty] of mergedSelected.entries()) {
              const alloc = event.allocations.find(a => a.productId === pId);
              if (!alloc) {
                results.push({ clientTxId, status: 'failed', error: `Product ${pId} not allocated` });
                continue;
              }
              resolvedComponents.push({
                productId: pId,
                quantity: qty,
                allocationPrice: Number(alloc.priceAtEvent),
              });
            }
          } else {
            for (const ci of combo.items) {
              const alloc = event.allocations.find(a => a.productId === ci.productId);
              if (!alloc) {
                results.push({ clientTxId, status: 'failed', error: `Component ${ci.productId} not allocated` });
                continue;
              }
              resolvedComponents.push({
                productId: ci.productId,
                quantity: ci.quantity * comboQty,
                allocationPrice: Number(alloc.priceAtEvent),
              });
            }
          }

          const comboPriceTotal = Number(combo.price) * comboQty;
          const totalUnits = resolvedComponents.reduce((sum, c) => sum + c.quantity, 0);
          const totalNormalValue = resolvedComponents.reduce((sum, c) => sum + (c.allocationPrice * c.quantity), 0);

          let allocatedCents = 0;
          const totalCents = Math.round(comboPriceTotal * 100);

          const validatedItems = resolvedComponents.map((comp, idx) => {
            let lineTotalCents: number;
            if (idx === resolvedComponents.length - 1) {
              lineTotalCents = totalCents - allocatedCents;
            } else {
              const ratio = totalNormalValue > 0 ? (comp.allocationPrice * comp.quantity) / totalNormalValue : comp.quantity / totalUnits;
              lineTotalCents = Math.round(totalCents * ratio);
              allocatedCents += lineTotalCents;
            }
            const lineTotal = lineTotalCents / 100;
            const unitPrice = Math.round((lineTotal / comp.quantity) * 100) / 100;
            return {
              productId: comp.productId,
              quantity: comp.quantity,
              unitPrice,
              lineTotal,
            };
          });

          const rawMethod = String(paymentMethod || '').toUpperCase().replace(/[\s\+]/g, '_');
          let normMethod: PaymentMethod;
          if (rawMethod === 'CASH') {
            normMethod = PaymentMethod.CASH;
          } else if (rawMethod === 'CASH_UPI' || rawMethod === 'CASH_AND_UPI' || rawMethod === 'SPLIT') {
            normMethod = PaymentMethod.CASH_UPI;
          } else {
            normMethod = PaymentMethod.UPI;
          }

          let resolvedCashAmount: number;
          let resolvedUpiAmount: number;

          if (normMethod === PaymentMethod.CASH_UPI) {
            const cashVal = parseFloat(String(cashAmount ?? ''));
            const upiVal = parseFloat(String(upiAmount ?? ''));
            if (!isNaN(cashVal) && !isNaN(upiVal) && cashVal >= 0 && upiVal >= 0) {
              resolvedCashAmount = Math.round(cashVal * 100) / 100;
              resolvedUpiAmount = Math.round(upiVal * 100) / 100;
            } else {
              resolvedCashAmount = Math.round((comboPriceTotal / 2) * 100) / 100;
              resolvedUpiAmount = Math.round((comboPriceTotal - resolvedCashAmount) * 100) / 100;
            }
          } else if (normMethod === PaymentMethod.CASH) {
            resolvedCashAmount = comboPriceTotal;
            resolvedUpiAmount = 0;
          } else {
            resolvedCashAmount = 0;
            resolvedUpiAmount = comboPriceTotal;
          }

          const [{ nextVal }] = await prisma.$queryRaw<[{ nextVal: bigint | number }]>`
            SELECT nextval('receipt_number_seq')::bigint as "nextVal"
          `;
          const receiptNumber = Number(nextVal);

          const createdComboSale = await prisma.sale.create({
            data: {
              receiptNumber,
              clientTxId: clientTxId ? String(clientTxId) : null,
              eventId,
              memberId: req.user!.id,
              sellerUserIdAtSale: req.user!.id,
              sellerUsernameAtSale: req.user!.username,
              sellerNameAtSale: req.user!.name,
              transactionType: TransactionType.COMBO,
              comboId: combo.id,
              comboName: combo.name,
              totalAmount: comboPriceTotal,
              paymentMethod: normMethod,
              cashAmount: resolvedCashAmount,
              upiAmount: resolvedUpiAmount,
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
          results.push({
            clientTxId,
            status: 'success',
            saleId: createdComboSale.id,
            receiptNumber: createdComboSale.receiptNumber,
          });

          broadcast('sale:created', {
            id: createdComboSale.id,
            receiptNumber: createdComboSale.receiptNumber,
            serialNumber: createdComboSale.receiptNumber,
            eventId: createdComboSale.eventId,
            eventName: event.name,
            totalAmount: Number(createdComboSale.totalAmount),
            paymentMethod: createdComboSale.paymentMethod,
            cashAmount: resolvedCashAmount,
            upiAmount: resolvedUpiAmount,
            memberName: req.user!.name,
            memberUsername: req.user!.username,
            saleTime: createdComboSale.saleTime,
            itemsCount: validatedItems.length,
            totalUnits,
            transactionType: 'COMBO',
            comboName: combo.name,
          });

          broadcast('inventory:updated', {
            action: 'sales_recorded',
            eventId,
            saleId: createdComboSale.id,
          });

          broadcast('combo:sold', {
            comboId: combo.id,
            eventId,
            receiptNumber: createdComboSale.receiptNumber,
          });

          continue;
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

        const eventStatus = computeEventStatus(event.startDatetime, event.endDatetime, event.status);
        const isPastEnd = new Date().getTime() >= new Date(event.endDatetime).getTime();

        if (eventStatus === 'ENDED' || event.status === 'ENDED' || isPastEnd) {
          if (!event.reconciledAt) {
            reconcileSingleEvent(event.id).catch(err =>
              console.error('Failed to reconcile ended event on sync:', err)
            );
          }
          results.push({
            clientTxId,
            status: 'failed',
            error: 'This event has ended and is no longer accepting sales.',
          });
          continue;
        }

        if (eventStatus === 'UPCOMING' || new Date().getTime() < new Date(event.startDatetime).getTime()) {
          results.push({ clientTxId, status: 'failed', error: 'This event has not started yet.' });
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
        const rawMethod = String(paymentMethod || '').toUpperCase().replace(/[\s\+]/g, '_');
        let normMethod: PaymentMethod;
        if (rawMethod === 'CASH') {
          normMethod = PaymentMethod.CASH;
        } else if (rawMethod === 'CASH_UPI' || rawMethod === 'CASH_AND_UPI' || rawMethod === 'SPLIT') {
          normMethod = PaymentMethod.CASH_UPI;
        } else {
          normMethod = PaymentMethod.UPI;
        }

        let resolvedCashAmount: number;
        let resolvedUpiAmount: number;

        if (normMethod === PaymentMethod.CASH_UPI) {
          const cashVal = parseFloat(String(cashAmount ?? ''));
          const upiVal = parseFloat(String(upiAmount ?? ''));
          if (!isNaN(cashVal) && !isNaN(upiVal) && cashVal >= 0 && upiVal >= 0) {
            resolvedCashAmount = Math.round(cashVal * 100) / 100;
            resolvedUpiAmount = Math.round(upiVal * 100) / 100;
          } else {
            resolvedCashAmount = Math.round((grandTotal / 2) * 100) / 100;
            resolvedUpiAmount = Math.round((grandTotal - resolvedCashAmount) * 100) / 100;
          }
        } else if (normMethod === PaymentMethod.CASH) {
          resolvedCashAmount = grandTotal;
          resolvedUpiAmount = 0;
        } else {
          resolvedCashAmount = 0;
          resolvedUpiAmount = grandTotal;
        }

        // 4. Atomically allocate next canonical sequential receipt number from Postgres sequence
        const [{ nextVal }] = await prisma.$queryRaw<[{ nextVal: bigint | number }]>`
          SELECT nextval('receipt_number_seq')::bigint as "nextVal"
        `;
        const receiptNumber = Number(nextVal);

        // Create single transaction record with items
        const created = await prisma.sale.create({
          data: {
            receiptNumber,
            clientTxId: clientTxId ? String(clientTxId) : null,
            eventId,
            memberId: req.user!.id,
            sellerUserIdAtSale: req.user!.id,
            sellerUsernameAtSale: req.user!.username,
            sellerNameAtSale: req.user!.name,
            totalAmount: grandTotal,
            paymentMethod: normMethod,
            cashAmount: resolvedCashAmount,
            upiAmount: resolvedUpiAmount,
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
        results.push({ clientTxId, status: 'success', saleId: created.id, receiptNumber: created.receiptNumber });

        broadcast('sale:created', {
          id: created.id,
          receiptNumber: created.receiptNumber,
          serialNumber: created.receiptNumber,
          eventId: created.eventId,
          eventName: event.name,
          totalAmount: Number(created.totalAmount),
          paymentMethod: created.paymentMethod,
          cashAmount: Number(created.cashAmount ?? resolvedCashAmount),
          upiAmount: Number(created.upiAmount ?? resolvedUpiAmount),
          memberName: req.user!.name,
          memberUsername: req.user!.username,
          saleTime: created.saleTime,
          itemsCount: validatedItems.length,
          totalUnits: validatedItems.reduce((sum, i) => sum + i.quantity, 0),
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

// DELETE /api/sales/purge-all: Purge all sales records and reset canonical receipt sequence (DEVELOPER ONLY)
router.delete(
  '/purge-all',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { count } = await prisma.$transaction(async tx => {
        await tx.gameSession.deleteMany({});
        await tx.saleItem.deleteMany({});
        const deleted = await tx.sale.deleteMany({});
        // Reset canonical receipt sequence and sales ID sequence to 1
        await tx.$executeRawUnsafe(`ALTER SEQUENCE receipt_number_seq RESTART WITH 1;`);
        await tx.$executeRawUnsafe(`ALTER SEQUENCE sales_id_seq RESTART WITH 1;`);
        return deleted;
      });

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
      cashAmount,
      upiAmount,
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
        const rawMethod = String(paymentMethod).toUpperCase().replace(/[\s\+]/g, '_');
        if (rawMethod === 'CASH') {
          updateData.paymentMethod = PaymentMethod.CASH;
          updateData.cashAmount = updateData.totalAmount !== undefined ? updateData.totalAmount : existing.totalAmount;
          updateData.upiAmount = 0;
        } else if (rawMethod === 'UPI') {
          updateData.paymentMethod = PaymentMethod.UPI;
          updateData.cashAmount = 0;
          updateData.upiAmount = updateData.totalAmount !== undefined ? updateData.totalAmount : existing.totalAmount;
        } else if (rawMethod === 'CASH_UPI' || rawMethod === 'CASH_AND_UPI' || rawMethod === 'SPLIT') {
          updateData.paymentMethod = PaymentMethod.CASH_UPI;
          if (cashAmount !== undefined && upiAmount !== undefined) {
            updateData.cashAmount = parseFloat(cashAmount);
            updateData.upiAmount = parseFloat(upiAmount);
          }
        } else {
          res.status(400).json({ error: 'Payment method must be CASH, UPI, or CASH + UPI' });
          return;
        }
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
        receiptNumber: updated.receiptNumber,
        serialNumber: updated.receiptNumber,
        clientTxId: updated.clientTxId,
        eventId: updated.eventId,
        eventName: updated.event.name,
        productId: firstItem.productId || updated.productId || '',
        productName: productSummary,
        projectId: firstItem.projectId || updated.product?.project?.id || '',
        projectName: primaryProject,
        projectNames: uniqueProjects,
        memberId: updated.sellerUserIdAtSale || updated.memberId || '',
        memberName: updated.sellerNameAtSale || updated.member?.name || 'Unknown Member',
        memberUsername: updated.sellerUsernameAtSale || updated.member?.username || '',
        memberDepartment: updated.member?.department || null,
        sellerUserIdAtSale: updated.sellerUserIdAtSale || updated.memberId || undefined,
        sellerUsernameAtSale: updated.sellerUsernameAtSale || updated.member?.username || undefined,
        sellerNameAtSale: updated.sellerNameAtSale || updated.member?.name || undefined,
        items: rawItems,
        totalUnits,
        quantity: totalUnits,
        unitPrice: Number(firstItem.unitPrice ?? updated.unitPrice ?? 0),
        totalAmount: Number(updated.totalAmount),
        paymentMethod: updated.paymentMethod,
        cashAmount: updated.cashAmount !== null && updated.cashAmount !== undefined
          ? Number(updated.cashAmount)
          : updated.paymentMethod === 'CASH'
          ? Number(updated.totalAmount)
          : 0,
        upiAmount: updated.upiAmount !== null && updated.upiAmount !== undefined
          ? Number(updated.upiAmount)
          : updated.paymentMethod === 'UPI'
          ? Number(updated.totalAmount)
          : 0,
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

      await prisma.$transaction([
        prisma.gameSession.deleteMany({ where: { saleId: id } }),
        prisma.sale.delete({ where: { id } }),
      ]);
      broadcast('inventory:updated', { action: 'sale_deleted', id });

      res.json({ message: `Sale #${id} deleted successfully`, id });
    } catch (error) {
      console.error('Delete sale error:', error);
      res.status(500).json({ error: 'Failed to delete sale' });
    }
  }
);

export default router;

