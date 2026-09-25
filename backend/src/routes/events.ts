import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requirePermission, requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { broadcast } from '../sockets';
import { EventStatus, Role } from '@prisma/client';
import {
  computeEventStatus,
  reconcileSingleEvent,
  reconcileAllExpiredEvents,
} from '../services/eventLifecycle';

const router = Router();

// GET /api/events: List events with live allocation & sales metrics
router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      // Reconcile any expired events first so status is 100% authoritative
      await reconcileAllExpiredEvents();

      const events = await prisma.event.findMany({
        where: { isDeleted: false },
        include: {
          allocations: {
            include: {
              product: {
                include: { project: true },
              },
            },
          },
          sales: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              totalAmount: true,
              items: {
                select: {
                  productId: true,
                  quantity: true,
                  lineTotal: true,
                },
              },
            },
          },
        },
        orderBy: { startDatetime: 'desc' },
      });

      const formatted = events.map(event => {
        // Group sales by product
        const salesByProduct: Record<string, { count: number; revenue: number }> = {};
        let totalRevenue = 0;
        let totalSold = 0;

        for (const s of event.sales) {
          totalRevenue += Number(s.totalAmount);
          if (s.items && s.items.length > 0) {
            for (const item of s.items) {
              if (!salesByProduct[item.productId]) {
                salesByProduct[item.productId] = { count: 0, revenue: 0 };
              }
              salesByProduct[item.productId].count += item.quantity;
              salesByProduct[item.productId].revenue += Number(item.lineTotal);
              totalSold += item.quantity;
            }
          } else if (s.productId && s.quantity) {
            if (!salesByProduct[s.productId]) {
              salesByProduct[s.productId] = { count: 0, revenue: 0 };
            }
            salesByProduct[s.productId].count += s.quantity;
            salesByProduct[s.productId].revenue += Number(s.totalAmount);
            totalSold += s.quantity;
          }
        }

        const enrichedAllocations = event.allocations.map(alloc => {
          const sold = salesByProduct[alloc.productId]?.count || 0;
          const remaining = Math.max(0, alloc.allocatedQty - sold);
          return {
            id: alloc.id,
            productId: alloc.productId,
            productName: alloc.product.name,
            projectName: alloc.product.project.name,
            allocatedQty: alloc.allocatedQty,
            soldQty: sold,
            remainingQty: remaining,
            priceAtEvent: alloc.priceAtEvent,
          };
        });

        const totalAllocated = enrichedAllocations.reduce((sum, a) => sum + a.allocatedQty, 0);

        const computedStatus = computeEventStatus(event.startDatetime, event.endDatetime, event.status);

        return {
          id: event.id,
          name: event.name,
          location: event.location,
          startDatetime: event.startDatetime,
          endDatetime: event.endDatetime,
          status: computedStatus,
          reconciledAt: event.reconciledAt,
          totalAllocated,
          totalSold,
          totalRemaining: Math.max(0, totalAllocated - totalSold),
          totalRevenue,
          allocations: enrichedAllocations,
          createdAt: event.createdAt,
        };
      });

      res.json({ events: formatted });
    } catch (error) {
      console.error('Fetch events error:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  }
);

// GET /api/events/:id: Single event details
router.get(
  '/:id',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      // Reconcile status/inventory if expired
      await reconcileSingleEvent(id);

      const event = await prisma.event.findUnique({
        where: { id },
        include: {
          allocations: {
            include: {
              product: {
                include: { project: true },
              },
            },
          },
          sales: {
            include: {
              items: true,
              product: true,
              member: { select: { id: true, name: true } },
            },
            orderBy: { saleTime: 'desc' },
          },
        },
      });

      if (!event || event.isDeleted) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }

      // Group sales by product
      const salesByProduct: Record<string, number> = {};
      for (const s of event.sales) {
        if (s.items && s.items.length > 0) {
          for (const item of s.items) {
            salesByProduct[item.productId] = (salesByProduct[item.productId] || 0) + item.quantity;
          }
        } else if (s.productId) {
          salesByProduct[s.productId] = (salesByProduct[s.productId] || 0) + (s.quantity || 1);
        }
      }

      const enrichedAllocations = event.allocations.map(alloc => {
        const sold = salesByProduct[alloc.productId] || 0;
        return {
          id: alloc.id,
          productId: alloc.productId,
          productName: alloc.product.name,
          projectName: alloc.product.project.name,
          allocatedQty: alloc.allocatedQty,
          soldQty: sold,
          remainingQty: Math.max(0, alloc.allocatedQty - sold),
          priceAtEvent: alloc.priceAtEvent,
        };
      });

      const computedStatus = computeEventStatus(event.startDatetime, event.endDatetime, event.status);

      res.json({
        event: {
          ...event,
          status: computedStatus,
          allocations: enrichedAllocations,
        },
      });
    } catch (error) {
      console.error('Fetch event details error:', error);
      res.status(500).json({ error: 'Failed to fetch event details' });
    }
  }
);

