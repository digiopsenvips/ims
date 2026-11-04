import { EventStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { broadcast } from '../sockets';
import { stockTransaction, eventConsumption, StockConflict } from './stock';
import { InputError, nonnegativeInteger, moneyCents } from './payment';

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

export interface ExtendDeadlineAllocationInput {
  productId: string;
  allocatedQty: number | string;
  priceAtEvent?: number | string;
}

/**
 * Previews authoritative server-side numbers for reopening an ended stall.
 * Calculates warehouse stock, historical sales, previous allocation, unsold units,
 * and identifies discrepancies where warehouse stock differs from closure returns.
 */
export async function getEventReopenPreview(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      allocations: {
        include: {
          product: {
            include: { inventory: true, project: true },
          },
        },
      },
    },
  });

  if (!event || event.isDeleted) {
    throw new StockConflict('Event / Stall not found or has been deleted.');
  }

  const consumed = await eventConsumption(prisma, eventId);

  // Fetch all eligible products (not deleted, either not archived or already in this event)
  const allProducts = await prisma.product.findMany({
    where: {
      isDeleted: false,
      OR: [
        { isArchived: false },
        { id: { in: event.allocations.map(a => a.productId) } },
      ],
    },
    include: {
      inventory: true,
      project: true,
    },
    orderBy: [
      { project: { name: 'asc' } },
      { name: 'asc' },
    ],
  });

  const products = allProducts.map(p => {
    const existingAlloc = event.allocations.find(a => a.productId === p.id);
    const previousAllocated = existingAlloc ? existingAlloc.allocatedQty : 0;
    const previouslySold = consumed.get(p.id) || 0;
    const previousUnsold = Math.max(0, previousAllocated - previouslySold);
    const currentWarehouse = p.inventory?.quantityOnHand ?? 0;
    const priceAtEvent = existingAlloc ? Number(existingAlloc.priceAtEvent) : Number(p.basePrice || 0);

    const minAllowed = previouslySold;
    const maxAllocatable = previouslySold + currentWarehouse;
    const hasDiscrepancy = Boolean(event.reconciledAt) && previousUnsold > currentWarehouse;

    let discrepancy = null;
    if (hasDiscrepancy) {
      const diff = previousUnsold - currentWarehouse;
      discrepancy = {
        hasDiscrepancy: true,
        returnedAtClosure: previousUnsold,
        currentWarehouse,
        shortfall: diff,
        note: `${previousUnsold} units were returned upon closure, but currently ${currentWarehouse} units remain in warehouse (${diff} units legitimately consumed in subsequent operations/stalls). Maximum allocatable is ${maxAllocatable} units (${previouslySold} sold + ${currentWarehouse} active).`,
      };
    }

    return {
      productId: p.id,
      productName: p.name,
      sku: p.id,
      projectId: p.projectId,
      projectName: p.project?.name || 'General',
      basePrice: Number(p.basePrice || 0),
      priceAtEvent,
      currentWarehouse,
      previousAllocated,
      previouslySold,
      previousUnsold,
      minAllowed,
      maxAllocatable,
      suggestedAllocation: Math.min(previousAllocated, maxAllocatable),
      isPreviouslyAllocated: Boolean(existingAlloc),
      discrepancy,
    };
  });

  return {
    event: {
      id: event.id,
      name: event.name,
      location: event.location,
      status: event.status,
      startDatetime: event.startDatetime,
      endDatetime: event.endDatetime,
      reconciledAt: event.reconciledAt,
    },
    products,
  };
}

/**
 * Extends the deadline of an active or concluded event.
 * If the event concluded and the new deadline is in the future,
 * an authorized user can reactivate the stall for live sales.
 *
 * Rules:
 * 1. Historical sales, receipts, and allocations are strictly preserved.
 * 2. If allocations are provided, the new allocation is reviewed and validated against
 *    actual available warehouse inventory.
 * 3. Only the necessary active units (newAllocatedQty - previouslySold) are deducted from warehouse.
 * 4. Total allocation cannot be reduced below historical sales.
 * 5. Warehouse inventory is never double-counted or leaked.
 */
