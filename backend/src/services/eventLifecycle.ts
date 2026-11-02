import { EventStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { broadcast } from '../sockets';
import { stockTransaction, eventConsumption, StockConflict } from './stock';
import { InputError } from './payment';

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

/**
 * Extends the deadline of an active or concluded event.
 * If the event concluded due to timer expiration and the new deadline is in the future,
 * an authorized user can reactivate the stall for live sales.
 * In doing so, any stock returned to the warehouse upon automatic closure is reclaimed
 * so that:
 * 1. Historical sales, receipts, and allocations remain untouched.
 * 2. Stall stock is restored to what it was immediately prior to closure.
 * 3. Warehouse inventory is never double-counted or leaked.
 */
export async function extendEventDeadline(params: {
  eventId: string;
  newEndDatetime: Date | string;
  reason?: string;
  reactivate?: boolean;
  user?: { id?: string; name?: string; role?: string };
}) {
  const { eventId, newEndDatetime, reason, reactivate = true, user } = params;

  const parsedEnd = new Date(newEndDatetime);
  if (isNaN(parsedEnd.getTime())) {
    throw new InputError('Valid new end date and time is required.');
  }

  const now = new Date();
  if (parsedEnd.getTime() <= now.getTime()) {
    throw new InputError('New deadline must be in the future.');
  }

  const result = await stockTransaction(async tx => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      include: {
        allocations: {
          include: {
            product: {
              include: { inventory: true },
            },
          },
        },
      },
    });

    if (!event || event.isDeleted) {
      throw new StockConflict('Event / Stall not found or has been deleted.');
    }

    if (parsedEnd.getTime() <= event.endDatetime.getTime()) {
      throw new InputError(
        `New deadline (${parsedEnd.toISOString()}) must be later than the existing deadline (${event.endDatetime.toISOString()}).`
      );
    }

    if (parsedEnd.getTime() <= event.startDatetime.getTime()) {
      throw new InputError('New deadline must be after event start date and time.');
    }

    const wasEnded = event.status === EventStatus.ENDED || Boolean(event.reconciledAt);
    const wasClosedByTimeout = event.endDatetime.getTime() <= now.getTime();

    // Determine target status
    let targetStatus = event.status;
    let shouldReactivate = false;

    if (wasEnded) {
      if (reactivate && wasClosedByTimeout) {
        shouldReactivate = true;
        targetStatus = EventStatus.ACTIVE;
      }
    } else {
      targetStatus = computeEventStatus(event.startDatetime, parsedEnd, event.status);
    }

    // If reactivating an event that had its unsold inventory returned to warehouse:
    // Reclaim that unsold inventory from warehouse so physical stock matches and is not duplicated.
    if (shouldReactivate && event.reconciledAt) {
      const consumed = await eventConsumption(tx, eventId);
      for (const allocation of event.allocations) {
        const consumedQty = consumed.get(allocation.productId) || 0;
        const unsold = Math.max(0, allocation.allocatedQty - consumedQty);
        if (unsold > 0) {
          const currentWh = allocation.product.inventory?.quantityOnHand ?? 0;
          if (currentWh < unsold) {
            throw new StockConflict(
              `Cannot reactivate stall: Product '${allocation.product.name}' has only ${currentWh} units in warehouse, but ${unsold} were returned upon closure.`
            );
          }
          await tx.inventory.update({
            where: { productId: allocation.productId },
            data: {
              quantityOnHand: { decrement: unsold },
              lastUpdated: new Date(),
              notes: `Deadline extended; restored ${unsold} units to active stall allocation`,
            },
          });
        }
      }
    }

    const updated = await tx.event.update({
      where: { id: eventId },
      data: {
        endDatetime: parsedEnd,
        status: targetStatus,
        reconciledAt: shouldReactivate ? null : event.reconciledAt,
      },
      include: {
        allocations: {
          include: { product: true },
        },
      },
    });

    console.log(
      `[EventDeadline] Extended event ${eventId} ('${event.name}') by user ${user?.name || user?.id || 'System'} (${user?.role || 'N/A'}). Old deadline: ${event.endDatetime.toISOString()}, New deadline: ${parsedEnd.toISOString()}, Status: ${targetStatus}, Reason: ${reason || 'N/A'}`
    );

    return {
      event: updated,
      wasEnded,
      reactivated: shouldReactivate,
      previousEndDatetime: event.endDatetime,
      newEndDatetime: parsedEnd,
    };
  });

  broadcast('event:updated', { eventId, action: 'deadline_extended', newEndDatetime: result.newEndDatetime });
  if (result.reactivated) {
    broadcast('event:status_changed', { eventId, status: 'ACTIVE' });
    broadcast('event:updated', { eventId, action: 'started' });
  }
  broadcast('inventory:updated', { eventId, action: 'event_deadline_extended' });

  return result;
}