// POST /api/events: Create Event with inline allocations and prices
router.post(
  '/',
  authenticateToken,
  requirePermission('edit_events'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { name, location, startDatetime, endDatetime, status, allocations } = req.body;

    if (!name || !location || !startDatetime || !endDatetime) {
      res.status(400).json({ error: 'Name, location, start date/time, and end date/time are required' });
      return;
    }

    const parsedStart = new Date(startDatetime);
    const parsedEnd = new Date(endDatetime);

    if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
      res.status(400).json({ error: 'Valid start date/time and end date/time are required' });
      return;
    }

    if (parsedEnd.getTime() <= parsedStart.getTime()) {
      res.status(400).json({ error: 'End date and time must be after the start date and time.' });
      return;
    }

    const initialStatus = computeEventStatus(
      parsedStart,
      parsedEnd,
      status ? (status.toUpperCase() as EventStatus) : undefined
    );

    try {
      const validAllocations = Array.isArray(allocations) ? allocations : [];

      // Execute in Prisma Transaction
      const result = await prisma.$transaction(async tx => {
        const newEvent = await tx.event.create({
          data: {
            name: name.trim(),
            location: location.trim(),
            startDatetime: parsedStart,
            endDatetime: parsedEnd,
            status: initialStatus,
          },
        });

        for (const alloc of validAllocations) {
          const qty = parseInt(alloc.allocatedQty, 10) || 0;
          const price = parseFloat(alloc.priceAtEvent);

          if (qty < 0) {
            throw new Error(`Allocated quantity cannot be negative for product ${alloc.productId}.`);
          }

          if (qty > 0) {
            const inv = await tx.inventory.findUnique({
              where: { productId: alloc.productId },
              include: { product: true },
            });

            if (!inv || inv.quantityOnHand < qty) {
              const avail = inv ? inv.quantityOnHand : 0;
              const prodName = inv?.product?.name || alloc.productId;
              throw new Error(
                `Inventory changed while you were creating this event. Only ${avail} units are currently available for ${prodName}. Please review the allocation.`
              );
            }

            await tx.eventAllocation.create({
              data: {
                eventId: newEvent.id,
                productId: alloc.productId,
                allocatedQty: qty,
                priceAtEvent: !isNaN(price) && price >= 0 ? price : 0,
              },
            });

            // Decrement main inventory
            await tx.inventory.update({
              where: { productId: alloc.productId },
              data: {
                quantityOnHand: { decrement: qty },
                lastUpdated: new Date(),
              },
            });
          }
        }

        return newEvent;
      });

      // Broadcast changes
      broadcast('event:updated', { eventId: result.id, action: 'created' });
      broadcast('inventory:updated', { action: 'event_allocated', eventId: result.id });

      res.status(201).json({ event: result });
    } catch (error: any) {
      console.error('Create event error:', error);
      res.status(400).json({ error: error.message || 'Failed to create event' });
    }
  }
);

