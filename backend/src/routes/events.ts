import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { broadcast } from '../sockets';
import { EventStatus, Role } from '@prisma/client';

const router = Router();

// GET /api/events: List events with live allocation & sales metrics
router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
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
          if (!salesByProduct[s.productId]) {
            salesByProduct[s.productId] = { count: 0, revenue: 0 };
          }
          salesByProduct[s.productId].count += s.quantity;
          salesByProduct[s.productId].revenue += Number(s.totalAmount);
          totalSold += s.quantity;
          totalRevenue += Number(s.totalAmount);
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

        return {
          id: event.id,
          name: event.name,
          location: event.location,
          startDatetime: event.startDatetime,
          endDatetime: event.endDatetime,
          status: event.status,
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
        salesByProduct[s.productId] = (salesByProduct[s.productId] || 0) + s.quantity;
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

      res.json({
        event: {
          ...event,
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

    try {
      const validAllocations = Array.isArray(allocations) ? allocations : [];

      // Validate stock availability in main inventory for each allocation
      for (const alloc of validAllocations) {
        const qty = parseInt(alloc.allocatedQty, 10) || 0;
        if (qty > 0) {
          const inv = await prisma.inventory.findUnique({
            where: { productId: alloc.productId },
            include: { product: true },
          });

          if (!inv || inv.quantityOnHand < qty) {
            res.status(400).json({
              error: `Insufficient inventory for ${inv?.product.name || alloc.productId}. Available: ${inv?.quantityOnHand || 0}, Requested: ${qty}`,
            });
            return;
          }
        }
      }

      // Execute in Prisma Transaction
      const result = await prisma.$transaction(async tx => {
        const newEvent = await tx.event.create({
          data: {
            name: name.trim(),
            location: location.trim(),
            startDatetime: new Date(startDatetime),
            endDatetime: new Date(endDatetime),
            status: status ? (status.toUpperCase() as EventStatus) : EventStatus.UPCOMING,
          },
        });

        for (const alloc of validAllocations) {
          const qty = parseInt(alloc.allocatedQty, 10) || 0;
          const price = parseFloat(alloc.priceAtEvent);

          if (qty > 0 && !isNaN(price) && price >= 0) {
            await tx.eventAllocation.create({
              data: {
                eventId: newEvent.id,
                productId: alloc.productId,
                allocatedQty: qty,
                priceAtEvent: price,
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
    } catch (error) {
      console.error('Create event error:', error);
      res.status(500).json({ error: 'Failed to create event' });
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
          sales: true,
        },
      });

      if (!existingEvent) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }

      if (existingEvent.status === EventStatus.ENDED && status !== EventStatus.ACTIVE) {
        res.status(400).json({ error: 'Cannot modify ended events' });
        return;
      }

      // Group sales count by product for this event
      const salesByProduct: Record<string, number> = {};
      for (const s of existingEvent.sales) {
        salesByProduct[s.productId] = (salesByProduct[s.productId] || 0) + s.quantity;
      }

      // Handle allocations update in transaction
      await prisma.$transaction(async tx => {
        await tx.event.update({
          where: { id },
          data: {
            name: name ? name.trim() : undefined,
            location: location ? location.trim() : undefined,
            startDatetime: startDatetime ? new Date(startDatetime) : undefined,
            endDatetime: endDatetime ? new Date(endDatetime) : undefined,
            status: status ? (status.toUpperCase() as EventStatus) : undefined,
          },
        });

        if (Array.isArray(allocations)) {
          for (const alloc of allocations) {
            const newQty = parseInt(alloc.allocatedQty, 10) || 0;
            const newPrice = parseFloat(alloc.priceAtEvent);
            const soldSoFar = salesByProduct[alloc.productId] || 0;

            if (newQty < soldSoFar) {
              throw new Error(
                `Cannot reduce allocation for product ${alloc.productId} to ${newQty} because ${soldSoFar} units have already been sold at this event.`
              );
            }

            const existingAlloc = existingEvent.allocations.find(
              a => a.productId === alloc.productId
            );

            if (existingAlloc) {
              const diff = newQty - existingAlloc.allocatedQty;
              if (diff > 0) {
                // Needs more from main inventory
                const inv = await tx.inventory.findUnique({ where: { productId: alloc.productId } });
                if (!inv || inv.quantityOnHand < diff) {
                  throw new Error(
                    `Insufficient stock in main inventory to increase allocation by ${diff} units.`
                  );
                }
                await tx.inventory.update({
                  where: { productId: alloc.productId },
                  data: { quantityOnHand: { decrement: diff } },
                });
              } else if (diff < 0) {
                // Return stock to main inventory
                await tx.inventory.update({
                  where: { productId: alloc.productId },
                  data: { quantityOnHand: { increment: Math.abs(diff) } },
                });
              }

              await tx.eventAllocation.update({
                where: { id: existingAlloc.id },
                data: {
                  allocatedQty: newQty,
                  priceAtEvent: !isNaN(newPrice) ? newPrice : existingAlloc.priceAtEvent,
                },
              });
            } else if (newQty > 0) {
              // Brand new allocation for this event
              const inv = await tx.inventory.findUnique({ where: { productId: alloc.productId } });
              if (!inv || inv.quantityOnHand < newQty) {
                throw new Error(`Insufficient main stock for product ${alloc.productId}.`);
              }

              await tx.inventory.update({
                where: { productId: alloc.productId },
                data: { quantityOnHand: { decrement: newQty } },
              });

              await tx.eventAllocation.create({
                data: {
                  eventId: id,
                  productId: alloc.productId,
                  allocatedQty: newQty,
                  priceAtEvent: !isNaN(newPrice) ? newPrice : 0,
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

      if (event.status === EventStatus.ENDED) {
        res.status(400).json({ error: 'Event has already been finalized and ended.' });
        return;
      }

      // Count sold quantities
      const soldMap: Record<string, number> = {};
      for (const sale of event.sales) {
        soldMap[sale.productId] = (soldMap[sale.productId] || 0) + sale.quantity;
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

        // Mark event as ENDED
        await tx.event.update({
          where: { id },
          data: {
            status: EventStatus.ENDED,
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

export default router;
