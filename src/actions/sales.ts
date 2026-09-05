'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getCurrentSessionUser, requirePermission, requireRole } from '@/lib/authz';
import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

const createMemberSaleSchema = z.object({
  eventId: z.string().uuid('Invalid event ID').optional().nullable(),
  productId: z.string().uuid('Invalid product ID'),
  quantity: z.coerce.number().int('Quantity must be a whole number').positive('Quantity must be at least 1'),
  customerName: z.string().trim().min(1, 'Customer name is required.').max(120, 'Customer name is too long.'),
  customerPhone: z.string().trim().min(7, 'Customer phone is required.').max(20, 'Customer phone is too long.'),
  paymentMethod: z.enum(['CASH', 'UPI']),
});

export async function getActiveSalesContext() {
  await requireRole(['DEVELOPER', 'ADMIN', 'HEAD', 'MEMBER']);

  const activeEvent = await prisma.event.findFirst({
    where: { status: 'ACTIVE' },
    include: {
      products: {
        include: {
          product: {
            include: {
              project: true,
            },
          },
        },
      },
    },
    orderBy: { startDate: 'asc' },
  });

  if (!activeEvent) {
    return {
      event: null,
      products: [],
    };
  }

  const products = activeEvent.products.map((eventProduct) => ({
    id: eventProduct.product.id,
    name: eventProduct.product.name,
    productCode: eventProduct.product.productCode,
    projectName: eventProduct.product.project.name,
    allocatedQuantity: eventProduct.allocatedQuantity,
    eventPrice: Number(eventProduct.eventPrice),
  }));

  return {
    event: {
      ...activeEvent,
      startDate: activeEvent.startDate.toISOString(),
      endDate: activeEvent.endDate ? activeEvent.endDate.toISOString() : null,
    },
    products,
  };
}

export async function getMySales() {
  const user = await requireRole(['DEVELOPER', 'ADMIN', 'HEAD', 'MEMBER']);

  const sales = await prisma.sale.findMany({
    where: {
      memberId: user.id,
    },
    include: {
      event: true,
      saleItems: {
        include: {
          product: true,
        },
      },
    },
    orderBy: { saleTime: 'desc' },
  });

  return sales.map((sale) => ({
    ...sale,
    saleTime: sale.saleTime.toISOString(),
    totalAmount: Number(sale.totalAmount),
    saleItems: sale.saleItems.map((item) => ({
      ...item,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    })),
  }));
}

export async function getSalesForManagement() {
  await requireRole(['DEVELOPER', 'ADMIN', 'HEAD']);

  const sales = await prisma.sale.findMany({
    include: {
      member: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
        },
      },
      event: {
        select: {
          id: true,
          name: true,
          eventCode: true,
        },
      },
      saleItems: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              productCode: true,
            },
          },
        },
      },
    },
    orderBy: { saleTime: 'desc' },
  });

  return sales.map((sale) => ({
    ...sale,
    saleTime: sale.saleTime.toISOString(),
    totalAmount: Number(sale.totalAmount),
    saleItems: sale.saleItems.map((item) => ({
      ...item,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    })),
  }));
}

export async function cancelSale(saleId: string) {
  await requirePermission('sales.cancel');

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      saleItems: true,
    },
  });

  if (!sale) {
    throw new Error('Sale not found.');
  }

  if (sale.status === 'CANCELLED') {
    return sale;
  }

  const currentUser = await getCurrentSessionUser();

  const updatedSale = await prisma.$transaction(async (tx) => {
    const cancelledSale = await tx.sale.update({
      where: { id: saleId },
      data: { status: 'CANCELLED' },
    });

    for (const item of sale.saleItems) {
      await tx.inventoryTransaction.create({
        data: {
          productId: item.productId,
          eventId: sale.eventId,
          transactionType: 'ADJUSTMENT',
          quantity: item.quantity,
          referenceType: 'SALE',
          referenceId: sale.id,
          notes: `Cancelled sale ${sale.transactionCode}. Stock restored.`,
          createdBy: currentUser?.id ?? sale.memberId,
        },
      });
    }

    return cancelledSale;
  });

  await recordAuditEvent({
    action: 'SALE_CANCELLED',
    entityType: 'SALE',
    entityId: updatedSale.id,
    previousData: { status: sale.status },
    newData: { status: updatedSale.status, transactionCode: sale.transactionCode },
    metadata: { cancelledBy: currentUser?.id ?? sale.memberId },
  });

  revalidatePath('/admin/sales');
  revalidatePath('/dashboard');
  revalidatePath('/member');

  return updatedSale;
}