// PUT /api/events/:id: Update Event details, allocations, and pricing
router.put(
  '/:id',
  authenticateToken,
  requirePermission('edit_events'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, location, startDatetime, endDatetime, status, allocations } = req.body;

    try {
      const existingEvent = await prisma.event.findUnique({
        where: { id },
        include: {
          allocations: true,
          sales: {
            include: { items: true },
          },
        },
      });

      if (!existingEvent) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }

      const parsedStart = startDatetime ? new Date(startDatetime) : existingEvent.startDatetime;
      const parsedEnd = endDatetime ? new Date(endDatetime) : existingEvent.endDatetime;

      if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
        res.status(400).json({ error: 'Valid start date/time and end date/time are required' });
        return;
      }

      if (parsedEnd.getTime() <= parsedStart.getTime()) {
        res.status(400).json({ error: 'End date and time must be after the start date and time.' });
        return;
      }

      // For ENDED/finalized events: do NOT automatically reopen or change status
      const isAlreadyEnded = existingEvent.status === EventStatus.ENDED;
      const computedStatus = isAlreadyEnded
        ? EventStatus.ENDED
        : computeEventStatus(
            parsedStart,
            parsedEnd,
            status ? (status.toUpperCase() as EventStatus) : existingEvent.status
          );

      // Group sales count by product for this event
      const salesByProduct: Record<string, number> = {};
      for (const s of existingEvent.sales) {
        if (s.items && s.items.length > 0) {
          for (const item of s.items) {
            salesByProduct[item.productId] = (salesByProduct[item.productId] || 0) + item.quantity;
          }
        } else if (s.productId) {
          salesByProduct[s.productId] = (salesByProduct[s.productId] || 0) + (s.quantity || 1);
        }
      }

      // Handle allocations update in transaction
      await prisma.$transaction(async tx => {
        await tx.event.update({
          where: { id },
          data: {
            name: name ? name.trim() : undefined,
            location: location ? location.trim() : undefined,
            startDatetime: parsedStart,
            endDatetime: parsedEnd,
            status: computedStatus,
          },
        });

        if (Array.isArray(allocations)) {
          for (const alloc of allocations) {
            const newQty = parseInt(alloc.allocatedQty, 10) || 0;
            const newPrice = parseFloat(alloc.priceAtEvent);
            const soldSoFar = salesByProduct[alloc.productId] || 0;

            if (newQty < 0) {
              throw new Error(`Allocated quantity cannot be negative for product ${alloc.productId}.`);
            }

            if (newQty < soldSoFar) {
              throw new Error(
                `Allocation cannot be lower than the quantity already sold. Product has already sold ${soldSoFar} unit(s).`
              );
            }

            const existingAlloc = existingEvent.allocations.find(
              a => a.productId === alloc.productId
            );

            if (existingAlloc) {
              const diff = newQty - existingAlloc.allocatedQty;
              if (diff > 0) {
                // Needs more from main inventory
                const inv = await tx.inventory.findUnique({
                  where: { productId: alloc.productId },
                  include: { product: true },
                });
                if (!inv || inv.quantityOnHand < diff) {
                  const avail = inv ? inv.quantityOnHand : 0;
                  const prodName = inv?.product?.name || alloc.productId;
                  throw new Error(
                    `Inventory changed while you were updating this event. Only ${avail} units are currently available in main inventory for ${prodName}. Please review the allocation.`
                  );
                }
                await tx.inventory.update({
                  where: { productId: alloc.productId },
                  data: {
                    quantityOnHand: { decrement: diff },
                    lastUpdated: new Date(),
                  },
                });
              } else if (diff < 0) {
                // Return stock to main inventory for active/upcoming events
                // (for ended events, unsold stock was already returned to main inventory upon ending)
                if (!isAlreadyEnded) {
                  await tx.inventory.update({
                    where: { productId: alloc.productId },
                    data: {
                      quantityOnHand: { increment: Math.abs(diff) },
                      lastUpdated: new Date(),
                    },
                  });
                }
              }

              await tx.eventAllocation.update({
                where: { id: existingAlloc.id },
                data: {
                  allocatedQty: newQty,
                  priceAtEvent: !isNaN(newPrice) && newPrice >= 0 ? newPrice : existingAlloc.priceAtEvent,
                },
              });
            } else if (newQty > 0) {
              // Brand new allocation for this event
              const inv = await tx.inventory.findUnique({
                where: { productId: alloc.productId },
                include: { product: true },
              });
              if (!inv || inv.quantityOnHand < newQty) {
                const avail = inv ? inv.quantityOnHand : 0;
                const prodName = inv?.product?.name || alloc.productId;
                throw new Error(
                  `Inventory changed while you were updating this event. Only ${avail} units are currently available in main inventory for ${prodName}. Please review the allocation.`
                );
              }

              await tx.inventory.update({
                where: { productId: alloc.productId },
                data: {
                  quantityOnHand: { decrement: newQty },
                  lastUpdated: new Date(),
                },
              });

              await tx.eventAllocation.create({
                data: {
                  eventId: id,
                  productId: alloc.productId,
                  allocatedQty: newQty,
                  priceAtEvent: !isNaN(newPrice) && newPrice >= 0 ? newPrice : 0,
                },
              });
            }
          }
        }
      });

      broadcast('event:updated', { eventId: id, action: 'updated' });
      broadcast('inventory:updated', { action: 'event_allocation_changed', eventId: id });

      res.json({ message: 'Event updated successfully' });
    } catch (error: any) {
      console.error('Update event error:', error);
      res.status(400).json({ error: error.message || 'Failed to update event' });
    }
  }
);

