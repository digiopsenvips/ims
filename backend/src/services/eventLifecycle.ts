import { EventStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { broadcast } from '../sockets';
import { stockTransaction, eventConsumption, StockConflict } from './stock';

/**
 * Computes authoritative time-based status for an event.
 * Rules:
 * 1. If an event is already manually marked ENDED, it stays ENDED.
 * 2. If current time >= endDatetime -> ENDED.
 * 3. If current time >= startDatetime and < endDatetime -> ACTIVE.
 * 4. If current time < startDatetime -> UPCOMING.
 */
export function computeEventStatus(
  startDatetime: Date | string,
  endDatetime: Date | string,
  currentStatus?: EventStatus
): EventStatus {
  if (currentStatus === EventStatus.ENDED) {
    return EventStatus.ENDED;
  }

  const now = new Date();
  const start = new Date(startDatetime);
  const end = new Date(endDatetime);

  if (now.getTime() >= end.getTime()) {
    return EventStatus.ENDED;
  }
  if (currentStatus === EventStatus.ACTIVE) {
    return EventStatus.ACTIVE;
  }
  if (now.getTime() >= start.getTime()) {
    return EventStatus.ACTIVE;
  }
  return EventStatus.UPCOMING;
}

/** Manual closure and the timer share one locked, once-only return path. */
export async function reconcileSingleEvent(eventId: string, forceClose = false) {
  const result = await stockTransaction(async tx => {
    const event = await tx.event.findUnique({
      where: { id: eventId }, include: { allocations: { include: { product: true } } },
    });
    if (!event || event.isDeleted) throw new StockConflict('Event / Stall not found.');
    const target = forceClose ? EventStatus.ENDED : computeEventStatus(event.startDatetime, event.endDatetime, event.status);
    const returnedItems: Array<{ productId: string; productName: string; returnedQty: number }> = [];
    if (target === EventStatus.ENDED && !event.reconciledAt) {
      const consumed = await eventConsumption(tx, eventId);
      for (const allocation of event.allocations) {
        const unsold = allocation.allocatedQty - (consumed.get(allocation.productId) || 0);
        if (unsold < 0) throw new StockConflict(`Allocation discrepancy for ${allocation.productId}; closure needs review.`);
        if (unsold > 0) {
          await tx.inventory.update({ where: { productId: allocation.productId },
            data: { quantityOnHand: { increment: unsold }, lastUpdated: new Date() } });
          returnedItems.push({ productId: allocation.productId, productName: allocation.product.name, returnedQty: unsold });
        }
      }
      const now = new Date();
      await tx.event.update({ where: { id: eventId }, data: {
        status: EventStatus.ENDED, reconciledAt: now,
        ...(forceClose && event.endDatetime > now ? { endDatetime: now } : {}),
      } });
      return { reconciled: true, transitioned: true, status: EventStatus.ENDED, returnedItems };
    }
    // Never reopen reconciled history, even if a stale caller requests a transition.
    if (!event.reconciledAt && target !== event.status) {
      await tx.event.update({ where: { id: eventId }, data: { status: target } });
      return { reconciled: false, transitioned: true, status: target, returnedItems };
    }
    return { reconciled: false, transitioned: false, status: event.status, returnedItems };
  });
  if (result.transitioned) {
    broadcast('event:updated', { eventId, action: result.status === 'ENDED' ? 'ended' : 'started' });
    broadcast('inventory:updated', { eventId, action: 'event_lifecycle' });
  }
  return result;
}

export async function reconcileAllExpiredEvents(): Promise<number> {
  const events = await prisma.event.findMany({
    where: { isDeleted: false, OR: [
      { status: { in: [EventStatus.UPCOMING, EventStatus.ACTIVE] } }, { reconciledAt: null },
    ] }, select: { id: true },
  });
  let count = 0;
  for (const event of events) {
    try {
      const result = await reconcileSingleEvent(event.id);
      if (result.transitioned || result.reconciled) count++;
    } catch (error) {
      console.error('Event lifecycle requires review:', event.id, error instanceof Error ? error.message : 'Unknown failure');
    }
  }
  return count;
}
