import React, { useState, useEffect, useMemo } from 'react';
import { syncManager, SyncState } from '../lib/sync';
import { getPreservedSales } from '../lib/db';
import { QueuedSale } from '../types';
import {
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Download,
  Search,
  Clock,
  Copy,
  Check,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';

interface SyncIssuesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncIssuesDrawer: React.FC<SyncIssuesDrawerProps> = ({ isOpen, onClose }) => {
  const [syncState, setSyncState] = useState<SyncState>(syncManager.getStatus());
  const [sales, setSales] = useState<QueuedSale[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  // Reconciliation state: matches found in database
  const [reconciledMatches, setReconciledMatches] = useState<Record<string, any>>({});
  const [isCheckingReconciliations, setIsCheckingReconciliations] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SALE' | 'GAME' | 'COMBO'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NEEDS_REVIEW' | 'PENDING' | 'RESOLVED'>('ALL');

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const all = await getPreservedSales();
      all.sort((a, b) => (b.queuedAt || 0) - (a.queuedAt || 0));
      setSales(all);
      void checkServerReconciliations(all);
    } catch (err) {
      console.error('Failed to load preserved operations:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const checkServerReconciliations = async (records: QueuedSale[]) => {
    const failedItems = records.filter(s => ['failed', 'rejected', 'conflict'].includes(s.syncStatus));
    if (failedItems.length === 0) {
      setReconciledMatches({});
      return;
    }
    setIsCheckingReconciliations(true);
    const matches: Record<string, any> = {};
    for (const item of failedItems) {
      try {
        const res = await syncManager.reconcileCheck(item);
        if (res?.matchType === 'EXACT_KEY' || res?.matchType === 'HISTORICAL_EQUIVALENT') {
          matches[item.clientTxId] = res;
        }
      } catch (e) {
        console.warn('Reconcile check error for', item.clientTxId, e);
      }
    }
    setReconciledMatches(matches);
    setIsCheckingReconciliations(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    const unsub = syncManager.subscribe(state => {
      setSyncState(state);
      if (isOpen) {
        loadData();
      }
    });
    return () => unsub();
  }, [isOpen]);

  // Helper to categorize errors
  const getErrorCategory = (sale: QueuedSale): { label: string; cls: string; description: string } => {
    const msg = (sale.errorMessage || '').toLowerCase();
    if (msg.includes('game operations must use') || msg.includes('endpoint')) {
      return {
        label: 'Routing / Legacy Mixed Order',
        cls: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        description: 'Multi-item or combo order was rejected by an earlier server version before MIXED checkouts were supported.',
      };
    }
    if (msg.includes('out of stock') || msg.includes('stock') || msg.includes('allocation') || msg.includes('inventory')) {
      return {
        label: 'Stall Stock / Allocation',
        cls: 'bg-amber-50 text-amber-700 border-amber-200',
        description: 'Insufficient event stall allocation for requested item.',
      };
    }
    if (msg.includes('ended') || msg.includes('not started') || msg.includes('upcoming') || msg.includes('schedule')) {
      return {
        label: 'Event Schedule',
        cls: 'bg-orange-50 text-orange-700 border-orange-200',
        description: 'Event is closed or upcoming and not accepting live entries.',
      };
    }
    if (msg.includes('seller') || msg.includes('owner') || msg.includes('login')) {
      return {
        label: 'Seller Attribution',
        cls: 'bg-purple-50 text-purple-700 border-purple-200',
        description: 'Transaction owner login differs from current user.',
      };
    }
    return {
      label: 'Validation / Unconfirmed',
      cls: 'bg-rose-50 text-rose-700 border-rose-200',
      description: sale.errorMessage || 'Transaction could not be confirmed by backend.',
    };
  };

  // Filtered sales
  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      const isGame = s.transactionType === 'GAME' || Boolean(s.gameId);
      const isCombo = s.transactionType === 'COMBO' || Boolean(s.comboId);
      const computedType = isGame ? 'GAME' : isCombo ? 'COMBO' : 'SALE';

      if (typeFilter !== 'ALL' && computedType !== typeFilter) return false;

      const isNeedsReview = ['failed', 'rejected', 'conflict'].includes(s.syncStatus);
      const isPending = ['pending', 'processing', 'syncing'].includes(s.syncStatus);
      const isResolved = ['committed', 'resolved', 'archived'].includes(s.syncStatus);

      if (statusFilter === 'NEEDS_REVIEW' && !isNeedsReview) return false;
      if (statusFilter === 'PENDING' && !isPending) return false;
      if (statusFilter === 'RESOLVED' && !isResolved) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesId = (s.clientTxId || '').toLowerCase().includes(q);
        const matchesReceipt = s.acknowledgement?.receiptNumber?.toString().includes(q);
        const matchesCustomer = (s.customerName || '').toLowerCase().includes(q) || (s.customerPhone || '').includes(q);
        const matchesEvent = (s.eventName || '').toLowerCase().includes(q);
        const matchesProduct = (s.productName || s.comboName || '').toLowerCase().includes(q);
        const matchesError = (s.errorMessage || '').toLowerCase().includes(q);
        if (!matchesId && !matchesReceipt && !matchesCustomer && !matchesEvent && !matchesProduct && !matchesError) {
          return false;
        }
      }

      return true;
    });
  }, [sales, typeFilter, statusFilter, searchQuery]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Link single record to verified receipt
  const handleLinkToReceipt = async (sale: QueuedSale, match: any) => {
    setActionInProgressId(sale.clientTxId);
    try {
      await syncManager.linkReconciledReceipt(sale.clientTxId, {
        saleId: match.saleId,
        receiptNumber: match.receiptNumber,
        receipt: match.sale,
      });
      await loadData();
      setActionMessage({
        text: `Transaction reconciled with confirmed Receipt #${match.receiptNumber}. Zero duplicate sales created.`,
        type: 'success',
      });
    } catch (err: any) {
      setActionMessage({ text: err.message || 'Reconciliation link failed', type: 'error' });
    } finally {
      setActionInProgressId(null);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  // Bulk reconcile all confirmed matches
  const handleReconcileAllConfirmed = async () => {
    const ids = Object.keys(reconciledMatches);
    if (ids.length === 0) return;
    setActionMessage({ text: `Reconciling ${ids.length} verified transactions with existing receipts...`, type: 'info' });
    try {
      for (const id of ids) {
        const match = reconciledMatches[id];
        await syncManager.linkReconciledReceipt(id, {
          saleId: match.saleId,
          receiptNumber: match.receiptNumber,
          receipt: match.sale,
        });
      }
      await loadData();
      setActionMessage({
        text: `All ${ids.length} transactions reconciled with confirmed database receipts. Active error count cleared!`,
        type: 'success',
      });
    } catch (err: any) {
      setActionMessage({ text: err.message || 'Bulk reconciliation failed', type: 'error' });
    } finally {
      setTimeout(() => setActionMessage(null), 5000);
    }
  };

  const handleRetrySingle = async (sale: QueuedSale) => {
    setActionInProgressId(sale.clientTxId);
    setActionMessage({ text: `Retrying #${sale.clientTxId.slice(0, 8)}...`, type: 'info' });
    try {
      await syncManager.retrySale(sale.clientTxId);
      await loadData();
      setActionMessage({ text: `Retry queued for #${sale.clientTxId.slice(0, 8)}.`, type: 'success' });
    } catch (err: any) {
      setActionMessage({ text: err.message || 'Retry failed', type: 'error' });
    } finally {
      setActionInProgressId(null);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  const handleMarkResolved = async (sale: QueuedSale) => {
    setActionInProgressId(sale.clientTxId);
    try {
      await syncManager.resolveSale(sale.clientTxId, 'Marked resolved by operator');
      await loadData();
      setActionMessage({ text: `Transaction #${sale.clientTxId.slice(0, 8)} marked as resolved.`, type: 'success' });
    } catch (err: any) {
      setActionMessage({ text: err.message || 'Action failed', type: 'error' });
    } finally {
      setActionInProgressId(null);
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const handleExportAll = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(sales, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ims-offline-transactions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setActionMessage({ text: 'Exported JSON copy for audit reconciliation.', type: 'success' });
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handleExportSingle = (sale: QueuedSale) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(sale, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tx-${sale.clientTxId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const matchedCount = Object.keys(reconciledMatches).length;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-slate-900/30 backdrop-blur-2xs flex justify-end animate-in fade-in duration-150"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-md md:max-w-lg bg-white shadow-2xl flex flex-col h-full border-l border-slate-200 animate-in slide-in-from-right duration-200 max-sm:rounded-t-2xl max-sm:mt-12">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/90">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg ${syncState.failedCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              <RefreshCw className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Sync & Transaction Issues</h3>
              <p className="text-[11px] text-slate-500">
                Inspect local records, verify against database receipts, and reconcile issues
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            title="Close Drawer (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Global Notification Banner */}
        {actionMessage && (
          <div
            className={`px-4 py-2 text-xs font-medium flex items-center gap-2 border-b animate-in fade-in duration-150 ${
              actionMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : actionMessage.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-blue-50 text-blue-800 border-blue-200'
            }`}
          >
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
            ) : actionMessage.type === 'error' ? (
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin text-blue-600" />
            )}
            <span className="leading-tight">{actionMessage.text}</span>
          </div>
        )}

        {/* Verified Database Match Banner */}
        {matchedCount > 0 && (
          <div className="p-3.5 bg-emerald-50 border-b border-emerald-200 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-900 leading-tight">
                <strong>{matchedCount} verified match{matchedCount > 1 ? 'es' : ''} found in database.</strong>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  These transactions already succeeded on the server (receipts exist). Reconciling will link them safely with 0 duplicate sales or stock deductions.
                </p>
              </div>
            </div>
            <button
              onClick={handleReconcileAllConfirmed}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Reconcile All Verified Sales ({matchedCount})</span>
            </button>
          </div>
        )}

        {/* Summary Stats & Export */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${syncState.failedCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {syncState.failedCount} review required
            </span>
            {syncState.pendingCount > 0 && (
              <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full text-[11px] font-semibold border border-blue-200">
                {syncState.pendingCount} pending
              </span>
            )}
          </div>

          <button
            onClick={handleExportAll}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 transition-colors shadow-2xs cursor-pointer"
            title="Export all local operations as JSON"
          >
            <Download className="w-3 h-3" />
            <span>Export JSON</span>
          </button>
        </div>

        {/* Search & Filter Controls */}
        <div className="p-3 border-b border-slate-100 space-y-2 bg-white">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              placeholder="Search reference, customer, or items..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1 text-xs rounded-md border border-slate-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="flex items-center justify-between gap-1 text-[11px]">
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md">
              {(['ALL', 'NEEDS_REVIEW', 'PENDING', 'RESOLVED'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    statusFilter === s ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s === 'ALL' ? 'All' : s === 'NEEDS_REVIEW' ? 'Review' : s === 'PENDING' ? 'Pending' : 'Resolved'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md">
              {(['ALL', 'SALE', 'GAME', 'COMBO'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    typeFilter === t ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t === 'ALL' ? 'All' : t === 'GAME' ? '🎮' : t === 'COMBO' ? '🎁' : '🛒'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 divide-y divide-slate-100">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-1.5">
              <RefreshCw className="w-5 h-5 animate-spin text-slate-400" />
              <p className="text-xs">Checking local storage...</p>
            </div>
          ) : filteredSales.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold text-slate-800">No unresolved transactions</h4>
              <p className="text-[11px] text-slate-500 max-w-xs mt-0.5">
                All transactions are synchronized with the server.
              </p>
            </div>
          ) : (
            filteredSales.map(tx => {
              const isNeedsReview = ['failed', 'rejected', 'conflict'].includes(tx.syncStatus);
              const isCommitted = tx.syncStatus === 'committed' || Boolean(tx.acknowledgement?.receiptNumber);
              const isResolved = tx.syncStatus === 'resolved' || tx.syncStatus === 'archived';
              const isGame = tx.transactionType === 'GAME' || Boolean(tx.gameId);
              const isCombo = tx.transactionType === 'COMBO' || Boolean(tx.comboId);
              const category = getErrorCategory(tx);
              const dateStr = tx.saleTime ? new Date(tx.saleTime).toLocaleString() : new Date(tx.queuedAt).toLocaleString();
              const isActing = actionInProgressId === tx.clientTxId;
              const matchedDb = reconciledMatches[tx.clientTxId];

              return (
                <div
                  key={tx.clientTxId}
                  className={`pt-2.5 first:pt-0 p-3 rounded-xl border transition-all ${
                    matchedDb
                      ? 'bg-emerald-50/40 border-emerald-300 shadow-2xs'
                      : isNeedsReview
                      ? 'bg-amber-50/30 border-amber-200 shadow-2xs'
                      : isCommitted
                      ? 'bg-slate-50/60 border-slate-200'
                      : isResolved
                      ? 'bg-slate-50 border-slate-200 opacity-70'
                      : 'bg-white border-slate-200 shadow-2xs'
                  }`}
                >
                  <div className="space-y-1.5">
                    {/* Header line: badges & ID */}
                    <div className="flex items-center justify-between gap-1.5 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                          {isGame ? '🎮 Game' : isCombo ? '🎁 Combo' : '🛒 Sale'}
                        </span>

                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase tracking-wider ${
                            matchedDb
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : isNeedsReview
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : isCommitted
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : isResolved
                              ? 'bg-slate-100 text-slate-600 border border-slate-300'
                              : 'bg-blue-100 text-blue-800 border border-blue-300'
                          }`}
                        >
                          {matchedDb
                            ? `Confirmed #Receipt ${matchedDb.receiptNumber}`
                            : isNeedsReview
                            ? 'Needs Review'
                            : isCommitted
                            ? `Committed #${tx.acknowledgement?.receiptNumber}`
                            : isResolved
                            ? 'Resolved'
                            : 'Pending'}
                        </span>
                      </div>

                      <button
                        onClick={() => handleCopy(tx.clientTxId)}
                        className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-700 font-mono bg-slate-50 px-1 py-0.5 rounded border border-slate-200 cursor-pointer"
                        title="Copy Transaction ID"
                      >
                        <span>#{tx.clientTxId.slice(0, 8)}</span>
                        {copiedId === tx.clientTxId ? <Check className="w-2.5 h-2.5 text-emerald-600" /> : <Copy className="w-2.5 h-2.5" />}
                      </button>
                    </div>

                    {/* Transaction Items */}
                    <div className="text-xs text-slate-900 font-medium">
                      {isGame ? (
                        <div className="flex items-center gap-1.5">
                          <span>Game Play</span>
                          {tx.result && (
                            <span className={`px-1 py-0.2 rounded text-[10px] font-bold ${tx.result === 'WIN' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                              {tx.result === 'WIN' ? '🏆 WIN' : '❌ LOSE'}
                            </span>
                          )}
                        </div>
                      ) : tx.comboName ? (
                        <div>Combo: <strong>{tx.comboName}</strong> (Qty: {tx.comboQuantity || 1})</div>
                      ) : tx.items && tx.items.length > 0 ? (
                        <div className="leading-snug">
                          {tx.items.map(i => `${i.quantity}x ${i.productName || i.productId}`).join(', ')}
                        </div>
                      ) : (
                        <div>{tx.quantity || 1}x Products</div>
                      )}
                    </div>

                    {/* Meta: Event, Time, Payment */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      {tx.eventName && (
                        <>
                          <span className="font-semibold text-slate-700">{tx.eventName}</span>
                          <span>•</span>
                        </>
                      )}
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {dateStr}
                      </span>
                      <span>•</span>
                      <span className="font-bold text-slate-800">
                        ₹{Number(tx.totalAmount || 0).toFixed(0)} ({tx.paymentMethod})
                      </span>
                    </div>

                    {/* Verified Match Box */}
                    {matchedDb && isNeedsReview && (
                      <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-200 text-xs flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 text-emerald-800 font-semibold text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>Corresponding sale found in database: <strong>Receipt #{matchedDb.receiptNumber}</strong></span>
                        </div>
                        <p className="text-[10px] text-emerald-700 leading-tight">
                          This bill was already processed on the server ({new Date(matchedDb.saleTime).toLocaleTimeString()}). Link to reconcile without generating duplicates.
                        </p>
                        <button
                          onClick={() => handleLinkToReceipt(tx, matchedDb)}
                          disabled={isActing}
                          className="self-start inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" />
                          <span>Link to Receipt #{matchedDb.receiptNumber}</span>
                        </button>
                      </div>
                    )}

                    {/* Server Error Reason if un-matched */}
                    {!matchedDb && isNeedsReview && (
                      <div className="text-xs text-rose-800 bg-rose-50/80 p-2 rounded-lg border border-rose-200 flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-600" />
                        <div className="leading-snug space-y-0.5">
                          <div className="text-[11px]"><strong>Server:</strong> {tx.errorMessage}</div>
                          <div className="text-[10px] text-slate-600">{category.description}</div>
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 gap-1.5">
                      <div className="flex items-center gap-1">
                        {!matchedDb && isNeedsReview && (
                          <>
                            <button
                              onClick={() => handleRetrySingle(tx)}
                              disabled={isActing}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-800 disabled:opacity-50 transition-colors cursor-pointer"
                              title="Retry via updated endpoint"
                            >
                              <RotateCcw className={`w-3 h-3 ${isActing ? 'animate-spin' : ''}`} />
                              <span>Retry</span>
                            </button>
                            <button
                              onClick={() => handleMarkResolved(tx)}
                              disabled={isActing}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 disabled:opacity-50 transition-colors cursor-pointer"
                              title="Mark resolved"
                            >
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span>Resolve</span>
                            </button>
                          </>
                        )}
                      </div>

                      <button
                        onClick={() => handleExportSingle(tx)}
                        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                        title="Download JSON"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span className="text-[11px]">IndexedDB (`enactus_ims_offline_db`)</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-md border border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shadow-2xs text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
