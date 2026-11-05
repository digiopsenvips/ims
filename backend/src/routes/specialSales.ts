import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';
import { stockTransaction, StockConflict } from '../services/stock';
import { whatsappQueueService } from '../services/whatsappQueueService';
import { broadcast } from '../sockets';

const router = Router();

// Strict Access Control: Developer & Admin ONLY
router.use(authenticateToken);
router.use(requireRoles(Role.DEVELOPER, Role.ADMIN));

/**
 * Helper to get the next sequential special sale reference and order number
 */
async function getNextSpecialSaleSequence(): Promise<{ orderNumber: number; reference: string }> {
  const result: any[] = await prisma.$queryRawUnsafe(`SELECT nextval('special_sale_order_seq')::int as next_val;`);
  const orderNumber = Number(result[0]?.next_val || 1001);
  const reference = `SS-${orderNumber}`;
  return { orderNumber, reference };
}

/**
 * GET /api/special-sales/stats
 * Dashboard metrics & reporting
 */
router.get('/stats', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const allSales = await prisma.specialSale.findMany({
      include: {
        items: {
          include: {
            product: {
              include: { project: true },
            },
          },
        },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalRevenue = 0; // Total collected/received cash/upi
    let totalBilled = 0;  // Total order amounts
    let totalUnits = 0;
    let totalOrders = 0;
    let pendingPaymentsCount = 0;
    let outstandingAmount = 0;
    let pendingFulfilmentCount = 0;
    let completedOrdersCount = 0;
    let draftOrdersCount = 0;
    let cancelledOrdersCount = 0;

    const categoryMap = new Map<string, { count: number; billed: number; received: number }>();
    const projectMap = new Map<string, { projectName: string; units: number; amount: number }>();

    for (const sale of allSales) {
      if (sale.status === 'DRAFT') {
        draftOrdersCount++;
        continue;
      }
      if (sale.status === 'CANCELLED') {
        cancelledOrdersCount++;
        continue;
      }

      // Valid confirmed/fulfilled orders
      totalOrders++;
      const billed = Number(sale.totalAmount) || 0;
      const received = Number(sale.amountPaid) || 0;
      const balance = Number(sale.balanceDue) || 0;
      const units = Number(sale.totalUnits) || 0;

      totalBilled += billed;
      totalRevenue += received;
      outstandingAmount += balance;
      totalUnits += units;

      if (sale.paymentStatus !== 'PAID') {
        pendingPaymentsCount++;
      }

      if (sale.status === 'CONFIRMED') {
        pendingFulfilmentCount++;
      } else if (sale.status === 'FULFILLED') {
        completedOrdersCount++;
      }

      // Category breakdown
      const cat = sale.customerCategory || 'OTHER';
      const catEntry = categoryMap.get(cat) || { count: 0, billed: 0, received: 0 };
      catEntry.count++;
      catEntry.billed += billed;
      catEntry.received += received;
      categoryMap.set(cat, catEntry);

      // Project breakdown from items
      for (const item of sale.items) {
        const projId = item.product?.projectId || 'UNKNOWN';
        const projName = item.product?.project?.name || 'General';
        const pEntry = projectMap.get(projId) || { projectName: projName, units: 0, amount: 0 };
        pEntry.units += item.quantity;
        pEntry.amount += Number(item.lineTotal) || 0;
        projectMap.set(projId, pEntry);
      }
    }

    const categoryBreakdown = Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      ...data,
    }));

    const projectBreakdown = Array.from(projectMap.entries()).map(([projectId, data]) => ({
      projectId,
      ...data,
    }));

    res.json({
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalBilled: Math.round(totalBilled * 100) / 100,
      totalOrders,
      totalUnits,
      pendingPaymentsCount,
      outstandingAmount: Math.round(outstandingAmount * 100) / 100,
      pendingFulfilmentCount,
      completedOrdersCount,
      draftOrdersCount,
      cancelledOrdersCount,
      categoryBreakdown,
      projectBreakdown,
    });
  } catch (err: any) {
    console.error('Special Sales stats error:', err);
    res.status(500).json({ error: err.message || 'Failed to compute special sales stats' });
  }
});

