import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { Sale, AppEvent, PaginationInfo, SalesResponse } from '../types';
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

  // Read URL query parameters
  const pageFromUrl = parseInt(searchParams.get('page') || '1', 10) || 1;
  const pageSizeFromUrl = parseInt(searchParams.get('pageSize') || '10', 10) || 10;
  const tabFromUrl = searchParams.get('tab') === 'per-event' ? 'per-event' : 'all-time';
  const eventIdFromUrl = searchParams.get('eventId') || '';
  const paymentFromUrl = (searchParams.get('payment') as 'ALL' | 'UPI' | 'CASH') || 'ALL';
  const searchFromUrl = searchParams.get('search') || '';

  const [sales, setSales] = useState<Sale[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [activeTab, setActiveTab] = useState<'all-time' | 'per-event'>(tabFromUrl);
  const [selectedEventId, setSelectedEventId] = useState<string>(eventIdFromUrl);
  const [searchQuery, setSearchQuery] = useState(searchFromUrl);
  const [debouncedSearch, setDebouncedSearch] = useState(searchFromUrl);
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | 'UPI' | 'CASH'>(paymentFromUrl);

  const [pagination, setPagination] = useState<PaginationInfo>({
    page: pageFromUrl,
    pageSize: pageSizeFromUrl,
    totalRecords: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });

  const [summary, setSummary] = useState<{ totalUnits: number; totalRevenue: number | null }>({
    totalUnits: 0,
    totalRevenue: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Developer Management States
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [editQty, setEditQty] = useState<number>(1);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editPaymentMethod, setEditPaymentMethod] = useState<'CASH' | 'UPI'>('CASH');
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [editCustomerPhone, setEditCustomerPhone] = useState<string>('');
  const [editSaleTime, setEditSaleTime] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);
  const [showClearModal, setShowClearModal] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const canViewRevenue = isDeveloper || isAdmin || hasPermission('view_revenue');
  const canViewPII = isDeveloper || isAdmin || hasPermission('view_customer_pii');
  const canExport = isDeveloper || isAdmin || hasPermission('export_data');

  // Debounce search input by 300ms
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      // Reset to page 1 on new search
      updateUrlState({ page: 1, search: val });
    }, 300);
  };

  // Sync state to URL search parameters
  const updateUrlState = useCallback(
    (updates: {
      page?: number;
      pageSize?: number;
      tab?: 'all-time' | 'per-event';
      eventId?: string;
      payment?: 'ALL' | 'UPI' | 'CASH';
      search?: string;
    }) => {
      const newParams = new URLSearchParams(searchParams);

      const targetPage = updates.page ?? pagination.page;
      const targetPageSize = updates.pageSize ?? pagination.pageSize;
      const targetTab = updates.tab ?? activeTab;
      const targetEventId = updates.eventId ?? selectedEventId;
      const targetPayment = updates.payment ?? paymentFilter;
      const targetSearch = updates.search !== undefined ? updates.search : debouncedSearch;

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

      if (targetSearch.trim()) newParams.set('search', targetSearch.trim());
      else newParams.delete('search');

      setSearchParams(newParams, { replace: true });
    },
    [searchParams, pagination.page, pagination.pageSize, activeTab, selectedEventId, paymentFilter, debouncedSearch, setSearchParams]
  );

  // Core data fetch function with server-side pagination and filters
  const fetchSalesData = useCallback(
    async (
      overrideParams?: {
        page?: number;
        pageSize?: number;
        tab?: 'all-time' | 'per-event';
        eventId?: string;
        payment?: 'ALL' | 'UPI' | 'CASH';
        search?: string;
      }
    ) => {
      const currentPage = overrideParams?.page ?? pagination.page;
      const currentPageSize = overrideParams?.pageSize ?? pagination.pageSize;
      const currentTab = overrideParams?.tab ?? activeTab;
      const currentEventId = overrideParams?.eventId ?? selectedEventId;
      const currentPayment = overrideParams?.payment ?? paymentFilter;
      const currentSearch = overrideParams?.search !== undefined ? overrideParams.search : debouncedSearch;

      setIsFetching(true);
      setErrorMessage(null);

      try {
        const query = new URLSearchParams();
        query.set('page', String(currentPage));
        query.set('pageSize', String(currentPageSize));

        if (currentTab === 'per-event' && currentEventId) {
          query.set('eventId', currentEventId);
        }
        if (currentPayment !== 'ALL') {
          query.set('paymentMethod', currentPayment);
        }
        if (currentSearch.trim()) {
          query.set('search', currentSearch.trim());
        }

        const res: SalesResponse = await api.get(`/sales?${query.toString()}`);

        if (res?.sales) {
          setSales(res.sales);
        }
        if (res?.pagination) {
          setPagination(res.pagination);
        }
        if (res?.summary) {
          setSummary(res.summary);
        }
      } catch (err: any) {
        console.error('Failed to load sales records:', err);
        setErrorMessage('Unable to load sales records. Please try again.');
      } finally {
        setIsLoading(false);
        setIsFetching(false);
      }
    },
    [pagination.page, pagination.pageSize, activeTab, selectedEventId, paymentFilter, debouncedSearch]
  );

  // Initial load: Fetch events list and first page of sales
  useEffect(() => {
    let isMounted = true;

    async function initialLoad() {
      try {
        const eventsRes = await api.get('/events');
        if (isMounted && eventsRes?.events) {
          setEvents(eventsRes.events);
          if (!selectedEventId && eventsRes.events.length > 0) {
            setSelectedEventId(eventsRes.events[0].id);
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

  // Fetch sales when filters, tab, event, or debounced search changes
  useEffect(() => {
    fetchSalesData({
      page: pageFromUrl,
      pageSize: pageSizeFromUrl,
      tab: activeTab,
      eventId: selectedEventId,
      payment: paymentFilter,
      search: debouncedSearch,
    });
  }, [pageFromUrl, pageSizeFromUrl, activeTab, selectedEventId, paymentFilter, debouncedSearch]);

  // Listen for real-time sales: reload current page without resetting state
  useEffect(() => {
    if (!socket) return;
    const handleNewSale = () => {
      fetchSalesData();
    };

    socket.on('sale:created', handleNewSale);
    return () => {
      socket.off('sale:created', handleNewSale);
    };
  }, [socket, fetchSalesData]);

  // Page navigation handlers
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.totalPages || newPage === pagination.page) return;
    updateUrlState({ page: newPage });
  };

  const handlePageSizeChange = (newSize: number) => {
    updateUrlState({ page: 1, pageSize: newSize });
  };

  const handleTabChange = (tab: 'all-time' | 'per-event') => {
    setActiveTab(tab);
    updateUrlState({ page: 1, tab });
  };

  const handleEventChange = (eventId: string) => {
    setSelectedEventId(eventId);
    updateUrlState({ page: 1, eventId });
  };

  const handlePaymentChange = (payment: 'ALL' | 'UPI' | 'CASH') => {
    setPaymentFilter(payment);
    updateUrlState({ page: 1, payment });
  };

  // Developer Edit Handlers
  const handleOpenEdit = (sale: Sale) => {
    setEditingSale(sale);
    setEditQty(sale.quantity);
    setEditPrice(sale.unitPrice || 0);
    setEditPaymentMethod(sale.paymentMethod);
    setEditCustomerName(sale.customerName || '');
    setEditCustomerPhone(sale.customerPhone || '');
    setEditSaleTime(sale.saleTime ? new Date(sale.saleTime).toISOString().slice(0, 16) : '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSale) return;
    setIsSavingEdit(true);
    try {
      const res = await api.put(`/sales/${editingSale.id}`, {
        quantity: editQty,
        unitPrice: editPrice,
        paymentMethod: editPaymentMethod,
        customerName: editCustomerName.trim() || null,
        customerPhone: editCustomerPhone.trim() || null,
        saleTime: editSaleTime ? new Date(editSaleTime).toISOString() : undefined,
      });
      if (res?.sale) {
        setSales(prev => prev.map(s => (s.id === editingSale.id ? res.sale : s)));
      }
      await fetchSalesData();
      setEditingSale(null);
      setActionMessage(`Sale #${editingSale.id} updated successfully!`);
      setTimeout(() => setActionMessage(null), 3500);
    } catch (err: any) {
      alert(err.message || 'Failed to update sale record');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteSale = async (id: number) => {
    if (!window.confirm(`Are you sure you want to delete Sale #${id}? This will permanently remove this transaction.`)) {
      return;
    }
    try {
      await api.delete(`/sales/${id}`);
      setActionMessage(`Sale #${id} deleted successfully!`);
      await fetchSalesData();
      setTimeout(() => setActionMessage(null), 3500);
    } catch (err: any) {
      alert(err.message || 'Failed to delete sale record');
    }
  };

  const handleClearAllSales = async () => {
    setIsClearing(true);
    try {
      const res = await api.delete('/sales/purge-all');
      setSales([]);
      setShowClearModal(false);
      setActionMessage(res?.message || 'All sales records cleared successfully!');
      await fetchSalesData({ page: 1 });
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Failed to clear sales');
    } finally {
      setIsClearing(false);
    }
  };

  // Export CSV Handler (fetches ALL matching records for the current filter criteria)
  const handleExportCSV = async () => {
    if (!canExport || pagination.totalRecords === 0) return;

    try {
      const query = new URLSearchParams();
      query.set('all', 'true');
      if (activeTab === 'per-event' && selectedEventId) {
        query.set('eventId', selectedEventId);
      }
      if (paymentFilter !== 'ALL') {
        query.set('paymentMethod', paymentFilter);
      }
      if (debouncedSearch.trim()) {
        query.set('search', debouncedSearch.trim());
      }

      const res: SalesResponse = await api.get(`/sales?${query.toString()}`);
      const exportList = res?.sales || sales;

      const headers = [
        'S.No.',
        'Sale ID',
        'Event ID',
        'Event Name',
        'Project',
        'Product ID',
        'Product Name',
        'Member Name',
        'Quantity',
        ...(canViewRevenue ? ['Unit Price (INR)', 'Total Amount (INR)'] : []),
        'Payment Method',
        ...(canViewPII ? ['Customer Name', 'Customer Phone'] : []),
        'Timestamp',
      ];

      const rows = exportList.map((s, idx) => [
        idx + 1,
        s.id,
        s.eventId,
        `"${(s.eventName || '').replace(/"/g, '""')}"`,
        `"${s.projectName || ''}"`,
        s.productId,
        `"${(s.productName || '').replace(/"/g, '""')}"`,
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
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ReceiptText className="w-5 h-5 text-slate-800" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Sales Ledger & Tracking
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Full audit log of recorded transactions with server-side pagination and real-time updates.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {isDeveloper && (
            <button
              onClick={() => setShowClearModal(true)}
              className="px-3.5 py-2 text-xs font-bold rounded-md border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="Purge all sales records to restart with fresh project data"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All Demo Sales</span>
            </button>
          )}

          {canExport && (
            <button
              onClick={handleExportCSV}
              disabled={pagination.totalRecords === 0}
              className="px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-lg flex items-center gap-2 shadow-sm animate-fade-in">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold rounded-lg flex items-center justify-between shadow-sm">
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleTabChange('all-time')}
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all cursor-pointer ${
              activeTab === 'all-time'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            All-Time Sales (Combined)
          </button>
          <button
            onClick={() => handleTabChange('per-event')}
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all cursor-pointer ${
              activeTab === 'per-event'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            Per-Event Sales
          </button>
        </div>

        {/* Per-Event Selector Dropdown */}
        {activeTab === 'per-event' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Event:</span>
            <select
              value={selectedEventId}
              onChange={e => handleEventChange(e.target.value)}
              className="text-xs font-semibold bg-white border border-slate-300 rounded-md p-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer"
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
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search */}
        <div className="w-full md:w-80 relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search product, serial #, member..."
            value={searchQuery}
            onChange={handleSearchInputChange}
            className="w-full pl-9 pr-8 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
          {isFetching && (
            <Loader2 className="w-3.5 h-3.5 absolute right-3 top-3 text-slate-400 animate-spin" />
          )}
        </div>

        {/* Payment Filter */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <span className="text-xs font-semibold text-slate-500">Payment:</span>
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {(['ALL', 'UPI', 'CASH'] as const).map(p => (
              <button
                key={p}
                onClick={() => handlePaymentChange(p)}
                className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                  paymentFilter === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Mini stats summary */}
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-500">Showing:</span>{' '}
            <span className="font-bold text-slate-900">
              {pagination.totalRecords === 0
                ? '0'
                : `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                    pagination.page * pagination.pageSize,
                    pagination.totalRecords
                  )}`}{' '}
              of {pagination.totalRecords} sales
            </span>
          </div>
          <div>
            <span className="text-slate-500">Units:</span>{' '}
            <span className="font-bold text-slate-900">{summary.totalUnits}</span>
          </div>
          {canViewRevenue && summary.totalRevenue !== null && (
            <div>
              <span className="text-slate-500">Total:</span>{' '}
              <span className="font-black text-emerald-700">
                ₹{summary.totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden relative">
        {/* Subtle loading overlay on page change without blanking table */}
        {isFetching && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-slate-900/10 overflow-hidden">
            <div className="w-full h-full bg-slate-800 animate-pulse" />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">S.No.</th>
                <th className="px-4 py-3">Project Name</th>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">Sales Member Name</th>
                <th className="px-4 py-3 text-right">Items Purchased</th>
                {canViewRevenue && <th className="px-4 py-3 text-right">Total Amount (₹)</th>}
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Time (Auto)</th>
                <th className="px-4 py-3">Event Name</th>
                <th className="px-4 py-3">Customer Info</th>
                {isDeveloper && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={canViewRevenue ? (isDeveloper ? 11 : 10) : (isDeveloper ? 10 : 9)}
                    className="px-4 py-12 text-center text-slate-400 text-xs"
                  >
                    <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin text-slate-400" />
                    Loading sales records...
                  </td>
                </tr>
              ) : sales.length === 0 ? (
                <tr>
                  <td
                    colSpan={canViewRevenue ? (isDeveloper ? 11 : 10) : (isDeveloper ? 10 : 9)}
                    className="px-4 py-8 text-center text-slate-400 text-xs"
                  >
                    No matching sales records found.
                  </td>
                </tr>
              ) : (
                sales.map((sale, index) => {
                  // S.No. formula: ((currentPage - 1) * pageSize) + rowIndex + 1
                  const displaySerial = (pagination.page - 1) * pagination.pageSize + index + 1;

                  return (
                    <tr key={sale.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-mono font-bold text-slate-900">
                        {displaySerial}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 border border-slate-200">
                          {sale.projectName}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {sale.productName}
                        <span className="block text-[10px] text-slate-400 font-normal font-mono">
                          {sale.productId}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {sale.memberName}
                        <span className="block text-[10px] text-slate-400 font-mono">
                          @{sale.memberUsername}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">
                        {sale.quantity}
                      </td>
                      {canViewRevenue && (
                        <td className="px-4 py-3 text-right font-black text-slate-900">
                          {sale.totalAmount !== null && sale.totalAmount !== undefined
                            ? `₹${sale.totalAmount.toFixed(2)}`
                            : '—'}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            sale.paymentMethod === 'UPI'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {sale.paymentMethod}
                        </span>
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
                      <td className="px-4 py-3 text-slate-600 font-medium">
                        {sale.eventName}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-[11px]">
                        {sale.customerName ? (
                          <div>
                            <div className="font-medium text-slate-800">{sale.customerName}</div>
                            <div className="text-slate-400">{sale.customerPhone || 'No phone'}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">None</span>
                        )}
                      </td>
                      {isDeveloper && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(sale)}
                              title="Edit Sale Record"
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSale(sale.id)}
                              title="Delete Sale Record"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Clean Pagination Footer */}
        <div className="bg-white px-4 py-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3 text-slate-600">
            <span>
              Showing{' '}
              <span className="font-bold text-slate-900">
                {pagination.totalRecords === 0
                  ? 0
                  : (pagination.page - 1) * pagination.pageSize + 1}
              </span>
              –
              <span className="font-bold text-slate-900">
                {Math.min(pagination.page * pagination.pageSize, pagination.totalRecords)}
              </span>{' '}
              of <span className="font-bold text-slate-900">{pagination.totalRecords}</span> sales
            </span>

            <div className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
              <span className="text-slate-500 font-medium">Rows per page:</span>
              <select
                value={pagination.pageSize}
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

          <div className="flex items-center gap-1 self-center sm:self-auto">
            {/* Previous button */}
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={!pagination.hasPreviousPage || isFetching}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>

            {/* Page number buttons */}
            {getPageNumbers(pagination.page, pagination.totalPages).map((p, idx) =>
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
                  className={`min-w-[32px] px-2 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    pagination.page === p
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {p}
                </button>
              )
            )}

            {/* Next button */}
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={!pagination.hasNextPage || isFetching}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Edit Sale Modal (DEVELOPER ONLY) */}
      {editingSale && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Edit Sale Record (DB ID: #{editingSale.id})
                </h3>
                <p className="text-[11px] text-slate-500">
                  {editingSale.productName} ({editingSale.productId}) • {editingSale.eventName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSale(null)}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-md font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-md font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
              </div>

              {/* Calculated Total */}
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-between font-semibold">
                <span className="text-slate-600">Calculated Total:</span>
                <span className="text-sm font-black text-emerald-700">
                  ₹{(editQty * editPrice).toFixed(2)}
                </span>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditPaymentMethod('CASH')}
                    className={`py-2 px-3 rounded-md font-bold text-center border transition-all cursor-pointer ${
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
                    className={`py-2 px-3 rounded-md font-bold text-center border transition-all cursor-pointer ${
                      editPaymentMethod === 'UPI'
                        ? 'border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    📱 UPI
                  </button>
                </div>
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingSale(null)}
                  disabled={isSavingEdit}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-4 py-2 bg-slate-900 text-white font-bold rounded-md hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clear All Sales Confirmation Modal */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Clear All Demo Sales?
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                This will permanently delete all sales records from the database so you can record fresh project sales. This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                disabled={isClearing}
                className="flex-1 py-2.5 border border-slate-300 text-slate-700 font-semibold text-xs rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAllSales}
                disabled={isClearing}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-md shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                {isClearing ? 'Clearing...' : 'Yes, Delete All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
