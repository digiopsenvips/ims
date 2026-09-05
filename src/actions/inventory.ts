'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getCurrentSessionUser, requirePermission } from '@/lib/authz';
import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

const adjustmentSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  quantity: z.coerce.number().int('Quantity must be a whole number').positive('Quantity must be greater than zero'),
  mode: z.enum(['ADD', 'REMOVE']),
  notes: z.string().trim().max(500, 'Notes must be 500 characters or less').optional().nullable(),
});

export async function getInventoryOverview() {
  await getCurrentSessionUser();

  const products = await prisma.product.findMany({
    include: {
      project: true,
      inventoryTxns: {
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }],
  });

  return products.map((product) => {
    const currentStock = product.inventoryTxns.reduce((total, transaction) => {
      if (transaction.transactionType === 'ADJUSTMENT') {
        return total + transaction.quantity;
      }

      if (['INITIAL_PRODUCTION', 'PRODUCTION', 'EVENT_RETURN'].includes(transaction.transactionType)) {
        return total + transaction.quantity;
      }

      return total - transaction.quantity;
    }, 0);

    const latestMovement = product.inventoryTxns[0] ?? null;

    return {
      ...product,
      currentStock,
      latestMovement,
    };
  });
}

export async function adjustInventory(formData: FormData) {
  await requirePermission('inventory.adjust');

  const parsed = adjustmentSchema.parse({
    productId: formData.get('productId'),
    quantity: formData.get('quantity'),
    mode: formData.get('mode'),
    notes: formData.get('notes'),
  });

  const user = await getCurrentSessionUser();

  if (!user) {
    throw new Error('You must be logged in to update inventory.');
  }

  const product = await prisma.product.findUnique({
    where: { id: parsed.productId },
  });

  if (!product) {
    throw new Error('Product not found.');
  }

  const delta = parsed.mode === 'ADD' ? parsed.quantity : -parsed.quantity;

  const inventoryEntry = await prisma.inventoryTransaction.create({
    data: {
      productId: parsed.productId,
      transactionType: 'ADJUSTMENT',
      quantity: delta,
      referenceType: 'MANUAL',
      referenceId: parsed.productId,
      notes: parsed.notes?.trim() || `Manual inventory ${parsed.mode.toLowerCase()} adjustment.`,
      createdBy: user.id,
    },
  });

  await recordAuditEvent({
    action: parsed.mode === 'ADD' ? 'INVENTORY_ADJUSTMENT_ADD' : 'INVENTORY_ADJUSTMENT_REMOVE',
    entityType: 'INVENTORY_TRANSACTION',
    entityId: inventoryEntry.id,
    previousData: { productId: product.id, quantityBefore: 0 },
    newData: { productId: product.id, quantityDelta: delta, notes: inventoryEntry.notes },
    metadata: { productName: product.name, userId: user.id },
  });

  revalidatePath('/admin/inventory');
  revalidatePath('/dashboard');
}