/**
 * GET /api/special-sales
 * List special sales with filtering and pagination
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      status,
      paymentStatus,
      customerCategory,
      search,
      startDate,
      endDate,
      page = '1',
      pageSize = '20',
    } = req.query;

    const where: any = {};

    if (status && status !== 'ALL') {
      where.status = String(status);
    }
    if (paymentStatus && paymentStatus !== 'ALL') {
      where.paymentStatus = String(paymentStatus);
    }
    if (customerCategory && customerCategory !== 'ALL') {
      where.customerCategory = String(customerCategory);
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(String(startDate));
      if (endDate) where.createdAt.lte = new Date(String(endDate));
    }
    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.OR = [
        { reference: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { contactPerson: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
      ];
    }

    const p = Math.max(1, parseInt(String(page), 10) || 1);
    const ps = Math.max(1, Math.min(100, parseInt(String(pageSize), 10) || 20));
    const skip = (p - 1) * ps;

    const [total, sales] = await Promise.all([
      prisma.specialSale.count({ where }),
      prisma.specialSale.findMany({
        where,
        skip,
        take: ps,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  projectId: true,
                  basePrice: true,
                  project: { select: { id: true, name: true, code: true } },
                },
              },
            },
          },
          payments: {
            orderBy: { paidAt: 'desc' },
          },
          whatsappDeliveries: {
            select: {
              id: true,
              status: true,
              customerPhone: true,
              lastAttemptAt: true,
              sentAt: true,
              lastError: true,
            },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
    ]);

    res.json({
      sales,
      total,
      page: p,
      pageSize: ps,
      totalPages: Math.ceil(total / ps),
    });
  } catch (err: any) {
    console.error('List special sales error:', err);
    res.status(500).json({ error: err.message || 'Failed to list special sales' });
  }
});

/**
 * GET /api/special-sales/:id
 * Retrieve a single special sale with full relations
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const sale = await prisma.specialSale.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                project: true,
                inventory: true,
              },
            },
          },
        },
        payments: {
          orderBy: { paidAt: 'desc' },
        },
        whatsappDeliveries: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!sale) {
      res.status(404).json({ error: 'Special sale not found' });
      return;
    }

    res.json(sale);
  } catch (err: any) {
    console.error('Get special sale error:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve special sale' });
  }
});

/**
 * POST /api/special-sales
 * Create a new special sale (Draft or Confirmed)
 */
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      customerName,
      customerCategory,
      contactPerson,
      phone,
      email,
      billingAddress,
      department,
      notes,
      items,
      discountAmount = 0,
      discountPercentage,
      discountReason,
      additionalCharges = 0,
      chargesReason,
      confirmImmediately = false,
      initialPayment,
      sendWhatsApp = false,
    } = req.body;

    if (!customerName || !String(customerName).trim()) {
      res.status(400).json({ error: 'Customer or Organisation Name is required.' });
      return;
    }
    if (!customerCategory || !String(customerCategory).trim()) {
      res.status(400).json({ error: 'Customer Category is required.' });
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'At least one product item is required.' });
      return;
    }

    // Verify all products exist and calculate pricing
    const productIds = items.map(i => i.productId);
    const existingProducts = await prisma.product.findMany({
      where: { id: { in: productIds }, isDeleted: false },
      include: { inventory: true, project: true },
    });
    const productMap = new Map(existingProducts.map(p => [p.id, p]));

    for (const item of items) {
      if (!productMap.has(item.productId)) {
        res.status(400).json({ error: `Product ID '${item.productId}' not found or is retired.` });
        return;
      }
      const qty = parseInt(String(item.quantity), 10);
      if (isNaN(qty) || qty <= 0) {
        res.status(400).json({ error: `Invalid quantity '${item.quantity}' for product '${item.productId}'. Quantity must be a positive integer.` });
        return;
      }
    }

    // Process line items
    let subtotalCents = 0;
    let totalUnitsCount = 0;
    const processedItems: Array<{
      productId: string;
      quantity: number;
      standardPrice: number;
      specialPrice: number;
      isPriceOverridden: boolean;
      overrideReason?: string;
      discountAmount: number;
      lineTotal: number;
    }> = [];

    for (const item of items) {
      const prod = productMap.get(item.productId)!;
      const qty = parseInt(String(item.quantity), 10);
      const stdPrice = Number(prod.basePrice || 0);
      const specPrice = item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== ''
        ? Math.max(0, Number(item.unitPrice))
        : stdPrice;
      const isPriceOverridden = Math.abs(specPrice - stdPrice) > 0.001;
      const itemDiscount = Math.max(0, Number(item.discountAmount || 0));

      const lineTotal = Math.max(0, Math.round((specPrice * qty - itemDiscount) * 100) / 100);
      subtotalCents += Math.round(lineTotal * 100);
      totalUnitsCount += qty;

      processedItems.push({
        productId: item.productId,
        quantity: qty,
        standardPrice: stdPrice,
        specialPrice: specPrice,
        isPriceOverridden,
        overrideReason: item.overrideReason?.trim() || (isPriceOverridden ? 'Special negotiated pricing' : undefined),
        discountAmount: itemDiscount,
        lineTotal,
      });
    }

    const subtotal = subtotalCents / 100;
    const orderDiscount = Math.max(0, Number(discountAmount || 0));
    const orderAdditional = Math.max(0, Number(additionalCharges || 0));
    const totalAmount = Math.max(0, Math.round((subtotal - orderDiscount + orderAdditional) * 100) / 100);

    // Initial payment validation
    let initialPaid = 0;
    let paymentStatus = 'UNPAID';
    let paymentMethodVal: string | null = null;
    if (initialPayment && Number(initialPayment.amount) > 0) {
      initialPaid = Math.min(totalAmount, Number(initialPayment.amount));
      paymentStatus = initialPaid >= totalAmount ? 'PAID' : 'PARTIALLY_PAID';
      paymentMethodVal = initialPayment.paymentMethod || 'UPI';
    }
    const balanceDue = Math.max(0, Math.round((totalAmount - initialPaid) * 100) / 100);

    const currentUser = req.user!;

    if (confirmImmediately) {
      // Execute atomically under stockTransaction with advisory lock
      const createdSale = await stockTransaction(async tx => {
        // 1. Authoritative Warehouse Stock Check
        for (const item of processedItems) {
          const inv = await tx.inventory.findUnique({
            where: { productId: item.productId },
            include: { product: true },
          });
          const whStock = inv?.quantityOnHand ?? 0;
          if (whStock < item.quantity) {
            const prodName = inv?.product?.name || item.productId;
            throw new StockConflict(
              `Insufficient warehouse stock for '${prodName}' (${item.productId}). Requested: ${item.quantity} units, available in warehouse: ${whStock} units (shortfall: ${item.quantity - whStock} units).`
            );
          }
        }

        // 2. Decrement warehouse stock for confirmed order
        for (const item of processedItems) {
          await tx.inventory.update({
            where: { productId: item.productId },
            data: {
              quantityOnHand: { decrement: item.quantity },
              notes: `Special Sale deduction: ${item.quantity} units for customer '${customerName}'`,
              lastUpdated: new Date(),
            },
          });
        }

        // 3. Generate sequential order number & reference
        const seqResult: any[] = await tx.$queryRawUnsafe(`SELECT nextval('special_sale_order_seq')::int as next_val;`);
        const orderNumber = Number(seqResult[0]?.next_val || 1001);
        const reference = `SS-${orderNumber}`;

        // 4. Create special sale record
        const sale = await tx.specialSale.create({
          data: {
            reference,
            orderNumber,
            customerName: customerName.trim(),
            customerCategory: customerCategory.trim(),
            contactPerson: contactPerson?.trim() || null,
            phone: phone?.trim() || null,
            email: email?.trim() || null,
            billingAddress: billingAddress?.trim() || null,
            department: department?.trim() || null,
            notes: notes?.trim() || null,
            status: 'CONFIRMED',
            paymentStatus,
            paymentMethod: paymentMethodVal,
            subtotal,
            discountAmount: orderDiscount,
            discountPercentage: discountPercentage ? Number(discountPercentage) : null,
            discountReason: discountReason?.trim() || null,
            additionalCharges: orderAdditional,
            chargesReason: chargesReason?.trim() || null,
            totalAmount,
            amountPaid: initialPaid,
            balanceDue,
            totalUnits: totalUnitsCount,
            totalItems: processedItems.length,
            createdById: currentUser.id,
            createdByName: currentUser.name,
            confirmedAt: new Date(),
            confirmedById: currentUser.id,
            confirmedByName: currentUser.name,
            items: {
              create: processedItems.map(i => ({
                productId: i.productId,
                quantity: i.quantity,
                standardPrice: i.standardPrice,
                specialPrice: i.specialPrice,
                isPriceOverridden: i.isPriceOverridden,
                overrideReason: i.overrideReason,
                discountAmount: i.discountAmount,
                lineTotal: i.lineTotal,
              })),
            },
            ...(initialPaid > 0
              ? {
                  payments: {
                    create: {
                      paymentMethod: paymentMethodVal!,
                      amount: initialPaid,
                      cashAmount: initialPayment.cashAmount ? Number(initialPayment.cashAmount) : null,
                      upiAmount: initialPayment.upiAmount ? Number(initialPayment.upiAmount) : null,
                      reference: initialPayment.reference?.trim() || null,
                      notes: initialPayment.notes?.trim() || 'Initial payment on order confirmation',
                      recordedById: currentUser.id,
                      recordedByName: currentUser.name,
                    },
                  },
                }
              : {}),
          },
          include: {
            items: {
              include: { product: true },
            },
            payments: true,
          },
        });

        return sale;
      });

      // Enqueue WhatsApp bill if requested and valid phone
      if (sendWhatsApp && createdSale.phone) {
        try {
          await enqueueSpecialSaleWhatsAppBill(createdSale);
        } catch (waErr) {
          console.error('[SpecialSale] WhatsApp enqueue error:', waErr);
        }
      }

      broadcast('special_sale_created', createdSale);
      broadcast('inventory_updated', { reason: 'special_sale_confirmed' });

      res.status(201).json({
        sale: createdSale,
        message: `Special Sale '${createdSale.reference}' successfully created and confirmed! ${createdSale.totalUnits} units allocated from warehouse.`,
      });
      return;
    }

    // Save as DRAFT: Generate placeholder draft reference, no stock deduction
    const draftRef = `DRAFT-${Date.now().toString().slice(-6)}`;
    const seqResult: any[] = await prisma.$queryRawUnsafe(`SELECT nextval('special_sale_order_seq')::int as next_val;`);
    const orderNumber = Number(seqResult[0]?.next_val || 1001);

    const draftSale = await prisma.specialSale.create({
      data: {
        reference: draftRef,
        orderNumber,
        customerName: customerName.trim(),
        customerCategory: customerCategory.trim(),
        contactPerson: contactPerson?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        billingAddress: billingAddress?.trim() || null,
        department: department?.trim() || null,
        notes: notes?.trim() || null,
        status: 'DRAFT',
        paymentStatus: 'UNPAID',
        paymentMethod: paymentMethodVal,
        subtotal,
        discountAmount: orderDiscount,
        discountPercentage: discountPercentage ? Number(discountPercentage) : null,
        discountReason: discountReason?.trim() || null,
        additionalCharges: orderAdditional,
        chargesReason: chargesReason?.trim() || null,
        totalAmount,
        amountPaid: 0,
        balanceDue: totalAmount,
        totalUnits: totalUnitsCount,
        totalItems: processedItems.length,
        createdById: currentUser.id,
        createdByName: currentUser.name,
        items: {
          create: processedItems.map(i => ({
            productId: i.productId,
            quantity: i.quantity,
            standardPrice: i.standardPrice,
            specialPrice: i.specialPrice,
            isPriceOverridden: i.isPriceOverridden,
            overrideReason: i.overrideReason,
            discountAmount: i.discountAmount,
            lineTotal: i.lineTotal,
          })),
        },
      },
      include: {
        items: {
          include: { product: true },
        },
        payments: true,
      },
    });

    broadcast('special_sale_created', draftSale);

    res.status(201).json({
      sale: draftSale,
      message: `Special Sale draft saved successfully (${draftSale.reference}). Stock is not deducted until confirmed.`,
    });
  } catch (err: any) {
    if (err instanceof StockConflict) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Create special sale error:', err);
    res.status(500).json({ error: err.message || 'Failed to create special sale' });
  }
});

