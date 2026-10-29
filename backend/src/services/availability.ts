import { prisma } from '../config/prisma';
import { eventConsumption } from './stock';

export async function eventAvailability(eventId: string) {
  const event = await prisma.event.findUnique({
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
  const consumed = await eventConsumption(prisma, eventId);
  const result = new Map<string, {
    stock: number;
    stallStock: number;
    warehouseStock: number;
    usableStock: number;
    price: number;
    projectId: string;
  }>();

  for (const allocation of event?.allocations || []) {
    const eligible = !event?.isDeleted && !event?.reconciledAt && event?.status !== 'ENDED' &&
      !allocation.product.isDeleted && !allocation.product.isArchived;
    const stallStock = eligible ? Math.max(0, allocation.allocatedQty - (consumed.get(allocation.productId) || 0)) : 0;
    const warehouseStock = eligible ? Math.max(0, allocation.product.inventory?.quantityOnHand ?? 0) : 0;
    const usableStock = stallStock + warehouseStock;

    result.set(allocation.productId, {
      stock: stallStock,
      stallStock,
      warehouseStock,
      usableStock,
      price: Number(allocation.priceAtEvent),
      projectId: allocation.product.projectId,
    });
  }
  return result;
}
