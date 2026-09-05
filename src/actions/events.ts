'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getCurrentSessionUser, requirePermission } from '@/lib/authz';
import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

const eventStatusSchema = z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED']);

const dateValueSchema = z.union([
  z.date(),
  z.string().trim().min(1, 'Date is required.').transform((value) => new Date(value)),
]).refine((value) => !Number.isNaN(value.getTime()), {
  message: 'A valid date is required.',
});

const createEventSchema = z.object({
  name: z.string().trim().min(1, 'Event name is required.'),
  eventCode: z
    .string()
    .trim()
    .min(1, 'Event code is required.')
    .regex(/^[A-Z0-9-]+$/, 'Event code must contain uppercase letters, numbers, and dashes only.'),
  location: z.string().trim().min(1, 'Location is required.'),
  startDate: dateValueSchema,
  endDate: z.union([dateValueSchema, z.string().trim().length(0)]).optional().nullable().transform((value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return value instanceof Date ? value : new Date(value);
  }),
  startTime: z.string().trim().optional().nullable(),
  endTime: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(1000, 'Notes must be under 1000 characters.').optional().nullable(),
  status: eventStatusSchema.default('DRAFT'),
  tenureId: z.string().uuid('Invalid tenure ID').optional().nullable(),
});

const updateEventSchema = createEventSchema.partial().extend({
  id: z.string().uuid('Invalid event ID'),
});

const assignProductSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  productId: z.string().uuid('Invalid product ID'),
  allocatedQuantity: z.coerce.number().int('Allocated quantity must be a whole number').nonnegative('Allocated quantity cannot be negative'),
  eventPrice: z.coerce.number().min(0, 'Event price cannot be negative'),
});

const reconcileEventProductSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  productId: z.string().uuid('Invalid product ID'),
  allocatedQuantity: z.coerce.number().int('Allocated quantity must be a whole number').nonnegative('Allocated quantity cannot be negative'),
  soldQuantity: z.coerce.number().int('Sold quantity must be a whole number').nonnegative('Sold quantity cannot be negative'),
  returnedQuantity: z.coerce.number().int('Returned quantity must be a whole number').nonnegative('Returned quantity cannot be negative'),
  damagedQuantity: z.coerce.number().int('Damaged quantity must be a whole number').nonnegative('Damaged quantity cannot be negative'),
  lostQuantity: z.coerce.number().int('Lost quantity must be a whole number').nonnegative('Lost quantity cannot be negative'),
  notes: z.string().trim().max(500, 'Notes must be 500 characters or less').optional().nullable(),
});

export async function getAllEvents() {
  await getCurrentSessionUser();

  return prisma.event.findMany({
    include: {
      products: {
        include: {
          product: true,
        },
      },
      tenure: true,
    },
    orderBy: { startDate: 'asc' },
  });
}

export async function getEventById(id: string) {
  await getCurrentSessionUser();

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      products: {
        include: {
          product: true,
        },
      },
      tenure: true,
      creator: true,
    },
  });

  if (!event) {
    throw new Error('Event not found.');
  }

  return event;
}

export async function createEvent(data: z.input<typeof createEventSchema>) {
  await requirePermission('events.create');

  const parsed = createEventSchema.parse(data);

  const existingCode = await prisma.event.findUnique({
    where: { eventCode: parsed.eventCode },
  });

  if (existingCode) {
    throw new Error(`Event code "${parsed.eventCode}" is already in use.`);
  }

  const user = await getCurrentSessionUser();

  if (!user) {
    throw new Error('Authentication required.');
  }

  const resolvedTenureId = parsed.tenureId ?? (await prisma.tenure.findFirst({ where: { isActive: true } }))?.id ?? null;

  const event = await prisma.event.create({
    data: {
      name: parsed.name,
      eventCode: parsed.eventCode,
      location: parsed.location,
      startDate: parsed.startDate,
      endDate: parsed.endDate ?? null,
      startTime: parsed.startTime ?? null,
      endTime: parsed.endTime ?? null,
      notes: parsed.notes ?? null,
      status: parsed.status,
      tenureId: resolvedTenureId,
      createdBy: user.id,
    },
  });

  await recordAuditEvent({
    action: 'EVENT_CREATED',
    entityType: 'EVENT',
    entityId: event.id,
    newData: {
      name: event.name,
      eventCode: event.eventCode,
      location: event.location,
      status: event.status,
    },
    metadata: { createdBy: user.id },
  });

  revalidatePath('/admin/events');
  return event;
}