/**
 * PUT /api/special-sales/:id
 * Edit Special Sale (Draft or Confirmed)
 */
router.put('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const saleId = req.params.id;
    const existing = await prisma.specialSale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Special sale not found' });
      return;
    }

    if (existing.status === 'CANCELLED') {
      res.status(400).json({ error: 'Cancelled special sales cannot be edited.' });
      return;
    }

    const {
      customerName,
      customerCategory,
      contactPerson,
      phone,
      email,
      billingAddress,
      department,
      notes,
      items,
      discountAmount,
      discountPercentage,
      discountReason,
      additionalCharges,
      chargesReason,
    } = req.body;

    const currentUser = req.user!;

    // If order is DRAFT, update fields and items freely
    if (existing.status === 'DRAFT') {
      let subtotal = Number(existing.subtotal);
      let totalUnits = existing.totalUnits;
      let totalItems = existing.totalItems;

      if (Array.isArray(items) && items.length > 0) {
        // Recalculate items
        const productIds = items.map(i => i.productId);
        const existingProducts = await prisma.product.findMany({
          where: { id: { in: productIds } },
        });
        const productMap = new Map(existingProducts.map(p => [p.id, p]));

        let subtotalCents = 0;
        let unitsSum = 0;
        const newItems: any[] = [];

        for (const item of items) {
          const prod = productMap.get(item.productId);
          if (!prod) {
            res.status(400).json({ error: `Product '${item.productId}' not found.` });
            return;
          }
          const qty = parseInt(String(item.quantity), 10);
          const stdPrice = Number(prod.basePrice || 0);
          const specPrice = item.unitPrice !== undefined && item.unitPrice !== null
            ? Math.max(0, Number(item.unitPrice))
            : stdPrice;
          const isOverridden = Math.abs(specPrice - stdPrice) > 0.001;
          const discount = Math.max(0, Number(item.discountAmount || 0));
          const lineTotal = Math.max(0, Math.round((specPrice * qty - discount) * 100) / 100);

          subtotalCents += Math.round(lineTotal * 100);
          unitsSum += qty;

          newItems.push({
            productId: item.productId,
            quantity: qty,
            standardPrice: stdPrice,
            specialPrice: specPrice,
            isPriceOverridden: isOverridden,
            overrideReason: item.overrideReason?.trim() || (isOverridden ? 'Special negotiated pricing' : undefined),
            discountAmount: discount,
            lineTotal,
          });
        }

        subtotal = subtotalCents / 100;
        totalUnits = unitsSum;
        totalItems = newItems.length;

        // Delete old items and insert new items
        await prisma.specialSaleItem.deleteMany({ where: { specialSaleId: saleId } });
        await prisma.specialSaleItem.createMany({
          data: newItems.map(i => ({ ...i, specialSaleId: saleId })),
        });
      }

      const orderDiscount = discountAmount !== undefined ? Math.max(0, Number(discountAmount)) : Number(existing.discountAmount);
      const orderAdditional = additionalCharges !== undefined ? Math.max(0, Number(additionalCharges)) : Number(existing.additionalCharges);
      const totalAmount = Math.max(0, Math.round((subtotal - orderDiscount + orderAdditional) * 100) / 100);
      const balanceDue = Math.max(0, Math.round((totalAmount - Number(existing.amountPaid)) * 100) / 100);

      const updated = await prisma.specialSale.update({
        where: { id: saleId },
        data: {
          customerName: customerName ? customerName.trim() : existing.customerName,
          customerCategory: customerCategory ? customerCategory.trim() : existing.customerCategory,
          contactPerson: contactPerson !== undefined ? (contactPerson?.trim() || null) : existing.contactPerson,
          phone: phone !== undefined ? (phone?.trim() || null) : existing.phone,
          email: email !== undefined ? (email?.trim() || null) : existing.email,
          billingAddress: billingAddress !== undefined ? (billingAddress?.trim() || null) : existing.billingAddress,
          department: department !== undefined ? (department?.trim() || null) : existing.department,
          notes: notes !== undefined ? (notes?.trim() || null) : existing.notes,
          subtotal,
          discountAmount: orderDiscount,
          discountPercentage: discountPercentage !== undefined ? (discountPercentage ? Number(discountPercentage) : null) : existing.discountPercentage,
          discountReason: discountReason !== undefined ? (discountReason?.trim() || null) : existing.discountReason,
          additionalCharges: orderAdditional,
          chargesReason: chargesReason !== undefined ? (chargesReason?.trim() || null) : existing.chargesReason,
          totalAmount,
          balanceDue,
          totalUnits,
          totalItems,
          lastModifiedById: currentUser.id,
          lastModifiedByName: currentUser.name,
        },
        include: { items: { include: { product: true } }, payments: true },
      });

      broadcast('special_sale_updated', updated);
      res.json({ sale: updated, message: 'Draft special sale updated successfully.' });
      return;
    }

    // If order is already CONFIRMED or FULFILLED:
    // Update contact and non-stock fields, or if items edited, apply stock deltas under stockTransaction
    if (Array.isArray(items) && items.length > 0) {
      const updated = await stockTransaction(async tx => {
        // Calculate stock deltas for each product
        const oldQtyMap = new Map<string, number>();
        for (const item of existing.items) {
          oldQtyMap.set(item.productId, (oldQtyMap.get(item.productId) || 0) + item.quantity);
        }

        const newQtyMap = new Map<string, number>();
        for (const item of items) {
          const q = parseInt(String(item.quantity), 10);
          newQtyMap.set(item.productId, (newQtyMap.get(item.productId) || 0) + q);
        }

        const allProductIds = new Set([...oldQtyMap.keys(), ...newQtyMap.keys()]);
        for (const pid of allProductIds) {
          const oldQ = oldQtyMap.get(pid) || 0;
          const newQ = newQtyMap.get(pid) || 0;
          const delta = newQ - oldQ; // positive means need more, negative means return

          if (delta > 0) {
            const inv = await tx.inventory.findUnique({
              where: { productId: pid },
              include: { product: true },
            });
            const wh = inv?.quantityOnHand ?? 0;
            if (wh < delta) {
              const name = inv?.product?.name || pid;
              throw new StockConflict(
                `Insufficient warehouse stock to increase '${name}' allocation by +${delta} units (warehouse available: ${wh}).`
              );
            }
            await tx.inventory.update({
              where: { productId: pid },
              data: {
                quantityOnHand: { decrement: delta },
                notes: `Special Sale ${existing.reference} updated: +${delta} units`,
                lastUpdated: new Date(),
              },
            });
          } else if (delta < 0) {
            const returnQty = Math.abs(delta);
            await tx.inventory.update({
              where: { productId: pid },
              data: {
                quantityOnHand: { increment: returnQty },
                notes: `Special Sale ${existing.reference} updated: returned ${returnQty} units`,
                lastUpdated: new Date(),
              },
            });
          }
        }

        // Re-create items with updated prices
        await tx.specialSaleItem.deleteMany({ where: { specialSaleId: saleId } });
        let subtotalCents = 0;
        let unitsSum = 0;
        const newProcessed: any[] = [];

        for (const item of items) {
          const prod = await tx.product.findUnique({ where: { id: item.productId } });
          const qty = parseInt(String(item.quantity), 10);
          const stdPrice = Number(prod?.basePrice || 0);
          const specPrice = item.unitPrice !== undefined && item.unitPrice !== null
            ? Math.max(0, Number(item.unitPrice))
            : stdPrice;
          const isOverridden = Math.abs(specPrice - stdPrice) > 0.001;
          const discount = Math.max(0, Number(item.discountAmount || 0));
          const lineTotal = Math.max(0, Math.round((specPrice * qty - discount) * 100) / 100);

          subtotalCents += Math.round(lineTotal * 100);
          unitsSum += qty;

          newProcessed.push({
            specialSaleId: saleId,
            productId: item.productId,
            quantity: qty,
            standardPrice: stdPrice,
            specialPrice: specPrice,
            isPriceOverridden: isOverridden,
            overrideReason: item.overrideReason?.trim() || (isOverridden ? 'Special negotiated pricing' : undefined),
            discountAmount: discount,
            lineTotal,
          });
        }

        await tx.specialSaleItem.createMany({ data: newProcessed });

        const subtotal = subtotalCents / 100;
        const orderDiscount = discountAmount !== undefined ? Math.max(0, Number(discountAmount)) : Number(existing.discountAmount);
        const orderAdditional = additionalCharges !== undefined ? Math.max(0, Number(additionalCharges)) : Number(existing.additionalCharges);
        const totalAmount = Math.max(0, Math.round((subtotal - orderDiscount + orderAdditional) * 100) / 100);
        const amountPaid = Number(existing.amountPaid);
        const balanceDue = Math.max(0, Math.round((totalAmount - amountPaid) * 100) / 100);
        const paymentStatus = balanceDue <= 0 ? 'PAID' : (amountPaid > 0 ? 'PARTIALLY_PAID' : 'UNPAID');

        const upd = await tx.specialSale.update({
          where: { id: saleId },
          data: {
            customerName: customerName ? customerName.trim() : existing.customerName,
            customerCategory: customerCategory ? customerCategory.trim() : existing.customerCategory,
            contactPerson: contactPerson !== undefined ? (contactPerson?.trim() || null) : existing.contactPerson,
            phone: phone !== undefined ? (phone?.trim() || null) : existing.phone,
            email: email !== undefined ? (email?.trim() || null) : existing.email,
            billingAddress: billingAddress !== undefined ? (billingAddress?.trim() || null) : existing.billingAddress,
            department: department !== undefined ? (department?.trim() || null) : existing.department,
            notes: notes !== undefined ? (notes?.trim() || null) : existing.notes,
            subtotal,
            discountAmount: orderDiscount,
            discountPercentage: discountPercentage !== undefined ? (discountPercentage ? Number(discountPercentage) : null) : existing.discountPercentage,
            discountReason: discountReason !== undefined ? (discountReason?.trim() || null) : existing.discountReason,
            additionalCharges: orderAdditional,
            chargesReason: chargesReason !== undefined ? (chargesReason?.trim() || null) : existing.chargesReason,
            totalAmount,
            balanceDue,
            paymentStatus,
            totalUnits: unitsSum,
            totalItems: newProcessed.length,
            lastModifiedById: currentUser.id,
            lastModifiedByName: currentUser.name,
          },
          include: { items: { include: { product: true } }, payments: true },
        });

        return upd;
      });

      broadcast('special_sale_updated', updated);
      broadcast('inventory_updated', { reason: 'special_sale_modified' });
      res.json({ sale: updated, message: 'Special sale and warehouse stock updated successfully.' });
      return;
    }

    // Only updating contact / notes info
    const updated = await prisma.specialSale.update({
      where: { id: saleId },
      data: {
        customerName: customerName ? customerName.trim() : existing.customerName,
        customerCategory: customerCategory ? customerCategory.trim() : existing.customerCategory,
        contactPerson: contactPerson !== undefined ? (contactPerson?.trim() || null) : existing.contactPerson,
        phone: phone !== undefined ? (phone?.trim() || null) : existing.phone,
        email: email !== undefined ? (email?.trim() || null) : existing.email,
        billingAddress: billingAddress !== undefined ? (billingAddress?.trim() || null) : existing.billingAddress,
        department: department !== undefined ? (department?.trim() || null) : existing.department,
        notes: notes !== undefined ? (notes?.trim() || null) : existing.notes,
        lastModifiedById: currentUser.id,
        lastModifiedByName: currentUser.name,
      },
      include: { items: { include: { product: true } }, payments: true },
    });

    broadcast('special_sale_updated', updated);
    res.json({ sale: updated, message: 'Special sale details updated successfully.' });
  } catch (err: any) {
    if (err instanceof StockConflict) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Update special sale error:', err);
    res.status(500).json({ error: err.message || 'Failed to update special sale' });
  }
});

