import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

export class StockConflict extends Error {
  readonly status = 409;
}

// All inventory writers use the same transaction-scoped lock, including closure.
// This deliberately favors correctness over parallel writes for this small POS.
// READ COMMITTED ensures queries made after acquiring the lock see the last commit.
export function stockTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(741923, 1)::text`;
    return work(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 20000 });
}

export async function eventConsumption(tx: Prisma.TransactionClient, eventId: string) {
  const items = await tx.saleItem.groupBy({
    by: ['productId'], where: { sale: { eventId } }, _sum: { quantity: true },
  });
  // Older header-only sales count once; never count a modern sale twice.
  const legacy = await tx.sale.findMany({
    where: { eventId, items: { none: {} }, productId: { not: null } },
    select: { productId: true, quantity: true },
  });
  const consumed = new Map<string, number>();
  for (const item of items) consumed.set(item.productId, item._sum.quantity || 0);
  for (const sale of legacy) {
    if (sale.productId) consumed.set(sale.productId, (consumed.get(sale.productId) || 0) + (sale.quantity || 0));
  }
  return consumed;
}

export async function assertEventOpen(tx: Prisma.TransactionClient, eventId: string) {
  const event = await tx.event.findUnique({ where: { id: eventId } });
  const now = Date.now();
  if (!event || event.isDeleted || event.reconciledAt || event.status === 'ENDED' ||
      event.endDatetime.getTime() <= now || event.startDatetime.getTime() > now) {
    throw new StockConflict('The event is not open. The operation has not been committed; preserve it for review.');
  }
  return event;
}

export async function assertAllocatedStock(
  tx: Prisma.TransactionClient, eventId: string,
  items: Array<{ productId: string; quantity: number; unitPrice?: number }>,
  checkPrice = false,
  allowWarehouseFulfill = false,
) {
  await assertEventOpen(tx, eventId);
  const allocations = await tx.eventAllocation.findMany({ where: { eventId }, include: { product: true } });
  const consumed = await eventConsumption(tx, eventId);
  const requested = new Map<string, number>();
  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new StockConflict('Invalid item quantity.');
    requested.set(item.productId, (requested.get(item.productId) || 0) + item.quantity);
  }
  for (const [productId, quantity] of requested) {
    let allocation = allocations.find(a => a.productId === productId);
    const consumedQty = consumed.get(productId) || 0;
    const currentAllocated = allocation ? allocation.allocatedQty : 0;
    const currentRemaining = Math.max(0, currentAllocated - consumedQty);

    if (currentRemaining < quantity) {
      if (!allowWarehouseFulfill) {
        throw new StockConflict(`Insufficient eligible event stock for ${productId}.`);
      }
      const shortfall = quantity - currentRemaining;
      const inv = await tx.inventory.findUnique({
        where: { productId },
        include: { product: true },
      });
      if (!inv || inv.product.isArchived || inv.product.isDeleted || inv.quantityOnHand < shortfall) {
        const availableWh = inv?.quantityOnHand || 0;
        const prodName = inv?.product?.name || productId;
        throw new StockConflict(
          `Insufficient stock for ${prodName}. Needed ${quantity}, available: ${currentRemaining} at stall + ${availableWh} in warehouse.`
        );
      }

      // Atomically decrement warehouse inventory by the exact shortfall
      await tx.inventory.update({
        where: { productId },
        data: {
          quantityOnHand: { decrement: shortfall },
          lastUpdated: new Date(),
        },
      });

      // Atomically increment (or create) event allocation for this stall
      if (allocation) {
        allocation = await tx.eventAllocation.update({
          where: { id: allocation.id },
          data: {
            allocatedQty: { increment: shortfall },
          },
          include: { product: true },
        });
      } else {
        allocation = await tx.eventAllocation.create({
          data: {
            eventId,
            productId,
            allocatedQty: shortfall,
            priceAtEvent: inv.product.basePrice || 0,
          },
          include: { product: true },
        });
        allocations.push(allocation);
      }
    }

    if (checkPrice && items.some(i => i.productId === productId && i.unitPrice !== Number(allocation!.priceAtEvent))) {
      throw new StockConflict(`Event price changed for ${productId}. Review the transaction before retrying.`);
    }
  }
}