export async function cancelSaleAction(formData: FormData) {
  const saleId = z.string().uuid().safeParse(formData.get('saleId'));

  if (!saleId.success) {
    throw new Error('Invalid sale ID.');
  }

  await cancelSale(saleId.data);
}

export async function createMemberSale(data: z.input<typeof createMemberSaleSchema>) {
  const user = await requirePermission('sales.create');

  const parsed = createMemberSaleSchema.parse(data);

  const event = parsed.eventId
    ? await prisma.event.findUnique({ where: { id: parsed.eventId } })
    : await prisma.event.findFirst({ where: { status: 'ACTIVE' } });

  if (!event) {
    throw new Error('No active event is available for sales.');
  }

  const eventProduct = await prisma.eventProduct.findUnique({
    where: {
      eventId_productId: {
        eventId: event.id,
        productId: parsed.productId,
      },
    },
    include: {
      product: {
        include: {
          project: true,
        },
      },
    },
  });

  if (!eventProduct) {
    throw new Error('This product is not assigned to the selected event.');
  }

  if (eventProduct.allocatedQuantity < parsed.quantity) {
    throw new Error(`Only ${eventProduct.allocatedQuantity} units are allocated for this product.`);
  }

  const unitPrice = Number(eventProduct.eventPrice);
  const totalAmount = unitPrice * parsed.quantity;
  const transactionCode = `SALE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const sale = await prisma.$transaction(async (tx) => {
    const createdSale = await tx.sale.create({
      data: {
        transactionCode,
        eventId: event.id,
        memberId: user.id,
        customerName: parsed.customerName,
        customerPhone: parsed.customerPhone,
        paymentMethod: parsed.paymentMethod,
        totalAmount: new Prisma.Decimal(totalAmount.toFixed(2)),
        saleTime: new Date(),
        status: 'COMPLETED',
        saleItems: {
          create: [
            {
              productId: parsed.productId,
              quantity: parsed.quantity,
              unitPrice: new Prisma.Decimal(unitPrice.toFixed(2)),
              lineTotal: new Prisma.Decimal((unitPrice * parsed.quantity).toFixed(2)),
            },
          ],
        },
      },
      include: {
        saleItems: {
          include: {
            product: true,
          },
        },
      },
    });

    await tx.inventoryTransaction.create({
      data: {
        productId: parsed.productId,
        eventId: event.id,
        transactionType: 'SALE',
        quantity: parsed.quantity,
        referenceType: 'SALE',
        referenceId: createdSale.id,
        notes: `Member sale recorded for ${parsed.customerName}.`,
        createdBy: user.id,
      },
    });

    return {
      ...createdSale,
      saleTime: createdSale.saleTime.toISOString(),
      totalAmount: Number(createdSale.totalAmount),
      saleItems: createdSale.saleItems.map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
      })),
    };
  });

  await recordAuditEvent({
    action: 'SALE_CREATED',
    entityType: 'SALE',
    entityId: sale.id,
    previousData: { eventId: event.id, productId: parsed.productId },
    newData: {
      transactionCode: sale.transactionCode,
      customerName: parsed.customerName,
      customerPhone: parsed.customerPhone,
      quantity: parsed.quantity,
      totalAmount: sale.totalAmount,
      paymentMethod: parsed.paymentMethod,
    },
    metadata: { memberId: user.id, eventId: event.id },
  });

  revalidatePath('/member');
  revalidatePath('/dashboard');

  return sale;
}

export async function getMemberSalesOverview() {
  const user = await getCurrentSessionUser();

  if (!user) {
    return {
      totalSales: 0,
      totalRevenue: 0,
      activeEvent: null,
    };
  }

  const [totalSales, totalRevenue, activeEvent] = await Promise.all([
    prisma.sale.count({ where: { memberId: user.id } }),
    prisma.sale.aggregate({
      where: { memberId: user.id },
      _sum: { totalAmount: true },
    }),
    prisma.event.findFirst({ where: { status: 'ACTIVE' } }),
  ]);

  return {
    totalSales,
    totalRevenue: Number(totalRevenue._sum.totalAmount ?? 0),
    activeEvent,
  };
}
