import { businessDateRange } from '../services/reportDates';
import { responsePolicy } from '../middleware/responsePolicy';
import { preserveRecords } from '../middleware/preservation';
import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { sanitizeSaleForUser, sanitizeSalesListForUser } from '../middleware/piiSanitizer';
import { requireRoles } from '../middleware/rbac';
import { broadcast } from '../sockets';
import { PaymentMethod, Role, Prisma, TransactionType, EventStatus } from '@prisma/client';
import { computeEventStatus } from '../services/eventLifecycle';
import { stockTransaction, assertAllocatedStock, StockConflict } from '../services/stock';
import { paymentAmounts, paymentMethod as normalizePaymentMethod, validateOperation, moneyCents } from '../services/payment';
import { existingSaleAcknowledgement } from '../services/idempotency';
import { whatsappService } from '../services/whatsappService';

const router = Router();
router.use(responsePolicy);

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
      if (startDate || endDate) whereClause.saleTime = businessDateRange(startDate, endDate);

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
        const rawCartSnapshot = Array.isArray(s.cartSnapshot) ? (s.cartSnapshot as any[]) : null;
        const commercialUnits = rawCartSnapshot
          ? rawCartSnapshot.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0)
          : totalUnits;
        const physicalUnits = rawItems.reduce((sum, item) => sum + item.quantity, 0);

        const displayProductName = isGame
          ? (s.game?.name || 'Stall Game')
          : rawCartSnapshot && rawCartSnapshot.length > 0
          ? rawCartSnapshot.map(l => `${l.name} × ${l.quantity}`).join(', ')
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
          transactionType: (Array.isArray(rawCartSnapshot) && rawCartSnapshot.some(l => l.type === 'COMBO' || l.comboId) && rawCartSnapshot.some(l => l.type === 'NORMAL_PRODUCT' || (!l.type && !l.comboId)))
            ? 'MIXED'
            : s.transactionType || (s.comboId ? 'COMBO' : 'SALE'),
          comboId: s.comboId || null,
          comboName: s.comboName || s.combo?.name || null,
          cartSnapshot: rawCartSnapshot,
          lines: rawCartSnapshot,
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
          totalUnits: commercialUnits,
          commercialUnits,
          physicalUnits,
          quantity: commercialUnits, // alias for totalUnits
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