/**
 * POST /api/special-sales/:id/confirm
 * Confirm a draft special sale, deduct warehouse stock atomically, assign official SS-XXXX reference
 */
router.post('/:id/confirm', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const saleId = req.params.id;
    const { initialPayment, sendWhatsApp = false } = req.body;

    const existing = await prisma.specialSale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Special sale not found' });
      return;
    }

    if (existing.status === 'CONFIRMED' || existing.status === 'FULFILLED') {
      res.status(400).json({ error: `Special sale is already ${existing.status.toLowerCase()} (${existing.reference}).` });
      return;
    }

    if (existing.status === 'CANCELLED') {
      res.status(400).json({ error: 'Cannot confirm a cancelled special sale.' });
      return;
    }

    const currentUser = req.user!;

    // Process atomically under stockTransaction
    const confirmedSale = await stockTransaction(async tx => {
      // 1. Authoritative Warehouse Stock Check
      for (const item of existing.items) {
        const inv = await tx.inventory.findUnique({
          where: { productId: item.productId },
          include: { product: true },
        });
        const whStock = inv?.quantityOnHand ?? 0;
        if (whStock < item.quantity) {
          const prodName = inv?.product?.name || item.productId;
          throw new StockConflict(
            `Insufficient warehouse stock for '${prodName}' (${item.productId}). Requested: ${item.quantity} units, available in warehouse: ${whStock} units (shortfall: ${item.quantity - whStock} units).`
          );
        }
      }

      // 2. Decrement warehouse stock for each item
      for (const item of existing.items) {
        await tx.inventory.update({
          where: { productId: item.productId },
          data: {
            quantityOnHand: { decrement: item.quantity },
            notes: `Special Sale confirmed: ${item.quantity} units for customer '${existing.customerName}'`,
            lastUpdated: new Date(),
          },
        });
      }

      // 3. Generate sequential order number & reference if not already official
      let reference = existing.reference;
      let orderNumber = existing.orderNumber;
      if (reference.startsWith('DRAFT-') || !reference.startsWith('SS-')) {
        const seqResult: any[] = await tx.$queryRawUnsafe(`SELECT nextval('special_sale_order_seq')::int as next_val;`);
        orderNumber = Number(seqResult[0]?.next_val || 1001);
        reference = `SS-${orderNumber}`;
      }

      // 4. Initial payment handling
      let paidAmt = Number(existing.amountPaid);
      let payMethod = existing.paymentMethod;
      let payStatus = existing.paymentStatus;
      const totalAmt = Number(existing.totalAmount);

      if (initialPayment && Number(initialPayment.amount) > 0) {
        const addPay = Number(initialPayment.amount);
        paidAmt = Math.min(totalAmt, paidAmt + addPay);
        payMethod = initialPayment.paymentMethod || 'UPI';
        payStatus = paidAmt >= totalAmt ? 'PAID' : 'PARTIALLY_PAID';

        await tx.specialSalePayment.create({
          data: {
            specialSaleId: saleId,
            paymentMethod: payMethod || 'UPI',
            amount: addPay,
            cashAmount: initialPayment.cashAmount ? Number(initialPayment.cashAmount) : null,
            upiAmount: initialPayment.upiAmount ? Number(initialPayment.upiAmount) : null,
            reference: initialPayment.reference?.trim() || null,
            notes: initialPayment.notes?.trim() || 'Payment upon order confirmation',
            recordedById: currentUser.id,
            recordedByName: currentUser.name,
          },
        });
      }

      const balanceDue = Math.max(0, Math.round((totalAmt - paidAmt) * 100) / 100);

      // 5. Update SpecialSale
      const sale = await tx.specialSale.update({
        where: { id: saleId },
        data: {
          reference,
          orderNumber,
          status: 'CONFIRMED',
          paymentStatus: payStatus,
          paymentMethod: payMethod,
          amountPaid: paidAmt,
          balanceDue,
          confirmedAt: new Date(),
          confirmedById: currentUser.id,
          confirmedByName: currentUser.name,
        },
        include: {
          items: {
            include: { product: true },
          },
          payments: true,
        },
      });

      return sale;
    });

    if (sendWhatsApp && confirmedSale.phone) {
      try {
        await enqueueSpecialSaleWhatsAppBill(confirmedSale);
      } catch (waErr) {
        console.error('[SpecialSale] WhatsApp enqueue error:', waErr);
      }
    }

    broadcast('special_sale_confirmed', confirmedSale);
    broadcast('inventory_updated', { reason: 'special_sale_confirmed' });

    res.json({
      sale: confirmedSale,
      message: `Special Sale '${confirmedSale.reference}' successfully confirmed! ${confirmedSale.totalUnits} units allocated from warehouse.`,
    });
  } catch (err: any) {
    if (err instanceof StockConflict) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Confirm special sale error:', err);
    res.status(500).json({ error: err.message || 'Failed to confirm special sale' });
  }
});

