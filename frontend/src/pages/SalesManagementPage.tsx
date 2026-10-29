import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { Sale, AppEvent, PaymentMethod } from '../types';
import {
  ReceiptText,
  Download,
  Search,
  Filter,
  Calendar,
  Layers,
  ArrowUpDown,
  Phone,
  User as UserIcon,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Eye,
  ShieldCheck,
  Copy,
  CheckCircle2,
  Lock,
  Clock,
  Info,
} from 'lucide-react';

function getPageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total];
  }
  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, '...', current - 1, current, current + 1, '...', total];
}

export const SalesManagementPage: React.FC = () => {
  const { isDeveloper, isAdmin, hasPermission } = useAuth();
  const { socket } = useSocket();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL searchParams as Single Source of Truth for pagination & filters
  const currentPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const rawPageSize = parseInt(searchParams.get('pageSize') || '10', 10) || 10;
  const pageSize = [10, 25, 50, 100].includes(rawPageSize) ? rawPageSize : 10;
  const activeTab = (searchParams.get('tab') === 'per-event' ? 'per-event' : 'all-time') as 'all-time' | 'per-event';
  const selectedEventId = searchParams.get('eventId') || '';
  const paymentFilter = ((searchParams.get('payment') as 'ALL' | 'UPI' | 'CASH' | 'CASH_UPI') || 'ALL');
  const transactionFilter = ((searchParams.get('txType') as 'ALL' | 'SALES' | 'COMBOS' | 'GAMES') || 'ALL');
  const searchFromUrl = searchParams.get('search') || '';

  // Local state
  const [sales, setSales] = useState<Sale[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [summary, setSummary] = useState<{ totalUnits: number; totalRevenue: number | null }>({
    totalUnits: 0,
    totalRevenue: 0,
  });

  const [searchQuery, setSearchQuery] = useState(searchFromUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Modal & Details State
  const [selectedSaleForDetails, setSelectedSaleForDetails] = useState<Sale | null>(null);
  const [copiedReceiptText, setCopiedReceiptText] = useState<boolean>(false);

  // Developer Edit State
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [editQty, setEditQty] = useState<number>(1);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>('CASH');
  const [editCashAmount, setEditCashAmount] = useState<string>('');
  const [editUpiAmount, setEditUpiAmount] = useState<string>('');
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [editCustomerPhone, setEditCustomerPhone] = useState<string>('');
  const [editSaleTime, setEditSaleTime] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  const canViewRevenue = isDeveloper || isAdmin || hasPermission('view_revenue');
  const canViewPII = isDeveloper || isAdmin || hasPermission('view_customer_pii');
  const canExport = isDeveloper || isAdmin || hasPermission('export_data');

  // Synchronize URL search params helper
  const updateUrlState = useCallback(
    (updates: {
      page?: number;
      pageSize?: number;
      tab?: 'all-time' | 'per-event';
      eventId?: string;
      payment?: 'ALL' | 'UPI' | 'CASH' | 'CASH_UPI';
      txType?: 'ALL' | 'SALES' | 'COMBOS' | 'GAMES';
      search?: string;
    }) => {
      const newParams = new URLSearchParams(searchParams);

      const targetPage = updates.page !== undefined ? updates.page : currentPage;
      const targetPageSize = updates.pageSize !== undefined ? updates.pageSize : pageSize;
      const targetTab = updates.tab !== undefined ? updates.tab : activeTab;
      const targetEventId = updates.eventId !== undefined ? updates.eventId : selectedEventId;
      const targetPayment = updates.payment !== undefined ? updates.payment : paymentFilter;
      const targetTxType = updates.txType !== undefined ? updates.txType : transactionFilter;
      const targetSearch = updates.search !== undefined ? updates.search : searchFromUrl;

      if (targetPage > 1) newParams.set('page', String(targetPage));
      else newParams.delete('page');

      if (targetPageSize !== 10) newParams.set('pageSize', String(targetPageSize));
      else newParams.delete('pageSize');

      if (targetTab === 'per-event') newParams.set('tab', 'per-event');
      else newParams.delete('tab');

      if (targetTab === 'per-event' && targetEventId) newParams.set('eventId', targetEventId);
      else newParams.delete('eventId');

      if (targetPayment !== 'ALL') newParams.set('payment', targetPayment);
      else newParams.delete('payment');

      if (targetTxType !== 'ALL') newParams.set('txType', targetTxType);
      else newParams.delete('txType');

      if (targetSearch.trim()) newParams.set('search', targetSearch.trim());
      else newParams.delete('search');

      setSearchParams(newParams, { replace: true });
    },
    [searchParams, currentPage, pageSize, activeTab, selectedEventId, paymentFilter, transactionFilter, searchFromUrl, setSearchParams]
  );

  // Debounced search input handler
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      updateUrlState({ page: 1, search: val });
    }, 300);
  };

  // Keep search input in sync if URL changes externally
  useEffect(() => {
    setSearchQuery(searchFromUrl);
  }, [searchFromUrl]);

  // Core data fetch function
  const fetchSalesData = useCallback(async () => {
    setIsFetching(true);
    setErrorMessage(null);

    try {
      const query = new URLSearchParams();
      query.set('page', String(currentPage));
      query.set('pageSize', String(pageSize));

      if (activeTab === 'per-event' && selectedEventId) {
        query.set('eventId', selectedEventId);
      }
      if (paymentFilter !== 'ALL') {
        query.set('paymentMethod', paymentFilter);
      }
      if (transactionFilter === 'SALES') {
        query.set('transactionType', 'SALE');
      } else if (transactionFilter === 'COMBOS') {
        query.set('transactionType', 'COMBO');
      } else if (transactionFilter === 'GAMES') {
        query.set('transactionType', 'GAME');
      }
      if (searchFromUrl.trim()) {
        query.set('search', searchFromUrl.trim());
      }

      const res: any = await api.get(`/sales?${query.toString()}`);

      const salesList = Array.isArray(res?.sales) ? res.sales : Array.isArray(res?.data) ? res.data : [];
      setSales(salesList);

      // Defensively determine total count so footer is never 0 when sales exist
      const count =
        typeof res?.pagination?.totalRecords === 'number'
          ? res.pagination.totalRecords
          : typeof res?.totalRecords === 'number'
          ? res.totalRecords
          : typeof res?.totalCount === 'number'
          ? res.totalCount
          : salesList.length;

      setTotalRecords(count);

      if (res?.summary) {
        setSummary({
          totalUnits: res.summary.totalUnits ?? 0,
          totalRevenue: res.summary.totalRevenue ?? null,
        });
      } else {
        setSummary({
          totalUnits: salesList.reduce((acc: number, s: any) => acc + (s.quantity || 0), 0),
          totalRevenue: salesList.reduce((acc: number, s: any) => acc + (s.totalAmount || 0), 0),
        });
      }
    } catch (err: any) {
      console.error('Failed to load sales records:', err);
      setErrorMessage('Unable to load sales records. Please try again.');
    } finally {
      setIsLoading(false);
      setIsFetching(false);
    }
  }, [currentPage, pageSize, activeTab, selectedEventId, paymentFilter, transactionFilter, searchFromUrl]);

  // Initial load: Fetch events list
  useEffect(() => {
    let isMounted = true;

    async function initialLoad() {
      try {
        const eventsRes = await api.get('/events');
        if (isMounted && eventsRes?.events) {
          setEvents(eventsRes.events);
          if (!selectedEventId && eventsRes.events.length > 0 && activeTab === 'per-event') {
            updateUrlState({ eventId: eventsRes.events[0].id });
          }
        }
      } catch (err) {
        console.error('Failed to load events:', err);
      }
    }

    initialLoad();
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch sales whenever pagination or filter URL params change
  useEffect(() => {
    fetchSalesData();
  }, [fetchSalesData]);

  // Real-time sales updates
  useEffect(() => {
    if (!socket) return;
    const handleNewSale = () => {
      fetchSalesData();
    };

    socket.on('sale:created', handleNewSale);
    socket.on('sale:deleted', handleNewSale);
    return () => {
      socket.off('sale:created', handleNewSale);
      socket.off('sale:deleted', handleNewSale);
    };
  }, [socket, fetchSalesData]);

  // Derived pagination metrics
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const hasNextPage = currentPage < totalPages;
  const hasPreviousPage = currentPage > 1;

  const fromRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toRecord = Math.min(currentPage * pageSize, totalRecords);

  // Pagination navigation handlers
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || newPage === currentPage) return;
    updateUrlState({ page: newPage });
  };

  const handlePageSizeChange = (newSize: number) => {
    updateUrlState({ page: 1, pageSize: newSize });
  };

  const handleTabChange = (tab: 'all-time' | 'per-event') => {
    const eventId = tab === 'per-event' && !selectedEventId && events.length > 0 ? events[0].id : selectedEventId;
    updateUrlState({ page: 1, tab, eventId });
  };

  const handleEventChange = (eventId: string) => {
    updateUrlState({ page: 1, eventId });
  };

  const handlePaymentChange = (payment: 'ALL' | 'UPI' | 'CASH' | 'CASH_UPI') => {
    updateUrlState({ page: 1, payment });
  };

  // Developer Edit Handlers
  const handleOpenEdit = (sale: Sale) => {
    setEditingSale(sale);
    setEditQty(sale.quantity || 1);
    setEditPrice(sale.unitPrice || 0);
    setEditPaymentMethod(sale.paymentMethod);
    setEditCashAmount(sale.cashAmount != null ? sale.cashAmount.toString() : '');
    setEditUpiAmount(sale.upiAmount != null ? sale.upiAmount.toString() : '');
    setEditCustomerName(sale.customerName || '');
    setEditCustomerPhone(sale.customerPhone || '');
    setEditSaleTime(sale.saleTime ? new Date(sale.saleTime).toISOString().slice(0, 16) : '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSale) return;

    const lineTotal = editQty * editPrice;
    let cashVal: number | undefined;
    let upiVal: number | undefined;

    if (editPaymentMethod === 'CASH_UPI') {
      cashVal = parseFloat(editCashAmount) || 0;
      upiVal = parseFloat(editUpiAmount) || 0;
      if (Math.abs(lineTotal - (cashVal + upiVal)) > 0.01) {
        alert(`Split amounts (Cash ₹${cashVal} + UPI ₹${upiVal}) must equal total amount ₹${lineTotal.toFixed(2)}.`);
        return;
      }
    } else if (editPaymentMethod === 'CASH') {
      cashVal = lineTotal;
      upiVal = 0;
    } else if (editPaymentMethod === 'UPI') {
      cashVal = 0;
      upiVal = lineTotal;
    }

    setIsSavingEdit(true);
    try {
      const res = await api.put(`/sales/${editingSale.id}`, {
        quantity: editQty,
        unitPrice: editPrice,
        paymentMethod: editPaymentMethod,
        cashAmount: cashVal,
        upiAmount: upiVal,
        customerName: editCustomerName.trim() || null,
        customerPhone: editCustomerPhone.trim() || null,
        saleTime: editSaleTime ? new Date(editSaleTime).toISOString() : undefined,
      });
      if (res?.sale) {
        setSales(prev => prev.map(s => (s.id === editingSale.id ? { ...s, ...res.sale } : s)));
        if (selectedSaleForDetails && selectedSaleForDetails.id === editingSale.id) {
          setSelectedSaleForDetails(res.sale);
        }
      }
      await fetchSalesData();
      const receiptLabel = editingSale.receiptNumber ? `#${editingSale.receiptNumber}` : `ID-${editingSale.id}`;
      setEditingSale(null);
      setActionMessage(`Sale (${receiptLabel}) updated successfully!`);
      setTimeout(() => setActionMessage(null), 3500);
    } catch (err: any) {
      alert(err.message || 'Failed to update sale record');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteSale = async (sale: Sale) => {
    const receiptLabel = sale.receiptNumber ? `#${sale.receiptNumber}` : `ID-${sale.id}`;
    if (!window.confirm(`Developer Action:\n\nAre you sure you want to permanently delete Sale (${receiptLabel})?\n\nThis will remove this transaction and linked items from the database.`)) {
      return;
    }
    try {
      await api.delete(`/sales/${sale.id}`);
      setActionMessage(`Sale (${receiptLabel}) deleted successfully!`);
      if (selectedSaleForDetails && selectedSaleForDetails.id === sale.id) {
        setSelectedSaleForDetails(null);
      }
      await fetchSalesData();
      setTimeout(() => setActionMessage(null), 3500);
    } catch (err: any) {
      alert(err.message || 'Failed to delete sale record');
    }
  };

  // Receipt Text Formatter for WhatsApp / Copy
  const getReceiptSummaryText = (sale: Sale) => {
    const receiptLabel = sale.receiptNumber ? `#${sale.receiptNumber}` : `ID-${sale.id}`;
    const lines = [
      `🧾 *Enactus VIPS-TC Sales Receipt*`,
      `Receipt No: ${receiptLabel}`,
      `Date: ${new Date(sale.saleTime).toLocaleString('en-IN')}`,
      `Event: ${sale.eventName}`,
      `Seller: ${sale.memberName} (@${sale.memberUsername})`,
      `--------------------------------`,
    ];
    if (sale.transactionType === 'GAME') {
      lines.push(`Type: Game Session`);
      lines.push(`Game: ${sale.game?.name || sale.productName || 'Stall Game'}`);
      if (sale.gameSession) {
        lines.push(`Result: ${sale.gameSession.result === 'WIN' ? '🏆 WIN' : 'LOSE'}`);
        if (sale.gameSession.rewardProductName) {
          lines.push(`Reward: ${sale.gameSession.rewardProductName} × ${sale.gameSession.rewardQuantity}`);
        }
      }
    } else if (sale.transactionType === 'COMBO' || sale.comboId) {
      lines.push(`Type: Combo Offer`);
      lines.push(`Combo: ${sale.comboName || sale.productName}`);
      if (sale.items && sale.items.length > 0) {
        sale.items.forEach(it => {
          lines.push(`  • ${it.productName} × ${it.quantity}`);
        });
      }
    } else if (sale.items && sale.items.length > 0) {
      sale.items.forEach(it => {
        lines.push(`• ${it.productName} × ${it.quantity} @ ₹${it.unitPrice || 0} = ₹${(it.quantity * (it.unitPrice || 0)).toFixed(2)}`);
      });
    } else {
      lines.push(`• ${sale.productName} × ${sale.quantity}`);
    }
    lines.push(`--------------------------------`);
    lines.push(`Payment: ${sale.paymentMethod}`);
    if (sale.paymentMethod === 'CASH_UPI') {
      lines.push(`  Cash: ₹${sale.cashAmount ?? 0} | UPI: ₹${sale.upiAmount ?? 0}`);
    }
    if (sale.totalAmount != null) {
      lines.push(`Total Amount: ₹${Number(sale.totalAmount).toFixed(2)}`);
    }
    if (sale.customerName) {
      lines.push(`Customer: ${sale.customerName} (${sale.customerPhone || 'No Phone'})`);
    }
    lines.push(`Status: Ledger Preserved & Audited`);
    return lines.join('\n');
  };

  const handleCopyReceipt = () => {
    if (!selectedSaleForDetails) return;
    const text = getReceiptSummaryText(selectedSaleForDetails);
    navigator.clipboard.writeText(text);
    setCopiedReceiptText(true);
    setTimeout(() => setCopiedReceiptText(false), 2500);
  };

  // Export CSV Handler (fetches ALL matching records with canonical Receipt No.)
  const handleExportCSV = async () => {
    if (!canExport || totalRecords === 0) return;

    try {
      const query = new URLSearchParams();
      query.set('all', 'true');
      if (activeTab === 'per-event' && selectedEventId) {
        query.set('eventId', selectedEventId);
      }
      if (paymentFilter !== 'ALL') {
        query.set('paymentMethod', paymentFilter);
      }
      if (transactionFilter === 'SALES') {
        query.set('transactionType', 'SALE');
      } else if (transactionFilter === 'GAMES') {
        query.set('transactionType', 'GAME');
      }
      if (searchFromUrl.trim()) {
        query.set('search', searchFromUrl.trim());
      }

      const res: any = await api.get(`/sales?${query.toString()}`);
      const exportList: Sale[] = Array.isArray(res?.sales) ? res.sales : Array.isArray(res?.data) ? res.data : sales;

      const headers = [
        'Receipt ID',
        'S.No.',
        'Transaction Type',
        'Sale ID (DB)',
        'Event ID',
        'Event Name',
        'Project Name',
        'Product / Game Name',
        'Game Result',
        'Reward Issued',
        'Sales Member Name',
        'Items Purchased',
        ...(canViewRevenue ? ['Unit Price (INR)', 'Total Amount (INR)'] : []),
        'Payment Method',
        ...(canViewPII ? ['Customer Name', 'Customer Phone'] : []),
        'Timestamp',
      ];

      const rows = exportList.map((s, idx) => [
        s.receiptNumber ? `#${s.receiptNumber}` : '—',
        s.serialNumber ?? (exportList.length - idx),
        s.transactionType || 'SALE',
        s.id,
        s.eventId,
        `"${(s.eventName || '').replace(/"/g, '""')}"`,
        `"${s.projectName || ''}"`,
        `"${(s.description || s.productName || '').replace(/"/g, '""')}"`,
        s.gameSession?.result || '',
        s.gameSession?.rewardDescription ? `"${s.gameSession.rewardDescription.replace(/"/g, '""')}"` : '',
        `"${s.memberName || ''}"`,
        s.quantity,
        ...(canViewRevenue ? [s.unitPrice || 0, s.totalAmount || 0] : []),
        s.paymentMethod,
        ...(canViewPII ? [`"${s.customerName || ''}"`, `"${s.customerPhone || ''}"`] : []),
        `"${new Date(s.saleTime).toISOString()}"`,
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `enactus_sales_${activeTab}_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('CSV Export failed:', err);
      alert('Failed to export sales data. Please try again.');
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5 w-full max-w-[1600px] mx-auto pb-12 min-w-0">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ReceiptText className="w-5 h-5 text-emerald-600 shrink-0" />
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              Sales History
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Official chronological transactions ledger with multi-payment tracking and developer controls.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {canExport && (
            <button
              onClick={handleExportCSV}
              disabled={totalRecords === 0}
              className="px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl flex items-center gap-2 shadow-xs animate-fade-in">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold rounded-xl flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchSalesData()}
            className="underline hover:text-amber-900 font-bold cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tabs: All-Time Sales vs Per-Event Sales */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => handleTabChange('all-time')}
            className={`px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'all-time'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            All-Time Sales
          </button>
          <button
            onClick={() => handleTabChange('per-event')}
            className={`px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'per-event'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            Per-Event Sales
          </button>
        </div>

        {/* Per-Event Selector Dropdown */}
        {activeTab === 'per-event' && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-semibold text-slate-500 shrink-0">Event:</span>
            <select
              value={selectedEventId}
              onChange={e => handleEventChange(e.target.value)}
              className="w-full sm:w-auto text-xs font-semibold bg-white border border-slate-300 rounded-lg p-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer truncate"
            >
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} ({ev.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Filter and Metric Bar */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
        {/* Row 1: Search and Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search input */}
          <div className="w-full lg:max-w-xs relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search product, receipt #, member..."
              value={searchQuery}
              onChange={handleSearchInputChange}
              className="w-full pl-9 pr-8 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            {isFetching && (
              <Loader2 className="w-3.5 h-3.5 absolute right-3 top-3 text-slate-400 animate-spin" />
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-4">
            {/* Payment Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 shrink-0">Payment:</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                {(['ALL', 'UPI', 'CASH', 'CASH_UPI'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => handlePaymentChange(p)}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                      paymentFilter === p ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {p === 'CASH_UPI' ? 'CASH+UPI' : p}
                  </button>
                ))}
              </div>
            </div>

            {/* Transaction Type Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 shrink-0">Type:</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                {(['ALL', 'SALES', 'COMBOS', 'GAMES'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => updateUrlState({ page: 1, txType: t })}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                      transactionFilter === t ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Metrics Chips */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-slate-600">
              <span className="text-slate-400">Showing:</span>{' '}
              <span className="font-bold text-slate-900">{fromRecord}–{toRecord}</span> of <span className="font-bold text-slate-900">{totalRecords}</span> records
            </div>
            <div className="text-slate-600">
              <span className="text-slate-400">Units:</span>{' '}
              <span className="font-bold text-slate-900">{summary.totalUnits}</span>
            </div>
          </div>
          {canViewRevenue && summary.totalRevenue !== null && (
            <div className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-lg">
              <span className="text-slate-600 text-[11px] font-medium mr-1.5">Total Revenue:</span>
              <span className="font-black text-emerald-800 text-xs sm:text-sm">
                ₹{summary.totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main Ledger Content Container */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden relative min-w-0">
        {/* Subtle loading indicator on page change */}
        {isFetching && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-slate-900/10 overflow-hidden z-30">
            <div className="w-full h-full bg-emerald-600 animate-pulse" />
          </div>
        )}

        {/* 1. DESKTOP VIEW: Full Structured Table (hidden on mobile/tablet) */}
        <div className="hidden lg:block overflow-x-auto min-w-0 max-w-full">
          <table className="w-full text-left text-xs min-w-[1250px] border-collapse">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th scope="col" className="sticky left-0 bg-slate-50 z-20 px-4 py-3 w-28 whitespace-nowrap shadow-[1px_0_0_0_#e2e8f0]">
                  Receipt ID
                </th>
                <th scope="col" className="px-4 py-3 w-16 whitespace-nowrap">S.No.</th>
                <th scope="col" className="px-4 py-3 w-24 whitespace-nowrap">Type</th>
                <th scope="col" className="px-4 py-3 w-28 whitespace-nowrap">Project</th>
                <th scope="col" className="px-4 py-3 min-w-[180px] max-w-[280px]">Product / Game</th>
                <th scope="col" className="px-4 py-3 w-36 whitespace-nowrap">Sales Member</th>
                <th scope="col" className="px-4 py-3 text-right w-20 whitespace-nowrap">Units / Plays</th>
                {canViewRevenue && <th scope="col" className="px-4 py-3 text-right w-28 whitespace-nowrap">Total (₹)</th>}
                <th scope="col" className="px-4 py-3 w-28 whitespace-nowrap">Payment</th>
                <th scope="col" className="px-4 py-3 w-28 whitespace-nowrap">Time</th>
                <th scope="col" className="px-4 py-3 w-32 whitespace-nowrap">Event</th>
                <th scope="col" className="px-4 py-3 w-36 whitespace-nowrap">Customer Info</th>
                <th scope="col" className="px-4 py-3 text-center w-36 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={canViewRevenue ? 13 : 12}
                    className="px-4 py-12 text-center text-slate-400 text-xs"
                  >
                    <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin text-slate-400" />
                    Loading sales records...
                  </td>
                </tr>
              ) : sales.length === 0 ? (
                <tr>
                  <td
                    colSpan={canViewRevenue ? 13 : 12}
                    className="px-4 py-8 text-center text-slate-400 text-xs"
                  >
                    No matching sales records found.
                  </td>
                </tr>
              ) : (
                sales.map((sale, index) => {
                  const displayReceipt = sale.receiptNumber ?? '—';
                  const displaySNo = sale.serialNumber ?? Math.max(1, totalRecords - ((currentPage - 1) * pageSize) - index);

                  return (
                    <tr key={sale.id} className="hover:bg-slate-50/50 transition-colors">
                      {/* Sticky Receipt ID */}
                      <td className="sticky left-0 bg-white z-10 px-4 py-3 font-mono font-bold text-slate-900 whitespace-nowrap shadow-[1px_0_0_0_#e2e8f0]">
                        {displayReceipt !== '—' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-900 border border-slate-200">
                            #{displayReceipt}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-normal">#{sale.id}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500 font-medium whitespace-nowrap">
                        {displaySNo}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {sale.transactionType === 'GAME' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            🎮 GAME
                          </span>
                        ) : sale.transactionType === 'COMBO' || sale.comboId ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            🎁 COMBO
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            SALE
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        <div className="flex flex-wrap gap-1">
                          {(sale.projectNames && sale.projectNames.length > 0
                            ? sale.projectNames
                            : [sale.projectName]
                          ).map((proj, pIdx) => (
                            <span key={pIdx} className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 border border-slate-200 whitespace-nowrap">
                              {proj}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-900 min-w-[180px] max-w-[280px]">
                        {sale.transactionType === 'GAME' ? (
                          <div>
                            <div className="font-bold text-indigo-950 flex items-center gap-1.5 flex-wrap">
                              <span>🎮 {sale.game?.name || sale.productName || 'Stall Game'}</span>
                              {sale.gameSession && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase whitespace-nowrap ${
                                  sale.gameSession.result === 'WIN'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}>
                                  {sale.gameSession.result === 'WIN' ? '🏆 WIN' : 'LOSE'}
                                </span>
                              )}
                            </div>
                            {sale.gameSession?.rewardProduct ? (
                              <div className="text-[11px] text-slate-600 mt-0.5">
                                Reward:{' '}
                                <span className="font-semibold text-slate-800">
                                  {sale.gameSession.rewardProduct.name}
                                </span>{' '}
                                × {sale.gameSession.rewardQuantity}
                              </div>
                            ) : sale.rewardDescription ? (
                              <div className="text-[11px] text-slate-600 mt-0.5">
                                Reward: <span className="font-semibold">{sale.rewardDescription}</span>
                              </div>
                            ) : null}
                          </div>
                        ) : (sale.transactionType === 'COMBO' || sale.comboId) ? (
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                              <span>🎁 {sale.comboName || sale.productName || 'Combo Offer'}</span>
                            </div>
                            {sale.items && sale.items.length > 0 ? (
                              <div className="mt-1 space-y-0.5 border-l-2 border-emerald-200 pl-2">
                                {sale.items.map((item, itIdx) => (
                                  <div key={itIdx} className="text-[11px] text-slate-600 flex items-center gap-1.5">
                                    <span className="font-medium text-slate-800">{item.productName}</span>
                                    <span className="font-bold text-slate-600 whitespace-nowrap">× {item.quantity}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : sale.items && sale.items.length > 0 ? (
                          <div className="space-y-1">
                            {sale.items.map((item, itIdx) => (
                              <div key={itIdx} className="text-xs flex items-center gap-1.5">
                                <span className="font-semibold text-slate-900">{item.productName}</span>
                                <span className="font-bold text-slate-700 whitespace-nowrap">× {item.quantity}</span>
                                {canViewRevenue && item.unitPrice ? (
                                  <span className="text-[10px] text-slate-400 whitespace-nowrap">(@ ₹{item.unitPrice})</span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div>
                            <span className="font-semibold text-slate-900">{sale.productName}</span>
                            {sale.productId && (
                              <span className="block text-[10px] text-slate-400 font-normal font-mono whitespace-nowrap">
                                {sale.productId}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                        {sale.memberName}
                        <span className="block text-[10px] text-slate-400 font-mono">
                          @{sale.memberUsername}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-900 whitespace-nowrap">
                        {sale.totalUnits ?? sale.quantity}
                      </td>
                      {canViewRevenue && (
                        <td className="px-4 py-3 text-right font-black text-slate-900 whitespace-nowrap">
                          {sale.totalAmount !== null && sale.totalAmount !== undefined
                            ? `₹${sale.totalAmount.toFixed(2)}`
                            : '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            sale.paymentMethod === 'UPI'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : sale.paymentMethod === 'CASH_UPI'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {sale.paymentMethod === 'CASH_UPI' ? 'CASH + UPI' : sale.paymentMethod}
                        </span>
                        {sale.paymentMethod === 'CASH_UPI' && (
                          <div className="text-[10px] text-slate-500 font-medium mt-0.5 whitespace-nowrap">
                            ₹{sale.cashAmount != null ? Number(sale.cashAmount).toFixed(0) : '0'} Cash • ₹{sale.upiAmount != null ? Number(sale.upiAmount).toFixed(0) : '0'} UPI
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-[11px] whitespace-nowrap">
                        {new Date(sale.saleTime).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        {new Date(sale.saleTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-medium whitespace-nowrap">
                        {sale.eventName}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-[11px] whitespace-nowrap">
                        {sale.customerName ? (
                          <div>
                            <div className="font-medium text-slate-800">{sale.customerName}</div>
                            <div className="text-slate-400">{sale.customerPhone || 'No phone'}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">None</span>
                        )}
                      </td>
                      {/* Active Actions: Details + Developer Edit & Delete */}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedSaleForDetails(sale)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors cursor-pointer"
                            title="View receipt and transaction details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Details</span>
                          </button>

                          {isDeveloper && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(sale)}
                                className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-md transition-colors cursor-pointer"
                                title="Edit sale record (Developer)"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSale(sale)}
                                className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-md transition-colors cursor-pointer"
                                title="Delete sale record (Developer)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 2. MOBILE & TABLET VIEW: Responsive Card List (< 1024px) */}
        <div className="block lg:hidden divide-y divide-slate-100">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin text-slate-400" />
              Loading sales records...
            </div>
          ) : sales.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              No matching sales records found.
            </div>
          ) : (
            sales.map((sale, index) => {
              const displayReceipt = sale.receiptNumber ?? '—';
              const displaySNo = sale.serialNumber ?? Math.max(1, totalRecords - ((currentPage - 1) * pageSize) - index);

              return (
                <div key={sale.id} className="p-3.5 sm:p-4 hover:bg-slate-50/50 transition-colors space-y-2.5">
                  {/* Card Top: Receipt #, S.No, Type, Time */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs bg-slate-900 text-white px-2 py-0.5 rounded shadow-2xs">
                        {displayReceipt !== '—' ? `#${displayReceipt}` : `#${sale.id}`}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono font-medium">
                        S.No. {displaySNo}
                      </span>
                      {sale.transactionType === 'GAME' ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          🎮 GAME
                        </span>
                      ) : sale.transactionType === 'COMBO' || sale.comboId ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          🎁 COMBO
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          SALE
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>
                        {new Date(sale.saleTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                        {new Date(sale.saleTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {/* Card Middle: Products & Quantities */}
                  <div className="text-xs">
                    {sale.transactionType === 'GAME' ? (
                      <div>
                        <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                          <span>🎮 {sale.game?.name || sale.productName || 'Stall Game'}</span>
                          {sale.gameSession && (
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                              sale.gameSession.result === 'WIN'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-100 text-amber-800 border border-amber-200'
                            }`}>
                              {sale.gameSession.result === 'WIN' ? '🏆 WIN' : 'LOSE'}
                            </span>
                          )}
                        </div>
                        {sale.gameSession?.rewardProduct && (
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            Reward: <span className="font-semibold text-slate-800">{sale.gameSession.rewardProduct.name}</span> × {sale.gameSession.rewardQuantity}
                          </div>
                        )}
                      </div>
                    ) : (sale.transactionType === 'COMBO' || sale.comboId) ? (
                      <div>
                        <div className="font-bold text-slate-900">
                          🎁 {sale.comboName || sale.productName || 'Combo Offer'}
                        </div>
                        {sale.items && sale.items.length > 0 && (
                          <div className="text-[11px] text-slate-600 mt-1 space-y-0.5 border-l-2 border-emerald-200 pl-2">
                            {sale.items.map((it, itIdx) => (
                              <div key={itIdx} className="flex items-center justify-between">
                                <span>{it.productName}</span>
                                <span className="font-bold text-slate-700">× {it.quantity}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : sale.items && sale.items.length > 0 ? (
                      <div className="space-y-1">
                        {sale.items.map((it, itIdx) => (
                          <div key={itIdx} className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-900 truncate mr-2">{it.productName}</span>
                            <span className="font-bold text-slate-700 shrink-0">× {it.quantity}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900 truncate mr-2">{sale.productName}</span>
                        <span className="font-bold text-slate-700 shrink-0">× {sale.quantity}</span>
                      </div>
                    )}
                  </div>

                  {/* Card Meta: Stall & Seller */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 pt-1 border-t border-slate-50">
                    <span>Stall: <strong className="text-slate-700 font-medium">{sale.eventName}</strong></span>
                    <span>Seller: <strong className="text-slate-700 font-medium">{sale.memberName}</strong></span>
                    {sale.customerName && (
                      <span>Customer: <strong className="text-slate-700 font-medium">{sale.customerName}</strong></span>
                    )}
                  </div>

                  {/* Card Bottom: Payment & Actions */}
                  <div className="flex items-center justify-between gap-2 pt-1.5 flex-wrap">
                    <div className="flex items-center gap-2">
                      {canViewRevenue && sale.totalAmount != null && (
                        <span className="font-black text-slate-900 text-sm">
                          ₹{Number(sale.totalAmount).toFixed(2)}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        sale.paymentMethod === 'UPI'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : sale.paymentMethod === 'CASH_UPI'
                          ? 'bg-purple-50 text-purple-700 border border-purple-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        {sale.paymentMethod === 'CASH_UPI' ? 'CASH + UPI' : sale.paymentMethod}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedSaleForDetails(sale)}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Details</span>
                      </button>

                      {isDeveloper && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(sale)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                            title="Edit sale (Developer)"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSale(sale)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                            title="Delete sale (Developer)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Clean Responsive Pagination Footer */}
        <div className="bg-white px-3.5 py-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-3 text-slate-600">
            <span>
              Showing{' '}
              <span className="font-bold text-slate-900">{fromRecord}</span>
              –
              <span className="font-bold text-slate-900">{toRecord}</span>{' '}
              of <span className="font-bold text-slate-900">{totalRecords}</span>
            </span>

            <div className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
              <span className="text-slate-500 font-medium">Rows:</span>
              <select
                value={pageSize}
                onChange={e => handlePageSizeChange(Number(e.target.value))}
                className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-1.5 self-stretch sm:self-auto">
            {/* Previous button */}
            <button
              type="button"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={!hasPreviousPage || isFetching}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-2xs text-xs"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>

            {/* Mobile Page Indicator (clean and non-overflowing on 320px-640px) */}
            <span className="sm:hidden text-xs font-bold text-slate-700 px-2">
              {currentPage} / {totalPages}
            </span>

            {/* Desktop Page number buttons */}
            <div className="hidden sm:flex items-center gap-1">
              {getPageNumbers(currentPage, totalPages).map((p, idx) =>
                p === '...' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 py-1 text-slate-400">
                    …
                  </span>
                ) : (
                  <button
                    key={`page-${p}`}
                    type="button"
                    onClick={() => handlePageChange(Number(p))}
                    disabled={isFetching}
                    className={`min-w-[32px] px-2 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                      currentPage === p
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            </div>

            {/* Next button */}
            <button
              type="button"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={!hasNextPage || isFetching}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-2xs text-xs"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Comprehensive Transaction Details & Audit Modal */}
      {selectedSaleForDetails && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200">
                  <ReceiptText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      Receipt {selectedSaleForDetails.receiptNumber ? `#${selectedSaleForDetails.receiptNumber}` : `#${selectedSaleForDetails.id}`}
                    </h3>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-bold">
                      S.No. {selectedSaleForDetails.serialNumber ?? '—'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {new Date(selectedSaleForDetails.saleTime).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSaleForDetails(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Data Preservation / Audit Protection Notice */}
              <div className="p-3.5 bg-amber-50 border border-amber-200/80 rounded-xl flex items-start gap-3 text-amber-900">
                <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-xs text-amber-950 flex items-center gap-1.5">
                    <span>Official Financial Ledger Record</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-amber-200/80 text-amber-900 uppercase">
                      {isDeveloper ? 'Developer Authorized' : 'Protected'}
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    {isDeveloper
                      ? 'As System Developer, you have authorized privileges to edit or delete transactions when required for accounting corrections.'
                      : 'This transaction is preserved in the official ledger for audit compliance, sales reconciliation, and stock integrity.'}
                  </p>
                </div>
              </div>

              {/* Transaction Overview Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Event / Stall</span>
                  <span className="font-bold text-slate-900 text-xs block truncate" title={selectedSaleForDetails.eventName}>
                    {selectedSaleForDetails.eventName}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    ID: {selectedSaleForDetails.eventId}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Cashier / Member</span>
                  <span className="font-bold text-slate-900 text-xs block truncate">
                    {selectedSaleForDetails.memberName}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    @{selectedSaleForDetails.memberUsername}
                  </span>
                </div>
              </div>

              {/* Items Breakdown */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between font-bold text-slate-700 text-[11px]">
                  <span>Purchased Items & Details</span>
                  <span>Total: {selectedSaleForDetails.totalUnits ?? selectedSaleForDetails.quantity} units</span>
                </div>
                <div className="divide-y divide-slate-100 p-3 space-y-2">
                  {selectedSaleForDetails.transactionType === 'GAME' ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between font-bold text-slate-900">
                        <span>🎮 {selectedSaleForDetails.game?.name || selectedSaleForDetails.productName || 'Stall Game'}</span>
                        {canViewRevenue && <span>₹{selectedSaleForDetails.totalAmount}</span>}
                      </div>
                      {selectedSaleForDetails.gameSession && (
                        <div className="p-2.5 bg-indigo-50/50 rounded-lg border border-indigo-100 space-y-1 text-[11px]">
                          <div className="flex justify-between">
                            <span className="text-slate-600">Session Code:</span>
                            <span className="font-mono font-bold text-indigo-900">{selectedSaleForDetails.gameSession.sessionCode}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Result:</span>
                            <span className={`font-bold ${selectedSaleForDetails.gameSession.result === 'WIN' ? 'text-emerald-700' : 'text-slate-600'}`}>
                              {selectedSaleForDetails.gameSession.result === 'WIN' ? '🏆 Winner' : 'Participation'}
                            </span>
                          </div>
                          {selectedSaleForDetails.gameSession.rewardProductName && (
                            <div className="flex justify-between">
                              <span className="text-slate-600">Reward Product:</span>
                              <span className="font-bold text-slate-800">
                                {selectedSaleForDetails.gameSession.rewardProductName} × {selectedSaleForDetails.gameSession.rewardQuantity}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (selectedSaleForDetails.transactionType === 'COMBO' || selectedSaleForDetails.comboId) ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between font-bold text-slate-900">
                        <span>🎁 {selectedSaleForDetails.comboName || selectedSaleForDetails.productName}</span>
                        {canViewRevenue && <span>₹{selectedSaleForDetails.totalAmount}</span>}
                      </div>
                      {selectedSaleForDetails.items && selectedSaleForDetails.items.length > 0 && (
                        <div className="p-2.5 bg-emerald-50/40 rounded-lg border border-emerald-100 space-y-1 text-[11px]">
                          <span className="font-bold text-emerald-950 block">Combo Contents:</span>
                          {selectedSaleForDetails.items.map((it, idx) => (
                            <div key={idx} className="flex justify-between text-slate-700">
                              <span>{it.productName}</span>
                              <span className="font-bold">× {it.quantity}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : selectedSaleForDetails.items && selectedSaleForDetails.items.length > 0 ? (
                    selectedSaleForDetails.items.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs py-1">
                        <div>
                          <span className="font-bold text-slate-900">{it.productName}</span>
                          {it.unitPrice && (
                            <span className="text-slate-400 text-[10px] block">
                              ₹{it.unitPrice} each
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-slate-700">× {it.quantity}</span>
                          {canViewRevenue && it.lineTotal != null && (
                            <span className="block font-bold text-slate-900">₹{it.lineTotal.toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center justify-between text-xs py-1">
                      <div>
                        <span className="font-bold text-slate-900">{selectedSaleForDetails.productName}</span>
                        {selectedSaleForDetails.unitPrice && (
                          <span className="text-slate-400 text-[10px] block">₹{selectedSaleForDetails.unitPrice} each</span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-slate-700">× {selectedSaleForDetails.quantity}</span>
                        {canViewRevenue && selectedSaleForDetails.totalAmount != null && (
                          <span className="block font-bold text-slate-900">₹{Number(selectedSaleForDetails.totalAmount).toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment & Financial Settlement */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-semibold">Payment Mode:</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    selectedSaleForDetails.paymentMethod === 'UPI'
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : selectedSaleForDetails.paymentMethod === 'CASH_UPI'
                      ? 'bg-purple-50 text-purple-700 border border-purple-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}>
                    {selectedSaleForDetails.paymentMethod === 'CASH_UPI' ? 'CASH + UPI' : selectedSaleForDetails.paymentMethod}
                  </span>
                </div>

                {selectedSaleForDetails.paymentMethod === 'CASH_UPI' && (
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/60 text-[11px]">
                    <div>
                      <span className="text-slate-400">Cash Received:</span>
                      <span className="block font-bold text-slate-800">
                        ₹{selectedSaleForDetails.cashAmount != null ? Number(selectedSaleForDetails.cashAmount).toFixed(2) : '0.00'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">UPI Received:</span>
                      <span className="block font-bold text-slate-800">
                        ₹{selectedSaleForDetails.upiAmount != null ? Number(selectedSaleForDetails.upiAmount).toFixed(2) : '0.00'}
                      </span>
                    </div>
                  </div>
                )}

                {canViewRevenue && selectedSaleForDetails.totalAmount != null && (
                  <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                    <span className="font-bold text-slate-800">Total Settled:</span>
                    <span className="text-base font-black text-emerald-700">
                      ₹{Number(selectedSaleForDetails.totalAmount).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {/* Customer Information (if available) */}
              {(selectedSaleForDetails.customerName || selectedSaleForDetails.customerPhone) && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Customer Information</span>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{selectedSaleForDetails.customerName || 'Walk-in'}</span>
                    <span className="text-slate-600 font-mono text-[11px]">{selectedSaleForDetails.customerPhone || '—'}</span>
                  </div>
                </div>
              )}

              {/* Audit Metadata */}
              <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between px-1">
                <span>DB ID: #{selectedSaleForDetails.id}</span>
                {selectedSaleForDetails.clientTxId && (
                  <span className="truncate max-w-[200px]" title={selectedSaleForDetails.clientTxId}>
                    Tx: {selectedSaleForDetails.clientTxId}
                  </span>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-100 bg-slate-50/50 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyReceipt}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-2xs"
                >
                  {copiedReceiptText ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700 font-bold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Copy Receipt</span>
                    </>
                  )}
                </button>

                {isDeveloper && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(selectedSaleForDetails)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer shadow-2xs"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSale(selectedSaleForDetails)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer shadow-2xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedSaleForDetails(null)}
                className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-2xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Developer Edit Sale Modal */}
      {editingSale && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Edit Sale Record (DB #{editingSale.id})
                </h3>
                <p className="text-[11px] text-slate-500">
                  {editingSale.receiptNumber ? `Receipt #${editingSale.receiptNumber}` : ''} • {editingSale.eventName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSale(null)}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">
                    Quantity Purchased
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={editQty}
                    onChange={e => setEditQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">
                    Unit Price (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={editPrice}
                    onChange={e => setEditPrice(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
              </div>

              {/* Calculated Total */}
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between font-semibold">
                <span className="text-slate-600">Calculated Total:</span>
                <span className="text-sm font-black text-emerald-700">
                  ₹{(editQty * editPrice).toFixed(2)}
                </span>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Payment Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditPaymentMethod('CASH')}
                    className={`py-2 px-3 rounded-lg font-bold text-center border transition-all cursor-pointer ${
                      editPaymentMethod === 'CASH'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    💵 CASH
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditPaymentMethod('UPI')}
                    className={`py-2 px-3 rounded-lg font-bold text-center border transition-all cursor-pointer ${
                      editPaymentMethod === 'UPI'
                        ? 'border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    📱 UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditPaymentMethod('CASH_UPI')}
                    className={`py-2 px-3 rounded-lg font-bold text-center border transition-all cursor-pointer ${
                      editPaymentMethod === 'CASH_UPI'
                        ? 'border-purple-600 bg-purple-50 text-purple-800 ring-1 ring-purple-600'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    💵+📱 SPLIT
                  </button>
                </div>

                {editPaymentMethod === 'CASH_UPI' && (
                  <div className="mt-2.5 p-3 bg-purple-50/50 border border-purple-200 rounded-lg space-y-2">
                    <div className="text-xs font-bold text-purple-900">
                      Split Amounts (Total: ₹{(editQty * editPrice).toFixed(2)})
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Cash Portion (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editCashAmount}
                          onChange={e => setEditCashAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-purple-600"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          UPI Portion (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editUpiAmount}
                          onChange={e => setEditUpiAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-purple-600"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">
                    Customer Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rahul Sharma"
                    value={editCustomerName}
                    onChange={e => setEditCustomerName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">
                    Customer Phone
                  </label>
                  <input
                    type="tel"
                    placeholder="e.g. 9876543210"
                    value={editCustomerPhone}
                    onChange={e => setEditCustomerPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Sale Timestamp
                </label>
                <input
                  type="datetime-local"
                  value={editSaleTime}
                  onChange={e => setEditSaleTime(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingSale(null)}
                  disabled={isSavingEdit}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-4 py-2 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
