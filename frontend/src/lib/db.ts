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
