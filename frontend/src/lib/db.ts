import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { QueuedSale, AppEvent } from '../types';

interface EnactusIMSDatabase extends DBSchema {
  offline_sales: { key: string; value: QueuedSale; indexes: { 'by-status': string; 'by-queued-at': number; 'by-event': string } };
  cached_events: { key: string; value: AppEvent };
}
// Keep the existing database, version, stores and keys. New fields are additive.
let dbPromise: Promise<IDBPDatabase<EnactusIMSDatabase>> | null = null;
export const getDB = () => {
  if (!dbPromise) dbPromise = openDB<EnactusIMSDatabase>('enactus_ims_offline_db', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('offline_sales')) {
        const store = db.createObjectStore('offline_sales', { keyPath: 'clientTxId' });
        store.createIndex('by-status', 'syncStatus'); store.createIndex('by-queued-at', 'queuedAt'); store.createIndex('by-event', 'eventId');
      }
      if (!db.objectStoreNames.contains('cached_events')) db.createObjectStore('cached_events', { keyPath: 'id' });
    },
  });
  return dbPromise;
};
export const getOfflineSale = async (id: string) => (await getDB()).get('offline_sales', id);
export const queueOfflineSale = async (sale: QueuedSale): Promise<void> => {
  const db = await getDB(); const tx = db.transaction('offline_sales', 'readwrite');
  // Never overwrite an existing operation or acknowledgement with a new payload.
  if (await tx.store.get(sale.clientTxId)) { await tx.done; throw new Error('Operation key already exists. Preserve the original operation.'); }
  await tx.store.add(sale); await tx.done;
};
export const getPreservedSales = async () => (await getDB()).getAll('offline_sales');
export const getAllQueuedSales = async () => (await getPreservedSales()).filter(s => s.syncStatus !== 'committed');
export const getPendingSales = async () => (await getAllQueuedSales()).filter(s => ['pending', 'processing', 'syncing'].includes(s.syncStatus));
export const getPendingSalesCount = async () => (await getPendingSales()).length;
export const getFailedSales = async () => (await getAllQueuedSales()).filter(s => ['failed', 'rejected', 'conflict'].includes(s.syncStatus));
export const getFailedSalesCount = async () => (await getFailedSales()).length;
export const updateOfflineSaleStatus = async (id: string, status: QueuedSale['syncStatus'], errorMessage?: string): Promise<void> => {
  const db = await getDB(); const tx = db.transaction('offline_sales', 'readwrite'); const sale = await tx.store.get(id);
  if (sale && sale.syncStatus !== 'committed') {
    await tx.store.put({ ...sale, syncStatus: status, errorMessage, lastAttemptAt: Date.now() });
  }
  await tx.done;
};
export const acknowledgeOfflineSale = async (id: string, acknowledgement: NonNullable<QueuedSale['acknowledgement']>): Promise<void> => {
  if (!Number.isSafeInteger(acknowledgement.saleId) || !Number.isSafeInteger(acknowledgement.receiptNumber) || acknowledgement.saleId < 1 || acknowledgement.receiptNumber < 1) {
    throw new Error('Invalid backend acknowledgement; operation retained.');
  }
  const db = await getDB(); const tx = db.transaction('offline_sales', 'readwrite'); const sale = await tx.store.get(id);
  if (sale) {
    if (sale.acknowledgement && (sale.acknowledgement.saleId !== acknowledgement.saleId || sale.acknowledgement.receiptNumber !== acknowledgement.receiptNumber)) {
      await tx.done; throw new Error('Conflicting acknowledgement; original receipt retained.');
    }
    await tx.store.put({ ...sale, syncStatus: 'committed', acknowledgement, lastAttemptAt: Date.now(), errorMessage: undefined });
  }
  await tx.done;
};
// Retain legacy function names for callers, but never erase pending or historical payloads.
export const deleteOfflineSale = async (id: string) => updateOfflineSaleStatus(id, 'conflict', 'Preserved for reconciliation; discarding is disabled.');
export const clearFailedOfflineSales = async (): Promise<void> => { throw new Error('Failed transactions must be preserved for reconciliation.'); };
export const retryFailedOfflineSales = async (ownerUserId?: string): Promise<void> => {
  for (const sale of await getFailedSales()) {
    if (ownerUserId && sale.ownerUserId === ownerUserId && sale.syncStatus !== 'conflict') await updateOfflineSaleStatus(sale.clientTxId, 'pending');
  }
};
export const cacheEvents = async (events: AppEvent[]): Promise<void> => {
  const db = await getDB(); const tx = db.transaction('cached_events', 'readwrite');
  for (const event of events) await tx.store.put(event);
  await tx.done;
};
export const getCachedEvents = async (): Promise<AppEvent[]> => (await getDB()).getAll('cached_events');
