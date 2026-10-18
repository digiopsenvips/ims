import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { QueuedSale, AppEvent } from '../types';

interface EnactusIMSDatabase extends DBSchema {
  offline_sales: {
    key: string;
    value: QueuedSale;
    indexes: {
      'by-status': string;
      'by-queued-at': number;
      'by-event': string;
    };
  };
  cached_events: {
    key: string;
    value: AppEvent;
  };
}

const DB_NAME = 'enactus_ims_offline_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<EnactusIMSDatabase>> | null = null;

export const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<EnactusIMSDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('offline_sales')) {
          const salesStore = db.createObjectStore('offline_sales', { keyPath: 'clientTxId' });
          salesStore.createIndex('by-status', 'syncStatus');
          salesStore.createIndex('by-queued-at', 'queuedAt');
          salesStore.createIndex('by-event', 'eventId');
        }

        if (!db.objectStoreNames.contains('cached_events')) {
          db.createObjectStore('cached_events', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

// Queue a new sale locally
export const queueOfflineSale = async (sale: QueuedSale): Promise<void> => {
  const db = await getDB();
  await db.put('offline_sales', sale);
};

// Get all pending sales awaiting sync
export const getPendingSales = async (): Promise<QueuedSale[]> => {
  const db = await getDB();
  return db.getAllFromIndex('offline_sales', 'by-status', 'pending');
};

// Get total count of pending sales
export const getPendingSalesCount = async (): Promise<number> => {
  const db = await getDB();
  return db.countFromIndex('offline_sales', 'by-status', 'pending');
};

// Get all sales with 'failed' status
export const getFailedSales = async (): Promise<QueuedSale[]> => {
  const db = await getDB();
  return db.getAllFromIndex('offline_sales', 'by-status', 'failed');
};

// Get total count of failed sales
export const getFailedSalesCount = async (): Promise<number> => {
  const db = await getDB();
  return db.countFromIndex('offline_sales', 'by-status', 'failed');
};

// Get all queued sales regardless of status
export const getAllQueuedSales = async (): Promise<QueuedSale[]> => {
  const db = await getDB();
  return db.getAll('offline_sales');
};

// Update status of an individual offline sale
export const updateOfflineSaleStatus = async (
  clientTxId: string,
  status: 'pending' | 'syncing' | 'failed',
  errorMessage?: string
): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction('offline_sales', 'readwrite');
  const record = await tx.store.get(clientTxId);
  if (record) {
    record.syncStatus = status;
    if (errorMessage !== undefined) {
      (record as any).errorMessage = errorMessage;
    }
    (record as any).lastAttemptAt = Date.now();
    await tx.store.put(record);
  }
  await tx.done;
};

// Delete a single offline sale
export const deleteOfflineSale = async (clientTxId: string): Promise<void> => {
  const db = await getDB();
  await db.delete('offline_sales', clientTxId);
};

// Clear all failed offline sales
export const clearFailedOfflineSales = async (): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction('offline_sales', 'readwrite');
  const failed = await tx.store.index('by-status').getAll('failed');
  for (const item of failed) {
    await tx.store.delete(item.clientTxId);
  }
  await tx.done;
};

// Reset all failed sales back to pending for retry
export const retryFailedOfflineSales = async (): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction('offline_sales', 'readwrite');
  const failed = await tx.store.index('by-status').getAll('failed');
  for (const item of failed) {
    item.syncStatus = 'pending';
    delete (item as any).errorMessage;
    await tx.store.put(item);
  }
  await tx.done;
};

// Mark sales as synced or delete them
export const removeSyncedSales = async (clientTxIds: string[]): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction('offline_sales', 'readwrite');
  for (const id of clientTxIds) {
    await tx.store.delete(id);
  }
  await tx.done;
};

// Cache active events for offline selection
export const cacheEvents = async (events: AppEvent[]): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction('cached_events', 'readwrite');
  await tx.store.clear();
  for (const event of events) {
    await tx.store.put(event);
  }
  await tx.done;
};

export const getCachedEvents = async (): Promise<AppEvent[]> => {
  const db = await getDB();
  return db.getAll('cached_events');
};
