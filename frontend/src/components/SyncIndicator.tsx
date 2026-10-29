import React, { useEffect, useState } from 'react';
import { syncManager, SyncState } from '../lib/sync';
import { getAllQueuedSales } from '../lib/db';
import { QueuedSale } from '../types';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
  Download,
  Clock,
  ShoppingBag,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';

export const SyncIndicator: React.FC = () => {
  const [syncState, setSyncState] = useState<SyncState>(syncManager.getStatus());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [queuedSales, setQueuedSales] = useState<QueuedSale[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = syncManager.subscribe(state => {
      setSyncState(state);
      if (isModalOpen) {
        loadQueue();
      }
    });
    return () => {
      unsubscribe();
    };
  }, [isModalOpen]);

  const loadQueue = async () => {
    setIsLoadingQueue(true);
    try {
      const sales = await getAllQueuedSales();
      // Sort: failed first, then pending by timestamp desc
      sales.sort((a, b) => {
        if (a.syncStatus === 'failed' && b.syncStatus !== 'failed') return -1;
        if (b.syncStatus === 'failed' && a.syncStatus !== 'failed') return 1;
        return (b.queuedAt || 0) - (a.queuedAt || 0);
      });
      setQueuedSales(sales);
    } catch (err) {
      console.error('Failed to load queued sales:', err);
    } finally {
      setIsLoadingQueue(false);
    }
  };

  const handleOpenModal = () => {
    setIsModalOpen(true);
    loadQueue();
  };

  const handleManualSync = async () => {
    if (syncState.isOnline && !syncState.isSyncing) {
      setActionMessage('Syncing transactions with server...');
      await syncManager.triggerSync();
      await loadQueue();
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const handleRetryAll = async () => {
    setActionMessage('Retrying all failed transactions...');
    await syncManager.retryAllFailed();
    await loadQueue();
    setTimeout(() => setActionMessage(null), 3000);
  };

  const exportPreserved = (sales: QueuedSale[]) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(sales, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ims-preserved-operations.json'; link.click();
    URL.revokeObjectURL(url);
    setActionMessage('Exported a copy for reconciliation. All original operations remain on this device.');
  };
  const handleDiscardSale = async (id: string) => exportPreserved(queuedSales.filter(sale => sale.clientTxId === id));
  const handleClearAllFailed = async () => exportPreserved(queuedSales);

  return (
    <>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        {/* Network Connectivity Badge */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
            syncState.isOnline
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-amber-50 border-amber-200 text-amber-800 animate-pulse'
          }`}
          title={syncState.isOnline ? 'Online - connected to server' : 'Offline - local queuing active'}
        >
          {syncState.isOnline ? (
            <Wifi className="w-3.5 h-3.5" />
          ) : (
            <WifiOff className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">{syncState.isOnline ? 'Online' : 'Offline Mode'}</span>
        </div>

        {/* Failed Sync Alert Badge */}
        {syncState.failedCount > 0 && (
          <button
            onClick={handleOpenModal}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 border border-rose-300 text-rose-800 hover:bg-rose-100 transition-all cursor-pointer shadow-sm animate-pulse"
            title="Some offline entries failed sync. Click to inspect & resolve"
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>
              {syncState.failedCount} {syncState.failedCount === 1 ? 'error' : 'errors'}
            </span>
          </button>
        )}

        {/* Pending Sync Counter Badge */}
        {syncState.pendingCount > 0 ? (
          <button
            onClick={handleOpenModal}
            disabled={syncState.isSyncing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-900 hover:bg-amber-200 transition-all cursor-pointer shadow-sm"
            title="Click to view pending sync queue & inspect transactions"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncState.isSyncing ? 'animate-spin text-amber-700' : 'text-amber-800'}`} />
            <span>
              {syncState.isSyncing
                ? 'Syncing...'
                : `${syncState.pendingCount} pending`}
            </span>
          </button>
        ) : syncState.failedCount === 0 ? (
          <button
            onClick={handleOpenModal}
            className="flex items-center gap-1 px-2 py-0.5 text-slate-500 hover:text-slate-700 text-[11px] rounded transition-colors"
            title="Inspect unresolved operations. Committed acknowledgements are retained."
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span className="hidden sm:inline">Synced</span>
          </button>
        ) : null}
      </div>

      {/* Sync Queue Inspection Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl ${syncState.failedCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {syncState.failedCount > 0 ? <AlertTriangle className="w-5 h-5" /> : <RefreshCw className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 leading-tight">
                    Offline Sales & Sync Queue
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Inspect local PWA IndexedDB records, sync status, and resolution actions
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Action & Notification Banner */}
            {actionMessage && (
              <div className="px-6 py-2.5 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 font-medium flex items-center gap-2 animate-in fade-in duration-200">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                <span>{actionMessage}</span>
              </div>
            )}

            {/* Status Summary Bar */}
            <div className="px-6 py-3 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 font-medium text-slate-600">
                  <span className={`w-2 h-2 rounded-full ${syncState.isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {syncState.isOnline ? 'Server Reachable' : 'Offline Mode'}
                </div>
                <div className="h-3 w-px bg-slate-200" />
                <span className="text-slate-600">
                  <strong className="text-slate-900">{queuedSales.length}</strong> total queued
                </span>
                {syncState.pendingCount > 0 && (
                  <span className="text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    {syncState.pendingCount} pending
                  </span>
                )}
                {syncState.failedCount > 0 && (
                  <span className="text-rose-700 font-medium bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                    {syncState.failedCount} failed
                  </span>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {syncState.failedCount > 0 && (
                  <>
                    <button
                      onClick={handleRetryAll}
                      disabled={!syncState.isOnline || syncState.isSyncing}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Retry All
                    </button>
                    <button
                      onClick={handleClearAllFailed}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-50 text-slate-600 border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors"
                      title="Export preserved entries without deleting them"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export for Review
                    </button>
                  </>
                )}
                <button
                  onClick={handleManualSync}
                  disabled={!syncState.isOnline || syncState.isSyncing || queuedSales.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-sm shadow-emerald-600/20"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncState.isSyncing ? 'animate-spin' : ''}`} />
                  {syncState.isSyncing ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>
            </div>

            {/* Queue List Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3 divide-y divide-slate-100">
              {isLoadingQueue ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
                  <p className="text-xs">Reading local storage records...</p>
                </div>
              ) : queuedSales.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800">No unresolved operations</h4>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    There are no unresolved operations in this view. Backend acknowledgements remain stored on this device.
                  </p>
                </div>
              ) : (
                queuedSales.map(tx => {
                  const isFailed = ['failed', 'rejected', 'conflict'].includes(tx.syncStatus);
                  const dateStr = tx.saleTime ? new Date(tx.saleTime).toLocaleString() : new Date(tx.queuedAt).toLocaleString();

                  return (
                    <div
                      key={tx.clientTxId}
                      className={`pt-3 first:pt-0 p-3.5 rounded-xl border transition-all ${
                        isFailed
                          ? 'bg-rose-50/40 border-rose-200'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                isFailed
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : 'bg-amber-100 text-amber-800 border border-amber-300'
                              }`}
                            >
                              {isFailed ? 'Review Required' : 'Pending Confirmation'}
                            </span>
                            <span className="text-xs text-slate-400 font-mono">
                              #{tx.clientTxId.slice(0, 8)}
                            </span>
                            {tx.eventName && (
                              <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                                {tx.eventName}
                              </span>
                            )}
                          </div>

                          {/* Items Breakdown */}
                          <div className="mt-1 text-xs text-slate-800 font-medium">
                            {tx.comboName ? (
                              <span>Combo: <strong>{tx.comboName}</strong> (Qty: {tx.comboQuantity || 1})</span>
                            ) : tx.items && tx.items.length > 0 ? (
                              <span>
                                {tx.items.map(i => `${i.quantity}x ${i.productName || i.productId}`).join(', ')}
                              </span>
                            ) : (
                              <span>{tx.quantity || 1}x {tx.productName || tx.productId}</span>
                            )}
                          </div>

                          {/* Meta: Time, Payment, Customer */}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-0.5">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              {dateStr}
                            </span>
                            <span>•</span>
                            <span className="font-semibold text-slate-700">
                              ₹{Number(tx.totalAmount || 0).toFixed(0)} via {tx.paymentMethod}
                            </span>
                            {tx.customerName && (
                              <>
                                <span>•</span>
                                <span>Customer: {tx.customerName}</span>
                              </>
                            )}
                          </div>

                          {/* Error explanation banner if failed */}
                          {isFailed && (
                            <div className="mt-2 text-xs text-rose-700 bg-rose-100/70 p-2 rounded-lg border border-rose-200 flex items-start gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-600" />
                              <div className="leading-snug">
                                <strong>Server Reason:</strong> {(tx as any).errorMessage || 'Validation rejected by server'}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Item Action Buttons */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleDiscardSale(tx.clientTxId)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-transparent hover:border-rose-200 transition-colors"
                            title="Export preserved transaction"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
              <span>Local Database: IndexedDB (`enactus_ims_offline_db`)</span>
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