// POST /api/events/:id/end: "End Event" action - returns unsold stock to main inventory!
router.post(
  '/:id/end',
  authenticateToken,
  requirePermission('edit_events'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      const event = await prisma.event.findUnique({
        where: { id },
        include: {
          allocations: {
            include: { product: true },
          },
          sales: true,
        },
      });

      if (!event) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }

      if (event.status === EventStatus.ENDED && event.reconciledAt) {
        res.status(400).json({ error: 'Event has already been finalized and ended.' });
        return;
      }

      // Count sold quantities from sale_items
      const soldMap: Record<string, number> = {};
      const soldItems = await prisma.saleItem.groupBy({
        by: ['productId'],
        where: { sale: { eventId: id } },
        _sum: { quantity: true },
      });
      for (const item of soldItems) {
        soldMap[item.productId] = (soldMap[item.productId] || 0) + (item._sum.quantity || 0);
      }

      // Return unsold quantities to main inventory
      const returnedItems: { productId: string; productName: string; returnedQty: number }[] = [];

      await prisma.$transaction(async tx => {
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

            returnedItems.push({
              productId: alloc.productId,
              productName: alloc.product.name,
              returnedQty: unsold,
            });
          }
        }

        // Mark event as ENDED and set reconciledAt
        await tx.event.update({
          where: { id },
          data: {
            status: EventStatus.ENDED,
            reconciledAt: new Date(),
          },
        });
      });

      // Real-time broadcasts
      broadcast('event:updated', { eventId: id, action: 'ended' });
      broadcast('inventory:updated', { action: 'event_ended_stock_returned', eventId: id });

      res.json({
        message: `Event '${event.name}' successfully ended. Unsold stock returned to main inventory.`,
        returnedItems,
      });
    } catch (error) {
      console.error('End event error:', error);
      res.status(500).json({ error: 'Failed to end event' });
    }
  }
);

// DELETE /api/events/:id: Delete an event (DEVELOPER or ADMIN)
router.delete(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      const event = await prisma.event.findUnique({
        where: { id },
        include: {
          allocations: true,
          sales: { select: { id: true } },
        },
      });

      if (!event) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }

      // If event is not ENDED, return any unsold allocated stock back to main inventory
      if (event.status !== EventStatus.ENDED) {
        const salesCount = await prisma.saleItem.groupBy({
          by: ['productId'],
          where: { sale: { eventId: id } },
          _sum: { quantity: true },
        });

        const salesByProduct: Record<string, number> = {};
        for (const s of salesCount) {
          salesByProduct[s.productId] = s._sum.quantity || 0;
        }

        for (const alloc of event.allocations) {
          const sold = salesByProduct[alloc.productId] || 0;
          const unsold = Math.max(0, alloc.allocatedQty - sold);
          if (unsold > 0) {
            await prisma.inventory.update({
              where: { productId: alloc.productId },
              data: {
                quantityOnHand: { increment: unsold },
                lastUpdated: new Date(),
              },
            });
          }
        }
      }

      // In a transaction, cleanly delete all event dependencies and the event
      await prisma.$transaction(async tx => {
        // 1. Unbind any game associated with this event
        await tx.game.updateMany({
          where: { eventId: id },
          data: { eventId: null },
        });

        // 2. Delete game sessions associated with this event
        await tx.gameSession.deleteMany({
          where: { eventId: id },
        });

        // 3. Delete sales items and sales associated with this event
        await tx.saleItem.deleteMany({
          where: { sale: { eventId: id } },
        });
        await tx.sale.deleteMany({
          where: { eventId: id },
        });

        // 4. Delete event allocations
        await tx.eventAllocation.deleteMany({
          where: { eventId: id },
        });

        // 5. Delete the event record
        await tx.event.delete({
          where: { id },
        });
      });

      broadcast('event:updated', { eventId: id, action: 'deleted' });
      broadcast('inventory:updated', { action: 'event_deleted', eventId: id });

      res.json({ message: `Event '${event.name}' deleted successfully` });
    } catch (error: any) {
      console.error('Delete event error:', error);
      res.status(500).json({ error: error?.message || 'Failed to delete event' });
    }
  }
);

export default router;