/**
 * POST /api/special-sales/:id/fulfill
 * Mark confirmed special sale as Fulfilled
 */
router.post('/:id/fulfill', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const saleId = req.params.id;
    const existing = await prisma.specialSale.findUnique({
      where: { id: saleId },
      include: { items: true, payments: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Special sale not found' });
      return;
    }

    if (existing.status === 'FULFILLED') {
      res.status(400).json({ error: 'Special sale is already marked as fulfilled.' });
      return;
    }

    if (existing.status !== 'CONFIRMED') {
      res.status(400).json({ error: `Cannot fulfill order in '${existing.status}' status. Order must be CONFIRMED first.` });
      return;
    }

    const currentUser = req.user!;

    const fulfilledSale = await prisma.specialSale.update({
      where: { id: saleId },
      data: {
        status: 'FULFILLED',
        fulfilledAt: new Date(),
        fulfilledById: currentUser.id,
        fulfilledByName: currentUser.name,
      },
      include: {
        items: { include: { product: true } },
        payments: true,
      },
    });

    broadcast('special_sale_fulfilled', fulfilledSale);

    res.json({
      sale: fulfilledSale,
      message: `Special Sale '${fulfilledSale.reference}' has been marked as fulfilled. Transaction history preserved.`,
    });
  } catch (err: any) {
    console.error('Fulfill special sale error:', err);
    res.status(500).json({ error: err.message || 'Failed to fulfill special sale' });
  }
});

