import { api } from './api';
import { getPendingSales, getPendingSalesCount, removeSyncedSales, queueOfflineSale } from './db';
import { QueuedSale } from '../types';

type SyncListener = (state: { isOnline: boolean; pendingCount: number; isSyncing: boolean }) => void;

class SyncManager {
  private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isSyncing: boolean = false;
  private pendingCount: number = 0;
  private listeners: Set<SyncListener> = new Set();
  private intervalId: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.notify();
        this.triggerSync();
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
        this.notify();
      });

      // Periodic check every 12 seconds
      this.intervalId = setInterval(() => {
        if (this.isOnline && !this.isSyncing) {
          this.triggerSync();
        }
      }, 12000);

      // Initial count refresh
      this.refreshCount();
    }
  }

  public subscribe(listener: SyncListener) {
    this.listeners.add(listener);
    listener({
      isOnline: this.isOnline,
      pendingCount: this.pendingCount,
      isSyncing: this.isSyncing,
    });
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener({
        isOnline: this.isOnline,
        pendingCount: this.pendingCount,
        isSyncing: this.isSyncing,
      });
    }
  }

  public async refreshCount(): Promise<number> {
    try {
      this.pendingCount = await getPendingSalesCount();
      this.notify();
      return this.pendingCount;
    } catch (e) {
      console.error('Failed to get pending sales count:', e);
      return 0;
    }
  }

  public async recordSale(saleData: Omit<QueuedSale, 'clientTxId' | 'queuedAt' | 'syncStatus'>): Promise<{ clientTxId: string; syncedImmediately: boolean }> {
    const clientTxId = crypto.randomUUID();
    const queuedSale: QueuedSale = {
      ...saleData,
      clientTxId,
      queuedAt: Date.now(),
      syncStatus: 'pending',
    };

    // 1. Write to local IndexedDB immediately
    await queueOfflineSale(queuedSale);
    await this.refreshCount();

    // 2. If online, attempt instant sync
    let syncedImmediately = false;
    if (this.isOnline) {
      try {
        const res = await api.post('/sales/sync', { sales: [queuedSale] });
        if (res?.results?.[0]?.status === 'success' || res?.results?.[0]?.status === 'already_synced') {
          await removeSyncedSales([clientTxId]);
          syncedImmediately = true;
          await this.refreshCount();
        }
      } catch (err) {
        console.warn('Instant sync attempt failed, queued in IndexedDB for retry:', err);
      }
    }

    return { clientTxId, syncedImmediately };
  }

  public async recordOrder(orderData: {
    eventId: string;
    eventName?: string;
    paymentMethod: any;
    customerName?: string;
    customerPhone?: string;
    saleTime: string;
    items: Array<{
      productId: string;
      productName: string;
      quantity: number;
      unitPrice: number;
      totalAmount: number;
    }>;
  }): Promise<{ orderId: string; syncedImmediately: boolean; count: number }> {
    const orderId = crypto.randomUUID();
    const queuedSales: QueuedSale[] = orderData.items.map((item, idx) => ({
      clientTxId: `${orderId}-${idx}-${item.productId}`,
      eventId: orderData.eventId,
      eventName: orderData.eventName,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalAmount: item.totalAmount,
      paymentMethod: orderData.paymentMethod,
      customerName: orderData.customerName,
      customerPhone: orderData.customerPhone,
      saleTime: orderData.saleTime,
      queuedAt: Date.now() + idx,
      syncStatus: 'pending',
    }));

    // 1. Write all items to local IndexedDB immediately
    for (const s of queuedSales) {
      await queueOfflineSale(s);
    }
    await this.refreshCount();

    // 2. If online, attempt instant sync for the entire order
    let syncedImmediately = false;
    if (this.isOnline) {
      try {
        const res = await api.post('/sales/sync', { sales: queuedSales });
        if (res && Array.isArray(res.results)) {
          const successIds = res.results
            .filter((r: any) => r.status === 'success' || r.status === 'already_synced')
            .map((r: any) => r.clientTxId);
          if (successIds.length > 0) {
            await removeSyncedSales(successIds);
            syncedImmediately = successIds.length === queuedSales.length;
            await this.refreshCount();
          }
        }
      } catch (err) {
        console.warn('Instant order sync attempt failed, queued in IndexedDB for retry:', err);
      }
    }

    return { orderId, syncedImmediately, count: queuedSales.length };
  }

  public async triggerSync(): Promise<void> {
    if (!this.isOnline || this.isSyncing) return;

    try {
      const pending = await getPendingSales();
      if (pending.length === 0) {
        this.pendingCount = 0;
        this.notify();
        return;
      }

      this.isSyncing = true;
      this.notify();

      const response = await api.post('/sales/sync', { sales: pending });

      if (response && Array.isArray(response.results)) {
        const successfulIds: string[] = [];
        for (const res of response.results) {
          if (res.status === 'success' || res.status === 'already_synced') {
            successfulIds.push(res.clientTxId);
          }
        }

        if (successfulIds.length > 0) {
          await removeSyncedSales(successfulIds);
        }
      }

      await this.refreshCount();
    } catch (error) {
      console.error('Background sync failed:', error);
    } finally {
      this.isSyncing = false;
      this.notify();
    }
  }

  public getStatus() {
    return {
      isOnline: this.isOnline,
      pendingCount: this.pendingCount,
      isSyncing: this.isSyncing,
    };
  }
}

export const syncManager = new SyncManager();