// Shared online/offline operation handler. Authentication is applied by both routes.
export const recordSale = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const existing = typeof req.body?.clientTxId === 'string'
      ? await existingSaleAcknowledgement(prisma, req.body, req.user!.id) : null;
    if (existing) { res.status(200).json({ sale: existing }); return; }
    validateOperation(req.body, req.user!.id);
    if (req.body.gameId || req.body.gameSessionId || req.body.rewardProductId || req.body.transactionType === 'GAME') {
      throw new StockConflict('Game operations must use the game transaction endpoint.');
    }
    if (req.body.transactionType && !['SALE', 'COMBO', 'MIXED'].includes(req.body.transactionType)) {
      throw new InputError('Invalid transaction type for sales checkout.');
    }
  } catch (error: any) {
    res.status(error.status || 400).json({ error: error.message });
    return;
  }

  const {
    eventId,
    lines,
    productId,
    quantity,
    items,
    comboId,
    comboQuantity,
    selectedItems,
    transactionType: requestedTxType,
    paymentMethod,
    cashAmount,
    upiAmount,
    customerName,
    customerPhone,
    clientTxId,
    saleTime,
    totalAmount,
  } = req.body;

  try {
    // 1. Normalize commercial line items into a unified list
    interface NormalizedLine {
      type: 'NORMAL_PRODUCT' | 'COMBO';
      productId?: string;
      comboId?: string;
      quantity: number;
      unitPrice?: number;
      selectedItems?: any[];
    }

    const inputLines: NormalizedLine[] = [];

    if (Array.isArray(lines) && lines.length > 0) {
      for (const line of lines) {
        const q = Math.max(1, parseInt(String(line.quantity || 1), 10) || 1);
        if (line.type === 'COMBO' || line.isCombo || line.comboId) {
          inputLines.push({
            type: 'COMBO',
            comboId: String(line.comboId || line.productId || ''),
            quantity: q,
            selectedItems: line.selectedItems || line.components,
          });
        } else {
          inputLines.push({
            type: 'NORMAL_PRODUCT',
            productId: String(line.productId || ''),
            quantity: q,
            unitPrice: line.unitPrice !== undefined ? Number(line.unitPrice) : undefined,
          });
        }
      }
    } else if (comboId || requestedTxType === 'COMBO') {
      const targetComboId = String(comboId || '');
      if (!targetComboId) {
        res.status(400).json({ error: 'comboId is required for COMBO transaction' });
        return;
      }
      const comboQty = Math.max(1, parseInt(String(comboQuantity || 1), 10) || 1);
      inputLines.push({
        type: 'COMBO',
        comboId: targetComboId,
        quantity: comboQty,
        selectedItems: selectedItems || items,
      });
    } else {
      const mergedMap = new Map<string, { quantity: number; unitPrice?: number }>();
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          const pId = String(item.productId || '');
          const q = parseInt(String(item.quantity || 0), 10);
          if (pId && !isNaN(q) && q > 0) {
            const cur = mergedMap.get(pId) || { quantity: 0, unitPrice: item.unitPrice };
            cur.quantity += q;
            mergedMap.set(pId, cur);
          }
        }
      } else if (productId && quantity) {
        const pId = String(productId);
        const q = parseInt(String(quantity), 10);
        if (pId && !isNaN(q) && q > 0) {
          mergedMap.set(pId, { quantity: q, unitPrice: req.body.unitPrice });
        }
      }
      for (const [pId, info] of mergedMap.entries()) {
        inputLines.push({
          type: 'NORMAL_PRODUCT',
          productId: pId,
          quantity: info.quantity,
          unitPrice: info.unitPrice,
        });
      }
    }

    if (!eventId || inputLines.length === 0 || !paymentMethod) {
      res.status(400).json({ error: 'Event, at least one product or combo, and payment method are required' });
      return;
    }

    // 2. Validate Payment Method format
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

    // 3. Fetch Event and verify open lifecycle
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
      res.status(400).json({ error: 'This event has ended and is no longer accepting sales.' });
      return;
    }

    if (eventStatus === 'UPCOMING' || new Date().getTime() < new Date(event.startDatetime).getTime()) {
      res.status(400).json({ error: 'This event has not started yet.' });
      return;
    }

    // 4. Resolve commercial lines and physical product requirements
    const commercialSnapshots: Array<{
      lineId: string;
      type: 'NORMAL_PRODUCT' | 'COMBO';
      productId?: string;
      comboId?: string;
      name: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      savings?: number;
      normalValue?: number;
      comboType?: string;
      components?: Array<{
        productId: string;
        productName: string;
        quantity: number;
        totalQuantity: number;
      }>;
    }> = [];

    const physicalItemsToFulfill: Array<{
      productId: string;
      productName: string;
      projectName: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      allowWarehouseFulfill: boolean;
    }> = [];

    for (const line of inputLines) {
      if (line.type === 'COMBO') {
        const combo = await prisma.combo.findUnique({
          where: { id: line.comboId },
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
          res.status(404).json({ error: `Combo offer ${line.comboId} not found, archived, or inactive` });
          return;
        }

        if (combo.eventId && combo.eventId !== eventId) {
          res.status(400).json({ error: `Combo offer "${combo.name}" is not valid for the selected event` });
          return;
        }

        interface ResolvedComp {
          productId: string;
          productName: string;
          projectName: string;
          quantity: number;
          allocationPrice: number;
        }
        const resolvedComponents: ResolvedComp[] = [];

        if (combo.comboType === 'PICK_ANY') {
          const rawSelected = Array.isArray(line.selectedItems) ? line.selectedItems : [];
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
          const requiredTotal = minItemsPerCombo * line.quantity;
          if (totalSelected !== requiredTotal) {
            res.status(400).json({
              error: `For combo "${combo.name}", you must select exactly ${requiredTotal} items (${minItemsPerCombo} per combo bundle). Selected: ${totalSelected}`,
            });
            return;
          }
          const allowedProductIds = combo.items.length > 0 ? new Set(combo.items.map(ci => ci.productId)) : null;

          for (const [pId, qty] of mergedSelected.entries()) {
            if (allowedProductIds && !allowedProductIds.has(pId)) {
              res.status(400).json({ error: `Product ${pId} is not in the allowed items for combo "${combo.name}".` });
              return;
            }
            const alloc = event.allocations.find(a => a.productId === pId);
            if (!alloc) {
              res.status(400).json({ error: `Product ${pId} is not allocated to this event.` });
              return;
            }
            if (combo.projectId && alloc.product.projectId !== combo.projectId) {
              throw new StockConflict('Selected product is outside this offer project.');
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
            const neededQty = ci.quantity * line.quantity;
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

        if (resolvedComponents.length === 0) {
          throw new StockConflict(`The offer "${combo.name}" has no eligible components.`);
        }

        // Proportional price distribution down to the exact cent
        const comboPriceTotal = Number(combo.price) * line.quantity;
        const totalUnits = resolvedComponents.reduce((sum, c) => sum + c.quantity, 0);
        const totalNormalValue = resolvedComponents.reduce((sum, c) => sum + (c.allocationPrice * c.quantity), 0);

        let allocatedCents = 0;
        const totalCents = Math.round(comboPriceTotal * 100);

        for (let idx = 0; idx < resolvedComponents.length; idx++) {
          const comp = resolvedComponents[idx];
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
          physicalItemsToFulfill.push({
            productId: comp.productId,
            productName: comp.productName,
            projectName: comp.projectName,
            quantity: comp.quantity,
            unitPrice,
            lineTotal,
            allowWarehouseFulfill: true,
          });
        }

        commercialSnapshots.push({
          lineId: `combo-${combo.id}-${commercialSnapshots.length}`,
          type: 'COMBO',
          comboId: combo.id,
          name: combo.name,
          quantity: line.quantity,
          unitPrice: Number(combo.price),
          lineTotal: comboPriceTotal,
          savings: totalNormalValue > comboPriceTotal ? Math.round((totalNormalValue - comboPriceTotal) * 100) / 100 : undefined,
          normalValue: totalNormalValue,
          comboType: combo.comboType,
          components: resolvedComponents.map(c => ({
            productId: c.productId,
            productName: c.productName,
            quantity: Math.round(c.quantity / line.quantity),
            totalQuantity: c.quantity,
          })),
        });
      } else {
        // NORMAL_PRODUCT
        const alloc = event.allocations.find(a => a.productId === line.productId);
        if (!alloc) {
          res.status(400).json({ error: `Product ${line.productId} is not allocated to this event` });
          return;
        }
        const unitPrice = Number(alloc.priceAtEvent);
        if (line.unitPrice !== undefined && moneyCents(line.unitPrice) !== moneyCents(unitPrice.toFixed(2))) {
          throw new StockConflict(`Price changed for ${line.productId}. Review the transaction before retrying.`);
        }
        const lineTotal = Math.round(unitPrice * line.quantity * 100) / 100;

        physicalItemsToFulfill.push({
          productId: alloc.productId,
          productName: alloc.product.name,
          projectName: alloc.product.project.name,
          quantity: line.quantity,
          unitPrice,
          lineTotal,
          allowWarehouseFulfill: false,
        });

        commercialSnapshots.push({
          lineId: alloc.productId,
          type: 'NORMAL_PRODUCT',
          productId: alloc.productId,
          name: alloc.product.name,
          quantity: line.quantity,
          unitPrice,
          lineTotal,
        });
      }
    }

    // 5. Calculate Grand Total & Commercial Units
    const grandTotal = Math.round(commercialSnapshots.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
    const commercialUnits = commercialSnapshots.reduce((sum, l) => sum + l.quantity, 0);
    const physicalUnits = physicalItemsToFulfill.reduce((sum, i) => sum + i.quantity, 0);

    const payment = paymentAmounts(normMethod, cashAmount, upiAmount, grandTotal);
    const resolvedCashAmount = payment.cash, resolvedUpiAmount = payment.upi;

    if (totalAmount !== undefined && moneyCents(totalAmount) !== moneyCents(grandTotal.toFixed(2))) {
      throw new StockConflict('Bill prices changed. Preserve this transaction for review.');
    }

    // 6. Atomic database transaction with global inventory lock
    let concurrentAcknowledgement: Awaited<ReturnType<typeof existingSaleAcknowledgement>> = null;
    const newSale = await stockTransaction(async tx => {
      if (clientTxId) {
        const existing = await existingSaleAcknowledgement(tx, req.body, req.user!.id);
        if (existing) {
          concurrentAcknowledgement = existing;
          return null;
        }
      }

      // Assert event stock and auto-source combo shortfall from warehouse
      await assertAllocatedStock(tx, eventId, physicalItemsToFulfill, true);

      const [{ nextVal }] = await tx.$queryRaw<[{ nextVal: bigint | number }]>`
        SELECT nextval('receipt_number_seq')::bigint as "nextVal"
      `;
      const receiptNumber = Number(nextVal);

      const comboLines = commercialSnapshots.filter(l => l.type === 'COMBO');
      const normalLines = commercialSnapshots.filter(l => l.type === 'NORMAL_PRODUCT');
      const transactionType = normalLines.length === 0 && comboLines.length > 0 ? TransactionType.COMBO : TransactionType.SALE;
      const targetComboId = comboLines.length === 1 ? comboLines[0].comboId : null;
      const targetComboName = comboLines.length === 1 ? comboLines[0].name : comboLines.length > 1 ? comboLines.map(c => c.name).join(' + ') : null;

      return await tx.sale.create({
        data: {
          receiptNumber,
          clientTxId: clientTxId ? String(clientTxId) : null,
          eventId,
          memberId: req.user!.id,
          sellerUserIdAtSale: req.user!.id,
          sellerUsernameAtSale: req.user!.username,
          sellerNameAtSale: req.user!.name,
          transactionType,
          comboId: targetComboId,
          comboName: targetComboName,
          cartSnapshot: commercialSnapshots,
          totalAmount: grandTotal,
          paymentMethod: normMethod,
          cashAmount: resolvedCashAmount,
          upiAmount: resolvedUpiAmount,
          customerName: customerName ? String(customerName).trim() : null,
          customerPhone: customerPhone ? String(customerPhone).trim() : null,
          saleTime: saleTime ? new Date(saleTime) : new Date(),
          items: {
            create: physicalItemsToFulfill.map(item => ({
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

    if (!newSale) {
      res.status(200).json({ sale: concurrentAcknowledgement });
      return;
    }

    // 7. WebSocket Realtime Broadcasts
    const isMixedOrder = commercialSnapshots.some(l => l.type === 'COMBO') && commercialSnapshots.some(l => l.type === 'NORMAL_PRODUCT');
    const effectiveTxType = isMixedOrder ? 'MIXED' : newSale.transactionType;

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
      itemsCount: commercialSnapshots.length,
      totalUnits: commercialUnits,
      commercialUnits,
      physicalUnits,
      transactionType: effectiveTxType,
      comboName: newSale.comboName,
      cartSnapshot: commercialSnapshots,
    });

    broadcast('inventory:updated', {
      action: 'sales_recorded',
      eventId,
      saleId: newSale.id,
    });

    for (const c of commercialSnapshots.filter(l => l.type === 'COMBO')) {
      broadcast('combo:sold', {
        comboId: c.comboId,
        eventId,
        receiptNumber: newSale.receiptNumber,
      });
    }

    // 8. Auto-dispatch Digital WhatsApp Bill if customer phone provided
    if (newSale.customerPhone && newSale.customerPhone.trim()) {
      whatsappService.sendSaleReceipt({
        phone: newSale.customerPhone.trim(),
        customerName: newSale.customerName ? String(newSale.customerName).trim() : 'Valued Supporter',
        receiptNumber: newSale.receiptNumber,
        eventName: newSale.event.name,
        eventLocation: newSale.event.location,
        items: commercialSnapshots.map(item => ({
          productName: item.type === 'COMBO' ? `[Combo] ${item.name}` : item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })),
        totalAmount: Number(newSale.totalAmount),
        paymentMethod: newSale.paymentMethod,
        cashAmount: Number(newSale.cashAmount ?? resolvedCashAmount),
        upiAmount: Number(newSale.upiAmount ?? resolvedUpiAmount),
        sellerName: newSale.sellerNameAtSale || req.user?.name,
        saleTime: newSale.saleTime,
      }).catch(err => console.error('[WhatsApp] Auto-dispatch receipt error:', err));
    }

    // 9. Format response payload
    const displayProductName = commercialSnapshots.map(l => `${l.name} × ${l.quantity}`).join(', ') || newSale.comboName || 'Products';
    const uniqueProjects = Array.from(new Set(newSale.items.map(item => item.product?.project?.name).filter(Boolean)));
    const primaryProject = uniqueProjects.length > 0 ? uniqueProjects.join(' + ') : 'Multiple';

    const formatted = {
      id: newSale.id,
      receiptNumber: newSale.receiptNumber,
      serialNumber: newSale.receiptNumber,
      clientTxId: newSale.clientTxId,
      eventId: newSale.eventId,
      eventName: newSale.event.name,
      transactionType: effectiveTxType,
      comboId: newSale.comboId,
      comboName: newSale.comboName,
      productName: displayProductName,
      description: displayProductName,
      projectName: primaryProject,
      totalAmount: Number(newSale.totalAmount),
      paymentMethod: newSale.paymentMethod,
      cashAmount: Number(newSale.cashAmount ?? resolvedCashAmount),
      upiAmount: Number(newSale.upiAmount ?? resolvedUpiAmount),
      customerName: newSale.customerName,
      customerPhone: newSale.customerPhone,
      saleTime: newSale.saleTime,
      createdAt: newSale.createdAt,
      cartSnapshot: commercialSnapshots,
      lines: commercialSnapshots,
      items: newSale.items.map(item => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        projectName: item.product.project.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
      })),
      totalUnits: commercialUnits,
      commercialUnits,
      physicalUnits,
      totalOrderAmount: grandTotal,
    };

    res.status(201).json({
      message: 'Sale recorded successfully',
      sale: sanitizeSaleForUser(formatted, req.user),
      totalItems: commercialUnits,
      totalOrderAmount: grandTotal,
    });
  } catch (error) {
    console.error('Record sale error:', error);
    res.status((error as any).status || 500).json({
      error: (error as any).status ? (error as Error).message : 'Failed to record sale. Retry the same operation key.',
    });
  }
};

// POST /api/sales: Record a single customer transaction (real-time entry)
router.post(
  '/',
  authenticateToken,
  recordSale
);

// POST /api/sales/sync: Bulk offline sync endpoint from PWA IndexedDB queue
router.post(
  '/sync',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const list = Array.isArray(req.body?.transactions) ? req.body.transactions : req.body?.sales;
    if (!Array.isArray(list) || list.length === 0 || list.length > 100) {
      res.status(400).json({ error: 'Provide between 1 and 100 queued transactions.' });
      return;
    }
    const results: any[] = [];
    // Each operation uses the same validator, stock lock, idempotency and commit path as online POS.
    // A failure is acknowledged once, without dropping the original payload.
    for (const body of list) {
      let status = 200;
      let response: any;
      const capture = {
        status(code: number) { status = code; return this; },
        json(value: any) { response = value; return this; },
      } as unknown as Response;
      const operationReq = Object.assign(Object.create(req), { body });
      try { await recordSale(operationReq, capture); }
      catch { status = 500; response = { error: 'Transaction outcome requires reconciliation; retry the same key.' }; }
      if (status < 300 && response?.sale?.id && response.sale.receiptNumber) {
        results.push({ clientTxId: body?.clientTxId, status: status === 200 ? 'already_synced' : 'success',
          saleId: response.sale.id, receiptNumber: response.sale.receiptNumber });
      } else {
        results.push({ clientTxId: body?.clientTxId, status: status === 409 ? 'conflict' : status >= 500 ? 'pending' : 'failed',
          error: response?.error || 'Transaction not acknowledged. Preserve the queued operation.' });
      }
    }
    res.json({ results, syncedCount: results.filter(r => r.status === 'success').length });
  }
);

// DELETE /api/sales/purge-all: Purge all sales records and reset canonical receipt sequence (DEVELOPER ONLY)
router.delete(
  '/purge-all',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  preserveRecords
);

// PUT /api/sales/:id: Edit an existing sale record (DEVELOPER ONLY)
router.put(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  preserveRecords
);

// DELETE /api/sales/:id: Delete a single sale record (DEVELOPER ONLY)
router.delete(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  preserveRecords
);

export default router;
