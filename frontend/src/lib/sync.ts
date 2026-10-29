import { api, ApiError } from './api';
import { getPendingSales, getPendingSalesCount, getFailedSalesCount, updateOfflineSaleStatus,
  acknowledgeOfflineSale, queueOfflineSale, retryFailedOfflineSales, getOfflineSale } from './db';
import { QueuedSale } from '../types';

export interface SyncState { isOnline: boolean; pendingCount: number; failedCount: number; isSyncing: boolean; }
type SyncListener = (state: SyncState) => void;
function currentOwner(): string | null {
  try { return JSON.parse(localStorage.getItem('enactus_ims_user') || 'null')?.id || null; } catch { return null; }
}
class SyncManager {
  private state: SyncState = { isOnline: typeof navigator !== 'undefined' && navigator.onLine, pendingCount: 0, failedCount: 0, isSyncing: false };
  private listeners = new Set<SyncListener>();
  private processing = new Map<string, Promise<void>>();
  private syncing: Promise<void> | null = null;
  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { this.state.isOnline = true; this.notify(); void this.triggerSync(); });
      window.addEventListener('offline', () => { this.state.isOnline = false; this.notify(); });
      setInterval(() => { if (this.state.isOnline) void this.triggerSync(); }, 15000);
      void this.refreshCount();
    }
  }
  subscribe(listener: SyncListener) { this.listeners.add(listener); listener(this.getStatus()); return () => { this.listeners.delete(listener); }; }
  private notify() { for (const listener of this.listeners) listener(this.getStatus()); }
  getStatus(): SyncState { return { ...this.state }; }
  async refreshCount() {
    try { this.state.pendingCount = await getPendingSalesCount(); this.state.failedCount = await getFailedSalesCount(); }
    catch (error) { console.error('Unable to read preserved sync state:', error); }
    this.notify(); return { pending: this.state.pendingCount, failed: this.state.failedCount };
  }
  private async sendOperation(sale: QueuedSale): Promise<void> {
    const existing = this.processing.get(sale.clientTxId); if (existing) return existing;
    const work = (async () => {
      const saved = await getOfflineSale(sale.clientTxId);
      if (!saved || saved.syncStatus === 'committed') return;
      if (sale.ownerUserId && sale.ownerUserId !== currentOwner()) return;
      if (!sale.ownerUserId) {
        await updateOfflineSaleStatus(sale.clientTxId, 'conflict', 'Original seller is missing or differs from this login. Preserved for review; not replayed.'); return;
      }
      if (!this.state.isOnline || !localStorage.getItem('enactus_ims_token')) return;
      await updateOfflineSaleStatus(sale.clientTxId, 'processing');
      try {
        if (sale.transactionType === 'GAME') {
          const response = await api.post('/games/play', sale);
          if (!response?.receipt?.receiptNumber || !response?.saleId) throw new Error('Unconfirmed game response');
          await acknowledgeOfflineSale(sale.clientTxId, { saleId: response.saleId, receiptNumber: response.receipt.receiptNumber, receipt: response.receipt });
        } else {
          const response = await api.post('/sales/sync', { transactions: [sale] });
          const results = response?.results?.filter((r: any) => r.clientTxId === sale.clientTxId);
          if (!Array.isArray(results) || results.length !== 1) {
            await updateOfflineSaleStatus(sale.clientTxId, 'conflict', 'Ambiguous backend acknowledgement. Preserved for reconciliation.'); return;
          }
          const result = results[0];
          if (result.status === 'success' || result.status === 'already_synced') {
            await acknowledgeOfflineSale(sale.clientTxId, { saleId: result.saleId, receiptNumber: result.receiptNumber });
          } else {
            await updateOfflineSaleStatus(sale.clientTxId, result.status === 'conflict' ? 'conflict' : result.status === 'failed' ? 'rejected' : 'pending', result.error);
          }
        }
      } catch (error) {
        // A network/5xx error can follow a commit. Keep the same key for reconciliation/retry.
        const status = error instanceof ApiError && error.status === 409 ? 'conflict'
          : error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403 ? 'rejected' : 'pending';
        await updateOfflineSaleStatus(sale.clientTxId, status, error instanceof Error ? error.message : 'Unconfirmed operation; retained.');
      }
    })();
    this.processing.set(sale.clientTxId, work);
    try { await work; } finally { this.processing.delete(sale.clientTxId); await this.refreshCount(); }
  }
  private async save(payload: Omit<QueuedSale, 'clientTxId' | 'queuedAt' | 'syncStatus'>) {
    const ownerUserId = currentOwner(); if (!ownerUserId) throw new Error('Sign in before recording a transaction.');
    const sale: QueuedSale = { ...payload, ownerUserId, clientTxId: crypto.randomUUID(), queuedAt: Date.now(), syncStatus: 'pending' };
    // Durability precedes every network request, including an online transaction.
    await queueOfflineSale(sale); await this.refreshCount();
    await this.sendOperation(sale);
    const saved = await getOfflineSale(sale.clientTxId);
    if (saved?.syncStatus === 'rejected' || saved?.syncStatus === 'conflict') throw new Error(`${saved.errorMessage || 'Transaction needs review.'} Reference: ${sale.clientTxId}`);
    return { orderId: sale.clientTxId, clientTxId: sale.clientTxId, syncedImmediately: saved?.syncStatus === 'committed', count: 1,
      saleId: saved?.acknowledgement?.saleId, receiptNumber: saved?.acknowledgement?.receiptNumber, receipt: saved?.acknowledgement?.receipt };
  }
  async recordSale(payload: Omit<QueuedSale, 'clientTxId' | 'queuedAt' | 'syncStatus'>) { return this.save(payload); }
  async recordOrder(order: {
    eventId: string; eventName?: string; paymentMethod: any; cashAmount?: number; upiAmount?: number;
    customerName?: string; customerPhone?: string; saleTime: string; comboId?: string; comboName?: string;
    comboQuantity?: number; transactionType?: any;
    items: Array<{ productId: string; productName: string; quantity: number; unitPrice: number; totalAmount: number }>;
  }) {
    return this.save({ ...order, totalUnits: order.items.reduce((sum, item) => sum + item.quantity, 0),
      totalAmount: Number(order.items.reduce((sum, item) => sum + item.totalAmount, 0).toFixed(2)),
      items: order.items.map(item => ({ productId: item.productId, productName: item.productName,
        quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.totalAmount })) });
  }
  async recordGame(payload: Omit<QueuedSale, 'clientTxId' | 'queuedAt' | 'syncStatus'>) { return this.save({ ...payload, transactionType: 'GAME' }); }
  triggerSync(): Promise<void> {
    if (this.syncing) return this.syncing;
    const run = async () => {
      if (!this.state.isOnline || !currentOwner() || !localStorage.getItem('enactus_ims_token')) return;
      this.state.isSyncing = true; this.notify();
      try { for (const sale of await getPendingSales()) await this.sendOperation(sale); }
      catch (error) { console.error('Sync stopped; operations retained:', error); }
      finally { this.state.isSyncing = false; await this.refreshCount(); }
    };
    const syncing = Promise.resolve(typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('enactus-ims-sync', run) : run()).then(() => {}).finally(() => { this.syncing = null; });
    this.syncing = syncing;
    return syncing;
  }
  async retryAllFailed() { await retryFailedOfflineSales(currentOwner() || undefined); await this.triggerSync(); }
}
export const syncManager = new SyncManager();
