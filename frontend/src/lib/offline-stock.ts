import { AppEvent, QueuedSale } from '../types';
export function withUnconfirmedStock(events: AppEvent[], operations: QueuedSale[]): AppEvent[] {
  return events.map(event => ({ ...event, allocations: event.allocations.map(allocation => {
    const pendingQty = operations.filter(operation => operation.eventId === event.id && operation.syncStatus !== 'committed')
      .reduce((quantity, operation) => quantity + (operation.items || (operation.productId ? [{ productId: operation.productId, quantity: operation.quantity || 0 }] : []))
        .filter(item => item.productId === allocation.productId).reduce((sum, item) => sum + item.quantity, 0), 0);
    return { ...allocation, pendingQty, remainingQty: Math.max(0, allocation.remainingQty - pendingQty) };
  }) }));
}