export async function updateEvent(data: z.input<typeof updateEventSchema>) {
  await requirePermission('events.edit');

  const parsed = updateEventSchema.parse(data);
  const { id, ...updateData } = parsed;

  const event = await prisma.event.findUnique({ where: { id } });

  if (!event) {
    throw new Error('Event not found.');
  }

  if (updateData.eventCode && updateData.eventCode !== event.eventCode) {
    const existingCode = await prisma.event.findUnique({ where: { eventCode: updateData.eventCode } });
    if (existingCode) {
      throw new Error(`Event code "${updateData.eventCode}" is already in use.`);
    }
  }

  const updated = await prisma.event.update({
    where: { id },
    data: {
      ...updateData,
      startDate: updateData.startDate ?? undefined,
      endDate: updateData.endDate ?? undefined,
      startTime: updateData.startTime ?? undefined,
      endTime: updateData.endTime ?? undefined,
      notes: updateData.notes ?? undefined,
      tenureId: updateData.tenureId ?? undefined,
    },
  });

  await recordAuditEvent({
    action: 'EVENT_UPDATED',
    entityType: 'EVENT',
    entityId: updated.id,
    previousData: {
      name: event.name,
      eventCode: event.eventCode,
      location: event.location,
      status: event.status,
    },
    newData: {
      name: updated.name,
      eventCode: updated.eventCode,
      location: updated.location,
      status: updated.status,
    },
  });

  revalidatePath('/admin/events');
  revalidatePath(`/admin/events/${id}`);
  return updated;
}

export async function setEventStatus(eventId: string, status: z.infer<typeof eventStatusSchema>) {
  const permissionMap: Record<string, string> = {
    DRAFT: 'events.edit',
    SCHEDULED: 'events.edit',
    ACTIVE: 'events.start',
    COMPLETED: 'events.end',
    CANCELLED: 'events.cancel',
  };

  await requirePermission(permissionMap[status]);

  const event = await prisma.event.findUnique({ where: { id: eventId } });

  if (!event) {
    throw new Error('Event not found.');
  }

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: { status },
  });

  await recordAuditEvent({
    action: 'EVENT_STATUS_CHANGED',
    entityType: 'EVENT',
    entityId: updated.id,
    previousData: { status: event.status },
    newData: { status: updated.status },
    metadata: { previousStatus: event.status, newStatus: status },
  });

  revalidatePath('/admin/events');
  revalidatePath(`/admin/events/${eventId}`);
  return updated;
}

export async function upsertEventProduct(data: z.input<typeof assignProductSchema>) {
  const parsed = assignProductSchema.parse(data);

  const user = await getCurrentSessionUser();
  if (!user) {
    throw new Error('Authentication required.');
  }

  const event = await prisma.event.findUnique({ where: { id: parsed.eventId } });
  if (!event) {
    throw new Error('Event not found.');
  }

  const product = await prisma.product.findUnique({ where: { id: parsed.productId } });
  if (!product) {
    throw new Error('Product not found.');
  }

  const permission = parsed.allocatedQuantity === 0 ? 'event_inventory.edit' : 'event_inventory.create';
  await requirePermission(permission);

  const previousAllocation = await prisma.eventProduct.findUnique({
    where: {
      eventId_productId: {
        eventId: parsed.eventId,
        productId: parsed.productId,
      },
    },
  });

  const allocation = await prisma.eventProduct.upsert({
    where: {
      eventId_productId: {
        eventId: parsed.eventId,
        productId: parsed.productId,
      },
    },
    update: {
      allocatedQuantity: parsed.allocatedQuantity,
      eventPrice: parsed.eventPrice,
    },
    create: {
      eventId: parsed.eventId,
      productId: parsed.productId,
      allocatedQuantity: parsed.allocatedQuantity,
      eventPrice: parsed.eventPrice,
    },
  });

  await recordAuditEvent({
    action: 'EVENT_PRODUCT_ALLOCATED',
    entityType: 'EVENT_PRODUCT',
    entityId: allocation.id,
    previousData: {
      eventId: parsed.eventId,
      productId: parsed.productId,
      allocatedQuantity: previousAllocation?.allocatedQuantity ?? 0,
      eventPrice: previousAllocation ? Number(previousAllocation.eventPrice) : 0,
    },
    newData: {
      eventId: parsed.eventId,
      productId: parsed.productId,
      allocatedQuantity: allocation.allocatedQuantity,
      eventPrice: Number(allocation.eventPrice),
    },
  });

  revalidatePath('/admin/events');
  revalidatePath(`/admin/events/${parsed.eventId}`);
  return allocation;
}

export async function getEventReconciliationSnapshot(eventId: string) {
  await requirePermission('events.reconcile');

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      products: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!event) {
    throw new Error('Event not found.');
  }

  const reconciliations = await prisma.eventReconciliation.findMany({
    where: { eventId },
    include: { product: true },
  });

  const reconciliationMap = new Map(reconciliations.map((row) => [row.productId, row]));

  const rows = await Promise.all(
    event.products.map(async (eventProduct) => {
      const soldQuantity = await prisma.saleItem.groupBy({
        by: ['productId'],
        where: {
          productId: eventProduct.productId,
          sale: {
            eventId,
          },
        },
        _sum: {
          quantity: true,
        },
      });

      const base = reconciliationMap.get(eventProduct.productId) ?? {
        allocatedQuantity: eventProduct.allocatedQuantity,
        soldQuantity: 0,
        returnedQuantity: 0,
        damagedQuantity: 0,
        lostQuantity: 0,
        notes: null,
      };

      const computedSoldQuantity = Number(soldQuantity[0]?._sum.quantity ?? 0);
      const soldValue = base.soldQuantity ?? computedSoldQuantity;
      const difference = eventProduct.allocatedQuantity - soldValue - base.returnedQuantity - base.damagedQuantity - base.lostQuantity;

      return {
        id: eventProduct.id,
        productId: eventProduct.productId,
        productName: eventProduct.product.name,
        productCode: eventProduct.product.productCode,
        allocatedQuantity: eventProduct.allocatedQuantity,
        soldQuantity: soldValue,
        returnedQuantity: base.returnedQuantity,
        damagedQuantity: base.damagedQuantity,
        lostQuantity: base.lostQuantity,
        difference,
        notes: base.notes ?? '',
      };
    }),
  );

  return rows;
}