export async function extendEventDeadline(params: {
  eventId: string;
  newEndDatetime: Date | string;
  reason?: string;
  reactivate?: boolean;
  allocations?: ExtendDeadlineAllocationInput[];
  user?: { id?: string; name?: string; role?: string };
}) {
  const { eventId, newEndDatetime, reason, reactivate = true, allocations, user } = params;

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

    // Determine target status
    let targetStatus = event.status;
    let shouldReactivate = false;

    if (wasEnded) {
      if (reactivate) {
        shouldReactivate = true;
        targetStatus = EventStatus.ACTIVE;
      }
    } else {
      targetStatus = computeEventStatus(event.startDatetime, parsedEnd, event.status);
    }

    const consumed = await eventConsumption(tx, eventId);

    // If reactivating an event that had its unsold inventory returned to warehouse upon closure:
    if (shouldReactivate && event.reconciledAt) {
      if (Array.isArray(allocations)) {
        // --- REVIEWED ALLOCATION REOPENING WORKFLOW ---
        const seenIds = new Set<string>();
        for (const a of allocations) {
          if (!a.productId) throw new InputError('Product ID is required for each allocation entry.');
          if (seenIds.has(a.productId)) throw new InputError(`Duplicate product '${a.productId}' in allocation review.`);
          seenIds.add(a.productId);
        }

        // Process requested allocations
        for (const alloc of allocations) {
          const rawQty = alloc.allocatedQty === undefined || alloc.allocatedQty === null || alloc.allocatedQty === '' ? 0 : alloc.allocatedQty;
          const newAllocatedQty = nonnegativeInteger(rawQty, `Allocation for ${alloc.productId}`);
          const consumedQty = consumed.get(alloc.productId) || 0;

          // Cannot set total allocation lower than what was already sold at this event
          if (newAllocatedQty < consumedQty) {
            const existingAlloc = event.allocations.find(a => a.productId === alloc.productId);
            const prodName = existingAlloc?.product?.name || alloc.productId;
            throw new StockConflict(
              `Cannot allocate ${newAllocatedQty} units for '${prodName}'. The stall already completed ${consumedQty} sales for this product. Historical sales cannot be de-allocated.`
            );
          }

          // Active units needed at stall
          const neededAtStall = newAllocatedQty - consumedQty;

          if (neededAtStall > 0) {
            const inv = await tx.inventory.findUnique({
              where: { productId: alloc.productId },
              include: { product: true },
            });
            const currentWh = inv?.quantityOnHand ?? 0;
            if (currentWh < neededAtStall) {
              const prodName = inv?.product?.name || alloc.productId;
              throw new StockConflict(
                `Insufficient warehouse stock for '${prodName}': requested new allocation of ${newAllocatedQty} units requires ${neededAtStall} active units from warehouse (${consumedQty} units previously sold), but warehouse only has ${currentWh} units available (shortfall: ${neededAtStall - currentWh} units).`
              );
            }

            // Decrement warehouse stock for the newly allocated active units
            await tx.inventory.update({
              where: { productId: alloc.productId },
              data: {
                quantityOnHand: { decrement: neededAtStall },
                notes: `Stall '${event.name}' reopened; allocated ${neededAtStall} active units (${newAllocatedQty} total allocation - ${consumedQty} previously sold)`,
                lastUpdated: new Date(),
              },
            });
          }

          // Update or create allocation record
          const existingAlloc = event.allocations.find(a => a.productId === alloc.productId);
          const rawPrice = alloc.priceAtEvent !== undefined && alloc.priceAtEvent !== null && alloc.priceAtEvent !== ''
            ? moneyCents(alloc.priceAtEvent) / 100
            : (existingAlloc ? Number(existingAlloc.priceAtEvent) : 0);

          if (existingAlloc) {
            await tx.eventAllocation.update({
              where: { id: existingAlloc.id },
              data: {
                allocatedQty: newAllocatedQty,
                priceAtEvent: rawPrice,
                updatedAt: new Date(),
              },
            });
          } else {
            const inv = await tx.inventory.findUnique({ where: { productId: alloc.productId }, include: { product: true } });
            await tx.eventAllocation.create({
              data: {
                eventId,
                productId: alloc.productId,
                allocatedQty: newAllocatedQty,
                priceAtEvent: rawPrice || Number(inv?.product?.basePrice || 0),
              },
            });
          }
        }

        // For any previous allocations NOT in the reviewed allocations array:
        for (const prevAlloc of event.allocations) {
          if (!seenIds.has(prevAlloc.productId)) {
            const consumedQty = consumed.get(prevAlloc.productId) || 0;
            // Set allocation to historical sales (0 active stock pulled from warehouse)
            if (prevAlloc.allocatedQty !== consumedQty) {
              await tx.eventAllocation.update({
                where: { id: prevAlloc.id },
                data: {
                  allocatedQty: consumedQty,
                  updatedAt: new Date(),
                },
              });
            }
          }
        }

      } else {
        // --- LEGACY / DEFAULT RECLAIM WORKFLOW ---
        for (const allocation of event.allocations) {
          const consumedQty = consumed.get(allocation.productId) || 0;
          const unsold = Math.max(0, allocation.allocatedQty - consumedQty);
          if (unsold > 0) {
            const currentWh = allocation.product.inventory?.quantityOnHand ?? 0;
            if (currentWh < unsold) {
              throw new StockConflict(
                `Cannot reactivate stall: Product '${allocation.product.name}' has only ${currentWh} units in warehouse, but ${unsold} were returned upon closure. Please review and update allocations to reopen with available stock.`
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
    } else if (Array.isArray(allocations)) {
      // Event was ACTIVE (not closed). Apply allocation deltas atomically
      for (const alloc of allocations) {
        const rawQty = alloc.allocatedQty === undefined || alloc.allocatedQty === null || alloc.allocatedQty === '' ? 0 : alloc.allocatedQty;
        const newAllocatedQty = nonnegativeInteger(rawQty, `Allocation for ${alloc.productId}`);
        const consumedQty = consumed.get(alloc.productId) || 0;

        if (newAllocatedQty < consumedQty) {
          const existingAlloc = event.allocations.find(a => a.productId === alloc.productId);
          const prodName = existingAlloc?.product?.name || alloc.productId;
          throw new StockConflict(
            `Cannot reduce allocation for '${prodName}' below already sold quantity of ${consumedQty} units.`
          );
        }

        const existingAlloc = event.allocations.find(a => a.productId === alloc.productId);
        const oldQty = existingAlloc ? existingAlloc.allocatedQty : 0;
        const delta = newAllocatedQty - oldQty;

        if (delta > 0) {
          // Pull additional units from warehouse
          const inv = await tx.inventory.findUnique({ where: { productId: alloc.productId } });
          const currentWh = inv?.quantityOnHand ?? 0;
          if (currentWh < delta) {
            throw new StockConflict(
              `Insufficient warehouse stock for ${alloc.productId}. Needed +${delta}, available: ${currentWh}.`
            );
          }
          await tx.inventory.update({
            where: { productId: alloc.productId },
            data: {
              quantityOnHand: { decrement: delta },
              notes: `Increased stall allocation for '${event.name}' by ${delta} units`,
              lastUpdated: new Date(),
            },
          });
        } else if (delta < 0) {
          // Return excess active units to warehouse
          const returnQty = Math.abs(delta);
          await tx.inventory.update({
            where: { productId: alloc.productId },
            data: {
              quantityOnHand: { increment: returnQty },
              notes: `Returned ${returnQty} active units from stall '${event.name}' to warehouse`,
              lastUpdated: new Date(),
            },
          });
        }

        const rawPrice = alloc.priceAtEvent !== undefined && alloc.priceAtEvent !== null && alloc.priceAtEvent !== ''
          ? moneyCents(alloc.priceAtEvent) / 100
          : (existingAlloc ? Number(existingAlloc.priceAtEvent) : 0);

        if (existingAlloc) {
          await tx.eventAllocation.update({
            where: { id: existingAlloc.id },
            data: { allocatedQty: newAllocatedQty, priceAtEvent: rawPrice, updatedAt: new Date() },
          });
        } else {
          const inv = await tx.inventory.findUnique({ where: { productId: alloc.productId }, include: { product: true } });
          await tx.eventAllocation.create({
            data: {
              eventId,
              productId: alloc.productId,
              allocatedQty: newAllocatedQty,
              priceAtEvent: rawPrice || Number(inv?.product?.basePrice || 0),
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

  broadcast('event:updated', { eventId, action: result.reactivated ? 'reopened' : 'deadline_extended', newEndDatetime: result.newEndDatetime });
  if (result.reactivated) {
    broadcast('event:status_changed', { eventId, status: 'ACTIVE' });
    broadcast('inventory:updated', { eventId, action: 'stall_reopened' });
  }

  return result;
}
