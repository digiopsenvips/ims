export type OfflineSalePaymentMethod = 'CASH' | 'UPI';

export interface OfflineQueuedSale {
  id: string;
  payload: {
    eventId: string | null;
    productId: string;
    quantity: number;
    customerName: string;
    customerPhone: string;
    paymentMethod: OfflineSalePaymentMethod;
  };
  createdAt: string;
}

const DB_NAME = 'enactus-ims';
const STORE_NAME = 'offline-sales';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open offline queue database.'));
  });
}

export async function queueOfflineSale(payload: OfflineQueuedSale['payload']) {
  const queued = {
    id: crypto.randomUUID(),
    payload,
    createdAt: new Date().toISOString(),
  } satisfies OfflineQueuedSale;

  const db = await openDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(queued);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to queue offline sale.'));
  });
}

export async function listOfflineSales(): Promise<OfflineQueuedSale[]> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve((request.result as OfflineQueuedSale[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error('Failed to read offline sales.'));
  });
}

export async function removeOfflineSale(id: string) {
  const db = await openDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to remove queued sale.'));
  });
}

export async function syncQueuedSales(flushFn: (payload: OfflineQueuedSale['payload']) => Promise<unknown>) {
  if (typeof window === 'undefined' || !navigator.onLine) {
    return;
  }

  const queuedSales = await listOfflineSales();

  for (const queuedSale of queuedSales) {
    try {
      await flushFn(queuedSale.payload);
      await removeOfflineSale(queuedSale.id);
    } catch {
      // Keep the queued item until the server accepts it.
    }
  }
}