/**
 * POST /api/special-sales/:id/cancel
 * Cancel a special sale and reverse warehouse stock deduction safely exactly once
 */
router.post('/:id/cancel', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const saleId = req.params.id;
    const { cancelReason } = req.body;

    if (!cancelReason || !String(cancelReason).trim()) {
      res.status(400).json({ error: 'A cancellation reason is required.' });
      return;
    }

    const existing = await prisma.specialSale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Special sale not found' });
      return;
    }

    if (existing.status === 'CANCELLED') {
      res.status(400).json({ error: 'This special sale is already cancelled.' });
      return;
    }

    const currentUser = req.user!;

    const cancelledSale = await stockTransaction(async tx => {
      // If order was CONFIRMED or FULFILLED, restore warehouse inventory
      if (existing.status === 'CONFIRMED' || existing.status === 'FULFILLED') {
        for (const item of existing.items) {
          await tx.inventory.update({
            where: { productId: item.productId },
            data: {
              quantityOnHand: { increment: item.quantity },
              notes: `Special Sale ${existing.reference} cancelled; restored ${item.quantity} units to warehouse`,
              lastUpdated: new Date(),
            },
          });
        }
      }

      const updated = await tx.specialSale.update({
        where: { id: saleId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: currentUser.id,
          cancelledByName: currentUser.name,
          cancelReason: cancelReason.trim(),
        },
        include: {
          items: { include: { product: true } },
          payments: true,
        },
      });

      return updated;
    });

    broadcast('special_sale_cancelled', cancelledSale);
    broadcast('inventory_updated', { reason: 'special_sale_cancelled' });

    res.json({
      sale: cancelledSale,
      message: `Special Sale '${cancelledSale.reference}' cancelled successfully. ${existing.status === 'CONFIRMED' || existing.status === 'FULFILLED' ? 'All allocated units restored to warehouse.' : 'Draft cancelled.'}`,
    });
  } catch (err: any) {
    console.error('Cancel special sale error:', err);
    res.status(500).json({ error: err.message || 'Failed to cancel special sale' });
  }
});