export async function saveEventReconciliation(data: z.input<typeof reconcileEventProductSchema>) {
  await requirePermission('events.reconcile');

  const parsed = reconcileEventProductSchema.parse(data);
  const difference = parsed.allocatedQuantity - parsed.soldQuantity - parsed.returnedQuantity - parsed.damagedQuantity - parsed.lostQuantity;

  const user = await getCurrentSessionUser();

  if (!user) {
    throw new Error('Authentication required.');
  }

  const event = await prisma.event.findUnique({ where: { id: parsed.eventId } });
  if (!event) {
    throw new Error('Event not found.');
  }

  const product = await prisma.product.findUnique({ where: { id: parsed.productId } });
  if (!product) {
    throw new Error('Product not found.');
  }

  const previousReconciliation = await prisma.eventReconciliation.findUnique({
    where: {
      eventId_productId: {
        eventId: parsed.eventId,
        productId: parsed.productId,
      },
    },
  });

  const reconciliation = await prisma.eventReconciliation.upsert({
    where: {
      eventId_productId: {
        eventId: parsed.eventId,
        productId: parsed.productId,
      },
    },
    update: {
      allocatedQuantity: parsed.allocatedQuantity,
      soldQuantity: parsed.soldQuantity,
      returnedQuantity: parsed.returnedQuantity,
      damagedQuantity: parsed.damagedQuantity,
      lostQuantity: parsed.lostQuantity,
      difference,
      notes: parsed.notes?.trim() || null,
      reconciledBy: user.id,
    },
    create: {
      eventId: parsed.eventId,
      productId: parsed.productId,
      allocatedQuantity: parsed.allocatedQuantity,
      soldQuantity: parsed.soldQuantity,
      returnedQuantity: parsed.returnedQuantity,
      damagedQuantity: parsed.damagedQuantity,
      lostQuantity: parsed.lostQuantity,
      difference,
      notes: parsed.notes?.trim() || null,
      reconciledBy: user.id,
    },
  });

  await recordAuditEvent({
    action: 'EVENT_RECONCILED',
    entityType: 'EVENT_RECONCILIATION',
    entityId: reconciliation.id,
    previousData: {
      allocatedQuantity: previousReconciliation?.allocatedQuantity ?? 0,
      soldQuantity: previousReconciliation?.soldQuantity ?? 0,
      returnedQuantity: previousReconciliation?.returnedQuantity ?? 0,
      damagedQuantity: previousReconciliation?.damagedQuantity ?? 0,
      lostQuantity: previousReconciliation?.lostQuantity ?? 0,
      difference: previousReconciliation?.difference ?? 0,
    },
    newData: {
      allocatedQuantity: reconciliation.allocatedQuantity,
      soldQuantity: reconciliation.soldQuantity,
      returnedQuantity: reconciliation.returnedQuantity,
      damagedQuantity: reconciliation.damagedQuantity,
      lostQuantity: reconciliation.lostQuantity,
      difference: reconciliation.difference,
      notes: reconciliation.notes,
    },
    metadata: { reconciledBy: user.id, eventId: parsed.eventId, productId: parsed.productId },
  });

  revalidatePath('/admin/events');
  revalidatePath(`/admin/events/${parsed.eventId}`);
  revalidatePath(`/admin/events/${parsed.eventId}/reconcile`);

  return reconciliation;
}

export async function saveEventReconciliationAction(formData: FormData) {
  const fields = {
    eventId: formData.get('eventId') ? String(formData.get('eventId')) : '',
    productId: formData.get('productId') ? String(formData.get('productId')) : '',
    allocatedQuantity: formData.get('allocatedQuantity') ? Number(String(formData.get('allocatedQuantity'))) : 0,
    soldQuantity: formData.get('soldQuantity') ? Number(String(formData.get('soldQuantity'))) : 0,
    returnedQuantity: formData.get('returnedQuantity') ? Number(String(formData.get('returnedQuantity'))) : 0,
    damagedQuantity: formData.get('damagedQuantity') ? Number(String(formData.get('damagedQuantity'))) : 0,
    lostQuantity: formData.get('lostQuantity') ? Number(String(formData.get('lostQuantity'))) : 0,
    notes: formData.get('notes') ? String(formData.get('notes')) : null,
  };

  await saveEventReconciliation(fields);
}
