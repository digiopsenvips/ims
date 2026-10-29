import { prisma } from '../config/prisma';
import { eventConsumption } from './stock';

export async function eventAvailability(eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { allocations: { include: { product: true } } } });
  const consumed = await eventConsumption(prisma, eventId);
  const result = new Map<string, { stock: number; price: number; projectId: string }>();
  for (const allocation of event?.allocations || []) {
    const eligible = !event?.isDeleted && !event?.reconciledAt && event?.status !== 'ENDED' &&
      !allocation.product.isDeleted && !allocation.product.isArchived;
    result.set(allocation.productId, {
      stock: eligible ? Math.max(0, allocation.allocatedQty - (consumed.get(allocation.productId) || 0)) : 0,
      price: Number(allocation.priceAtEvent), projectId: allocation.product.projectId,
    });
  }
  return result;
}
