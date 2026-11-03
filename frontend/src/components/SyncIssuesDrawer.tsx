import React, { useState, useEffect, useMemo } from 'react';
import { syncManager, SyncState } from '../lib/sync';
import { getAllQueuedSales, getPreservedSales } from '../lib/db';
import { QueuedSale } from '../types';
import {
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Download,
  Search,
  Filter,
  Clock,
  Gamepad2,
  ShoppingBag,
  Layers,
  Copy,
  Check,
  Archive,
  AlertTriangle,
  Info,
  Calendar,
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

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SALE' | 'GAME' | 'COMBO'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NEEDS_REVIEW' | 'PENDING' | 'RESOLVED'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load all records from IndexedDB
      const all = await getPreservedSales();
      all.sort((a, b) => (b.queuedAt || 0) - (a.queuedAt || 0));
      setSales(all);
    } catch (err) {
      console.error('Failed to load preserved operations:', err);
    } finally {
      setIsLoading(false);
    }
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
        label: 'Routing / Endpoint Mismatch',
        cls: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        description: 'Game play was routed through sales checkout. Safe retry will dispatch via dedicated game endpoint.',
      };
    }
    if (msg.includes('out of stock') || msg.includes('stock') || msg.includes('allocation') || msg.includes('inventory')) {
      return {
        label: 'Stock / Stall Allocation',
        cls: 'bg-amber-50 text-amber-700 border-amber-200',
        description: 'Insufficient event stall stock or allocation for the requested item/reward.',
      };
    }
    if (msg.includes('ended') || msg.includes('not started') || msg.includes('upcoming') || msg.includes('schedule')) {
      return {
        label: 'Event Status',
        cls: 'bg-orange-50 text-orange-700 border-orange-200',
        description: 'Event is either ended or upcoming and cannot accept sales.',
      };
    }
    if (msg.includes('seller') || msg.includes('owner') || msg.includes('login')) {
      return {
        label: 'Seller Attribution',
        cls: 'bg-purple-50 text-purple-700 border-purple-200',
        description: 'Original seller login does not match the active session.',
      };
    }
    return {
      label: 'Validation / Server Error',
      cls: 'bg-rose-50 text-rose-700 border-rose-200',
      description: sale.errorMessage || 'Server rejected or could not acknowledge transaction.',
    };
  };

  // Filtered sales
  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      // Type
      const isGame = s.transactionType === 'GAME' || Boolean(s.gameId);
      const isCombo = s.transactionType === 'COMBO' || Boolean(s.comboId);
      const computedType = isGame ? 'GAME' : isCombo ? 'COMBO' : 'SALE';

      if (typeFilter !== 'ALL' && computedType !== typeFilter) return false;

      // Status
      const isNeedsReview = ['failed', 'rejected', 'conflict'].includes(s.syncStatus);
      const isPending = ['pending', 'processing', 'syncing'].includes(s.syncStatus);
      const isResolved = ['committed', 'resolved', 'archived'].includes(s.syncStatus);

      if (statusFilter === 'NEEDS_REVIEW' && !isNeedsReview) return false;
      if (statusFilter === 'PENDING' && !isPending) return false;
      if (statusFilter === 'RESOLVED' && !isResolved) return false;

      // Category
      if (categoryFilter !== 'ALL') {
        const cat = getErrorCategory(s);
        if (cat.label !== categoryFilter) return false;
      }

      // Search Query
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
  }, [sales, typeFilter, statusFilter, categoryFilter, searchQuery]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRetrySingle = async (sale: QueuedSale) => {
    setActionInProgressId(sale.clientTxId);
    setActionMessage({ text: `Retrying transaction #${sale.clientTxId.slice(0, 8)}...`, type: 'info' });
    try {
      await syncManager.retrySale(sale.clientTxId);
      await loadData();
      setActionMessage({ text: `Retry initiated for #${sale.clientTxId.slice(0, 8)}.`, type: 'success' });
    } catch (err: any) {
      setActionMessage({ text: err.message || 'Retry failed', type: 'error' });
    } finally {
      setActionInProgressId(null);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  const handleCheckServerStatus = async (sale: QueuedSale) => {
    setActionInProgressId(sale.clientTxId);
    setActionMessage({ text: `Checking server status for #${sale.clientTxId.slice(0, 8)}...`, type: 'info' });
    try {
      const res = await syncManager.checkSale(sale.clientTxId);
      await loadData();
      if (res.synced) {
        setActionMessage({
          text: `Transaction #${sale.clientTxId.slice(0, 8)} was already recorded on server (Receipt #${res.sale?.receiptNumber}). Status reconciled!`,
          type: 'success',
        });
      } else {
        setActionMessage({
          text: `Transaction #${sale.clientTxId.slice(0, 8)} does not exist on server. Safe to retry.`,
          type: 'info',
        });
      }
    } catch (err: any) {
      setActionMessage({ text: err.message || 'Server check failed', type: 'error' });
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

  const handleRetryAll = async () => {
    setActionMessage({ text: 'Retrying all pending and failed transactions safely...', type: 'info' });
    try {
      await syncManager.retryAllFailed();
      await loadData();
      setActionMessage({ text: 'All eligible transactions queued for retry.', type: 'success' });
    } catch (err: any) {
      setActionMessage({ text: err.message || 'Retry all failed', type: 'error' });
    } finally {
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full border-l border-slate-200 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${syncState.failedCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Sync & Transaction Issues</h3>
              <p className="text-xs text-slate-500">
                Inspect offline queue, retry failed transactions, and reconcile server state
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            title="Close Drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Banner Notification */}
        {actionMessage && (
          <div
            className={`px-5 py-2.5 text-xs font-medium flex items-center gap-2 border-b animate-in fade-in duration-150 ${
              actionMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : actionMessage.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-blue-50 text-blue-800 border-blue-200'
            }`}
          >
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : actionMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            ) : (
              <RefreshCw className="w-4 h-4 shrink-0 animate-spin text-blue-600" />
            )}
            <span>{actionMessage.text}</span>
          </div>
        )}

        {/* Summary Stats & Global Actions */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full font-bold ${syncState.failedCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {syncState.failedCount} need review
            </span>
            <span className="text-slate-400">•</span>
            <span className="font-semibold text-slate-700">
              {syncState.pendingCount} pending
            </span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-500">{sales.length} total local records</span>
          </div>

          <div className="flex items-center gap-2">
            {syncState.failedCount > 0 && (
              <button
                onClick={handleRetryAll}
                disabled={syncState.isSyncing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry All Safe</span>
              </button>
            )}
            <button
              onClick={handleExportAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 transition-colors shadow-2xs cursor-pointer"
              title="Export all local operations as JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Audit</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="p-4 border-b border-slate-100 space-y-3 bg-white">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by clientTxId, customer, product, game, or error..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Status Filter */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
              {(['ALL', 'NEEDS_REVIEW', 'PENDING', 'RESOLVED'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                    statusFilter === s ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s === 'ALL' ? 'All Status' : s === 'NEEDS_REVIEW' ? 'Review Required' : s === 'PENDING' ? 'Pending' : 'Resolved'}
                </button>
              ))}
            </div>

            {/* Type Filter */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
              {(['ALL', 'SALE', 'GAME', 'COMBO'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                    typeFilter === t ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t === 'ALL' ? 'All Types' : t === 'GAME' ? '🎮 Games' : t === 'COMBO' ? '🎁 Combos' : '🛒 Sales'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 divide-y divide-slate-100">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-400 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              <p className="text-xs">Reading local database records...</p>
            </div>
          ) : filteredSales.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-800">No matching transactions</h4>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                {searchQuery || typeFilter !== 'ALL' || statusFilter !== 'ALL'
                  ? 'No records match the active search and filter criteria.'
                  : 'All transactions are synchronized with the server. No unresolved operational issues exist.'}
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

              return (
                <div
                  key={tx.clientTxId}
                  className={`pt-3 first:pt-0 p-4 rounded-xl border transition-all ${
                    isNeedsReview
                      ? 'bg-amber-50/30 border-amber-200 shadow-2xs'
                      : isCommitted
                      ? 'bg-slate-50/50 border-slate-200'
                      : isResolved
                      ? 'bg-slate-50 border-slate-200 opacity-75'
                      : 'bg-white border-slate-200 shadow-2xs'
                  }`}
                >
                  {/* Top metadata row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Transaction Type Badge */}
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                          {isGame ? '🎮 Game Play' : isCombo ? '🎁 Combo' : '🛒 Normal Sale'}
                        </span>

                        {/* Status Badge */}
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                            isNeedsReview
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : isCommitted
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : isResolved
                              ? 'bg-slate-100 text-slate-600 border border-slate-300'
                              : 'bg-blue-100 text-blue-800 border border-blue-300'
                          }`}
                        >
                          {isNeedsReview
                            ? 'Needs Review'
                            : isCommitted
                            ? `Committed #${tx.acknowledgement?.receiptNumber}`
                            : isResolved
                            ? 'Resolved'
                            : 'Pending Sync'}
                        </span>

                        {/* Client Tx ID with Copy */}
                        <button
                          onClick={() => handleCopy(tx.clientTxId)}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 font-mono bg-slate-50 hover:bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 cursor-pointer"
                          title="Click to copy full transaction ID"
                        >
                          <span>#{tx.clientTxId.slice(0, 8)}</span>
                          {copiedId === tx.clientTxId ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        </button>

                        {tx.eventName && (
                          <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                            {tx.eventName}
                          </span>
                        )}
                      </div>

                      {/* Transaction Details */}
                      <div className="text-xs text-slate-900 font-medium">
                        {isGame ? (
                          <div className="flex items-center gap-2">
                            <span>Game: <strong>{tx.gameId ? 'Stall Game' : 'Game'}</strong></span>
                            {tx.result && (
                              <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${tx.result === 'WIN' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                {tx.result === 'WIN' ? '🏆 WIN' : '❌ LOSE'}
                              </span>
                            )}
                          </div>
                        ) : tx.comboName ? (
                          <div>Combo: <strong>{tx.comboName}</strong> (Qty: {tx.comboQuantity || 1})</div>
                        ) : tx.items && tx.items.length > 0 ? (
                          <div>
                            {tx.items.map(i => `${i.quantity}x ${i.productName || i.productId}`).join(', ')}
                          </div>
                        ) : (
                          <div>{tx.quantity || 1}x {tx.productName || tx.productId || 'Products'}</div>
                        )}
                      </div>

                      {/* Meta: Time, Payment, Customer */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 pt-0.5">
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
                            <span>Customer: <strong>{tx.customerName}</strong></span>
                          </>
                        )}
                        {tx.customerPhone && (
                          <span>({tx.customerPhone})</span>
                        )}
                      </div>

                      {/* Error Banner & Category if failed */}
                      {isNeedsReview && (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${category.cls}`}>
                              {category.label}
                            </span>
                          </div>
                          <div className="text-xs text-rose-800 bg-rose-50/80 p-2.5 rounded-lg border border-rose-200 flex items-start gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-600" />
                            <div className="leading-snug space-y-1">
                              <div><strong>Server Reason:</strong> {tx.errorMessage}</div>
                              <div className="text-[11px] text-slate-600">{category.description}</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions per item */}
                    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 shrink-0">
                      {isNeedsReview && (
                        <>
                          <button
                            onClick={() => handleCheckServerStatus(tx)}
                            disabled={isActing}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                            title="Check if transaction already exists on server"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                            <span>Verify</span>
                          </button>
                          <button
                            onClick={() => handleRetrySingle(tx)}
                            disabled={isActing}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-800 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                            title="Retry transaction via correct endpoint"
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${isActing ? 'animate-spin' : ''}`} />
                            <span>Retry</span>
                          </button>
                          <button
                            onClick={() => handleMarkResolved(tx)}
                            disabled={isActing}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                            title="Mark as reviewed/resolved to clear active indicator"
                          >
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Resolve</span>
                          </button>
                        </>
                      )}

                      <button
                        onClick={() => handleExportSingle(tx)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg border border-transparent hover:border-slate-200 transition-colors cursor-pointer"
                        title="Download JSON payload"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>Local Storage: IndexedDB (`enactus_ims_offline_db`)</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shadow-2xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
