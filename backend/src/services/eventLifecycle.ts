import { EventStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { broadcast } from '../sockets';

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
  if (now.getTime() >= start.getTime()) {
    return EventStatus.ACTIVE;
  }
  return EventStatus.UPCOMING;
}

/**
 * Reconciles a single event's status and inventory idempotently.
 * Unsold allocated stock is returned to main inventory once and only once.
 */
export async function reconcileSingleEvent(
  eventId: string
): Promise<{ reconciled: boolean; transitioned: boolean; status: EventStatus }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      allocations: {
        include: { product: true },
      },
    },
  });

  if (!event || event.isDeleted) {
    return { reconciled: false, transitioned: false, status: EventStatus.ENDED };
  }

  const targetStatus = computeEventStatus(event.startDatetime, event.endDatetime, event.status);

  // If event has ended
  if (targetStatus === EventStatus.ENDED) {
    // Check if inventory has already been reconciled
    if (!event.reconciledAt) {
      await prisma.$transaction(async tx => {
        // Query total sold from sale_items for accuracy
        const soldItems = await tx.saleItem.groupBy({
          by: ['productId'],
          where: { sale: { eventId } },
          _sum: { quantity: true },
        });

        const soldMap: Record<string, number> = {};
        for (const item of soldItems) {
          soldMap[item.productId] = item._sum.quantity || 0;
        }

        // Return unsold units to main inventory
        for (const alloc of event.allocations) {
          const sold = soldMap[alloc.productId] || 0;
          const unsold = Math.max(0, alloc.allocatedQty - sold);

          if (unsold > 0) {
            await tx.inventory.update({
              where: { productId: alloc.productId },
              data: {
                quantityOnHand: { increment: unsold },
                lastUpdated: new Date(),
              },
            });
          }
        }

        // Set status to ENDED and timestamp reconciliation
        await tx.event.update({
          where: { id: eventId },
          data: {
            status: EventStatus.ENDED,
            reconciledAt: new Date(),
          },
        });
      });

      broadcast('event:updated', { eventId, action: 'ended' });
      broadcast('inventory:updated', { action: 'event_ended_stock_returned', eventId });

      return { reconciled: true, transitioned: true, status: EventStatus.ENDED };
    } else if (event.status !== EventStatus.ENDED) {
      // Already reconciled, just ensure status is ENDED
      await prisma.event.update({
        where: { id: eventId },
        data: { status: EventStatus.ENDED },
      });
      broadcast('event:updated', { eventId, action: 'ended' });
      return { reconciled: false, transitioned: true, status: EventStatus.ENDED };
    }

    return { reconciled: false, transitioned: false, status: EventStatus.ENDED };
  }

  // If event should be ACTIVE but is currently UPCOMING
  if (targetStatus === EventStatus.ACTIVE && event.status === EventStatus.UPCOMING) {
    await prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.ACTIVE },
    });
    broadcast('event:updated', { eventId, action: 'started' });
    return { reconciled: false, transitioned: true, status: EventStatus.ACTIVE };
  }

  return { reconciled: false, transitioned: false, status: event.status };
}

/**
 * Scans all non-deleted events, transitions statuses and reconciles inventory for any expired events.
 */
export async function reconcileAllExpiredEvents(): Promise<number> {
  try {
    const events = await prisma.event.findMany({
      where: {
        isDeleted: false,
        OR: [
          { status: { in: [EventStatus.UPCOMING, EventStatus.ACTIVE] } },
          { reconciledAt: null },
        ],
      },
      select: { id: true, startDatetime: true, endDatetime: true, status: true, reconciledAt: true },
    });

    let updatedCount = 0;
    const now = new Date();

    for (const ev of events) {
      const isPastEnd = now.getTime() >= ev.endDatetime.getTime();
      const isPastStart = now.getTime() >= ev.startDatetime.getTime();

      if ((isPastEnd && (!ev.reconciledAt || ev.status !== EventStatus.ENDED)) ||
          (isPastStart && !isPastEnd && ev.status === EventStatus.UPCOMING)) {
        const res = await reconcileSingleEvent(ev.id);
        if (res.transitioned || res.reconciled) {
          updatedCount++;
        }
      }
    }

    return updatedCount;
  } catch (err) {
    console.error('Error during reconcileAllExpiredEvents:', err);
    return 0;
  }
}