/**
 * POST /api/special-sales/:id/payments
 * Record a subsequent payment for a special sale
 */
router.post('/:id/payments', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const saleId = req.params.id;
    const { paymentMethod, amount, cashAmount, upiAmount, reference, notes, sendWhatsApp = false } = req.body;

    const parsedAmount = Math.round(Number(amount) * 100) / 100;
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'Payment amount must be a positive number.' });
      return;
    }

    const existing = await prisma.specialSale.findUnique({
      where: { id: saleId },
      include: { payments: true, items: { include: { product: true } } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Special sale not found' });
      return;
    }

    if (existing.status === 'CANCELLED') {
      res.status(400).json({ error: 'Cannot record payment for a cancelled special sale.' });
      return;
    }

    if (paymentMethod === 'CASH_UPI') {
      const c = Number(cashAmount || 0);
      const u = Number(upiAmount || 0);
      if (Math.abs(Math.round((c + u) * 100) - Math.round(parsedAmount * 100)) > 1) {
        res.status(400).json({ error: `Cash (₹${c}) + UPI (₹${u}) must equal total payment amount (₹${parsedAmount}).` });
        return;
      }
    }

    const currentUser = req.user!;

    // Create payment record & update sale balance
    const updatedSale = await prisma.$transaction(async tx => {
      await tx.specialSalePayment.create({
        data: {
          specialSaleId: saleId,
          paymentMethod: paymentMethod || 'UPI',
          amount: parsedAmount,
          cashAmount: cashAmount ? Number(cashAmount) : null,
          upiAmount: upiAmount ? Number(upiAmount) : null,
          reference: reference?.trim() || null,
          notes: notes?.trim() || null,
          recordedById: currentUser.id,
          recordedByName: currentUser.name,
        },
      });

      const newPaid = Math.round((Number(existing.amountPaid) + parsedAmount) * 100) / 100;
      const totalAmt = Number(existing.totalAmount);
      const newBalance = Math.max(0, Math.round((totalAmt - newPaid) * 100) / 100);
      const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';

      return tx.specialSale.update({
        where: { id: saleId },
        data: {
          amountPaid: newPaid,
          balanceDue: newBalance,
          paymentStatus: newStatus,
          paymentMethod: existing.paymentMethod || paymentMethod,
        },
        include: {
          items: { include: { product: true } },
          payments: { orderBy: { paidAt: 'desc' } },
        },
      });
    });

    if (sendWhatsApp && updatedSale.phone) {
      try {
        await enqueueSpecialSaleWhatsAppBill(updatedSale);
      } catch (waErr) {
        console.error('[SpecialSale] WhatsApp enqueue error:', waErr);
      }
    }

    broadcast('special_sale_payment_recorded', updatedSale);

    res.json({
      sale: updatedSale,
      message: `Payment of ₹${parsedAmount.toFixed(2)} recorded successfully for ${updatedSale.reference}. Outstanding balance: ₹${updatedSale.balanceDue.toFixed(2)}.`,
    });
  } catch (err: any) {
    console.error('Record special sale payment error:', err);
    res.status(500).json({ error: err.message || 'Failed to record payment' });
  }
});

/**
 * POST /api/special-sales/:id/send-whatsapp
 * Manually enqueue or retry sending WhatsApp bill for this order
 */
router.post('/:id/send-whatsapp', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const saleId = req.params.id;
    const sale = await prisma.specialSale.findUnique({
      where: { id: saleId },
      include: {
        items: { include: { product: true } },
        payments: true,
      },
    });

    if (!sale) {
      res.status(404).json({ error: 'Special sale not found' });
      return;
    }

    if (!sale.phone || !sale.phone.trim()) {
      res.status(400).json({ error: 'Customer phone number is required to send a WhatsApp bill.' });
      return;
    }

    const delivery = await enqueueSpecialSaleWhatsAppBill(sale);

    res.json({
      success: true,
      deliveryId: delivery.id,
      status: delivery.status,
      message: `WhatsApp bill queued for delivery to ${sale.phone}. Current status: ${delivery.status}.`,
    });
  } catch (err: any) {
    console.error('Send WhatsApp special sale error:', err);
    res.status(500).json({ error: err.message || 'Failed to queue WhatsApp bill' });
  }
});

/**
 * Helper to build and enqueue Special Sale Bill into WhatsApp queue
 */
async function enqueueSpecialSaleWhatsAppBill(sale: any): Promise<{ id: string; status: string }> {
  const items = (sale.items || []).map((i: any) => ({
    productName: i.product?.name || i.productId,
    quantity: i.quantity,
    unitPrice: Number(i.specialPrice),
    lineTotal: Number(i.lineTotal),
  }));

  return whatsappQueueService.enqueueBill({
    receiptNumber: sale.orderNumber,
    customerName: sale.customerName,
    customerPhone: sale.phone || '',
    eventName: `Special Order (${sale.customerCategory})`,
    eventLocation: sale.department || sale.billingAddress || 'Direct Order',
    items,
    totalAmount: Number(sale.totalAmount),
    paymentMethod: sale.paymentStatus === 'PAID'
      ? (sale.paymentMethod || 'PAID')
      : `${sale.paymentStatus} (Paid: ₹${Number(sale.amountPaid).toFixed(2)} | Balance: ₹${Number(sale.balanceDue).toFixed(2)})`,
    sellerName: sale.createdByName || 'Enactus Admin',
    saleTime: sale.createdAt,
  });
}

export default router;
