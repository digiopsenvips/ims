import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import {
  SpecialSale,
  SpecialSaleItem,
  SpecialSalePayment,
  SpecialSalesStats,
  Product,
  Project,
  InventoryItem,
} from '../types';
import {
  Briefcase,
  Plus,
  Search,
  Filter,
  Calendar,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  Printer,
  MessageCircle,
  FileText,
  Tag,
  RefreshCw,
  Trash2,
  Eye,
  ShieldCheck,
  Check,
  CreditCard,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  Building2,
  User,
  Phone,
  Mail,
  Receipt,
  Sparkles,
  Info,
} from 'lucide-react';

const CUSTOMER_CATEGORIES = [
  'Faculty',
  'College Staff',
  'Bulk Order',
  'Institutional Order',
  'Corporate / Organisation',
  'Guest / VIP',
  'Other',
];

const PAYMENT_METHODS = [
  { value: 'UPI', label: 'UPI' },
  { value: 'CASH', label: 'Cash' },
  { value: 'CASH_UPI', label: 'Cash + UPI (Split)' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer / NEFT / IMPS' },
  { value: 'OTHER', label: 'Other' },
];

export const SpecialSalesPage: React.FC = () => {
  const { user, isDeveloper, isAdmin } = useAuth();
  const { socket } = useSocket();

  // Dashboard Data State
  const [sales, setSales] = useState<SpecialSale[]>([]);
  const [stats, setStats] = useState<SpecialSalesStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filters State
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [paymentFilter, setPaymentFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Modals & Panels State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [viewingSale, setViewingSale] = useState<SpecialSale | null>(null);
  const [paymentSale, setPaymentSale] = useState<SpecialSale | null>(null);
  const [cancelSale, setCancelSale] = useState<SpecialSale | null>(null);
  const [printingSale, setPrintingSale] = useState<SpecialSale | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Products & Warehouse Stock (for Creation/Edit)
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [warehouseStockMap, setWarehouseStockMap] = useState<Record<string, number>>({});
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);

  // Fetch Special Sales List
  const fetchSales = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (paymentFilter !== 'ALL') params.append('paymentStatus', paymentFilter);
      if (categoryFilter !== 'ALL') params.append('customerCategory', categoryFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      params.append('page', String(page));
      params.append('pageSize', String(pageSize));

      const res = await api.get<{ sales: SpecialSale[]; total: number; totalPages: number }>(
        `/special-sales?${params.toString()}`
      );
      setSales(res.sales || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err: any) {
      console.error('Failed to load special sales:', err);
      showToast('error', err.message || 'Failed to load special sales');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch Dashboard Stats
  const fetchStats = async () => {
    setIsStatsLoading(true);
    try {
      const res = await api.get<SpecialSalesStats>('/special-sales/stats');
      setStats(res);
    } catch (err: any) {
      console.error('Failed to load stats:', err);
    } finally {
      setIsStatsLoading(false);
    }
  };

  // Fetch Catalog & Live Warehouse Stock
  const fetchCatalogAndStock = async () => {
    setIsLoadingCatalog(true);
    try {
      const [prodsRes, invRes] = await Promise.all([
        api.get<any>('/products'),
        api.get<any>('/inventory'),
      ]);
      const prodsList = Array.isArray(prodsRes)
        ? prodsRes
        : (prodsRes?.products && Array.isArray(prodsRes.products) ? prodsRes.products : []);
      setCatalogProducts(prodsList);

      const invList = Array.isArray(invRes)
        ? invRes
        : (invRes?.inventory && Array.isArray(invRes.inventory) ? invRes.inventory : []);

      const stockMap: Record<string, number> = {};
      for (const item of invList) {
        if (item && item.productId) {
          stockMap[item.productId] = item.warehouseStock ?? item.quantityOnHand ?? 0;
        }
      }
      setWarehouseStockMap(stockMap);
    } catch (err: any) {
      console.error('Failed to load product catalog/stock:', err);
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  useEffect(() => {
    fetchSales();
  }, [page, pageSize, statusFilter, paymentFilter, categoryFilter, startDate, endDate]);

  useEffect(() => {
    fetchStats();
    fetchCatalogAndStock();
  }, []);

  // Real-time socket events
  useEffect(() => {
    if (!socket) return;
    const handleUpdate = () => {
      fetchSales();
      fetchStats();
      fetchCatalogAndStock();
    };
    socket.on('special_sale_created', handleUpdate);
    socket.on('special_sale_updated', handleUpdate);
    socket.on('special_sale_confirmed', handleUpdate);
    socket.on('special_sale_fulfilled', handleUpdate);
    socket.on('special_sale_cancelled', handleUpdate);
    socket.on('special_sale_payment_recorded', handleUpdate);

    return () => {
      socket.off('special_sale_created', handleUpdate);
      socket.off('special_sale_updated', handleUpdate);
      socket.off('special_sale_confirmed', handleUpdate);
      socket.off('special_sale_fulfilled', handleUpdate);
      socket.off('special_sale_cancelled', handleUpdate);
      socket.off('special_sale_payment_recorded', handleUpdate);
    };
  }, [socket]);

  const showToast = (type: 'success' | 'error' | 'info', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(prev => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // Trigger manual search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchSales();
  };

  // Status Badge Helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700 border border-slate-300">DRAFT</span>;
      case 'CONFIRMED':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-800 border border-blue-300">CONFIRMED</span>;
      case 'FULFILLED':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">✓ FULFILLED</span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-100 text-rose-800 border border-rose-300">CANCELLED</span>;
      default:
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  // Payment Status Badge Helper
  const getPaymentStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return <span className="px-2 py-0.5 text-[10px] font-black rounded bg-emerald-50 text-emerald-800 border border-emerald-200">PAID</span>;
      case 'PARTIALLY_PAID':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-800 border border-amber-300">PARTIAL</span>;
      case 'UNPAID':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-50 text-rose-800 border border-rose-200">UNPAID</span>;
      default:
        return <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-600">{status}</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 animate-in slide-in-from-top-3 fade-in duration-200">
          <div
            className={`px-4 py-3 rounded-xl shadow-xl border flex items-center gap-2.5 text-xs font-semibold ${
              toastMessage.type === 'success'
                ? 'bg-emerald-600 text-white border-emerald-700'
                : toastMessage.type === 'error'
                ? 'bg-rose-600 text-white border-rose-700'
                : 'bg-slate-900 text-white border-slate-800'
            }`}
          >
            {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {toastMessage.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
            {toastMessage.type === 'info' && <Info className="w-4 h-4 shrink-0" />}
            <span>{toastMessage.text}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="ml-2 hover:opacity-80 p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  Special Sales
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Direct / Bulk Orders
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage institutional orders, faculty purchases, and corporate bulk deals outside regular event stalls.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => {
              fetchSales();
              fetchStats();
              fetchCatalogAndStock();
            }}
            className="p-2 border border-slate-300 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
            title="Refresh Data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              fetchCatalogAndStock();
              setIsCreateOpen(true);
            }}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Special Sale</span>
          </button>
        </div>
      </div>

      {/* KPI Dashboard Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Special Sales Rev
          </span>
          <div className="text-lg font-black text-emerald-700 mt-1">
            ₹{stats ? stats.totalRevenue.toLocaleString('en-IN') : '0'}
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            Billed: ₹{stats ? stats.totalBilled.toLocaleString('en-IN') : '0'}
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Total Orders
          </span>
          <div className="text-lg font-black text-slate-900 mt-1">
            {stats ? stats.totalOrders : 0}
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            {stats ? stats.draftOrdersCount : 0} drafts in progress
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Units Sold
          </span>
          <div className="text-lg font-black text-blue-700 mt-1">
            {stats ? stats.totalUnits.toLocaleString('en-IN') : 0}
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            from warehouse stock
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Outstanding Due
          </span>
          <div className="text-lg font-black text-rose-600 mt-1">
            ₹{stats ? stats.outstandingAmount.toLocaleString('en-IN') : '0'}
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            {stats ? stats.pendingPaymentsCount : 0} orders pending
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Pending Fulfilment
          </span>
          <div className="text-lg font-black text-amber-600 mt-1">
            {stats ? stats.pendingFulfilmentCount : 0}
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            ready for dispatch
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Completed Orders
          </span>
          <div className="text-lg font-black text-emerald-800 mt-1">
            {stats ? stats.completedOrdersCount : 0}
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            fulfilled & preserved
          </span>
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by customer name, phone, reference (e.g. SS-1001), department, notes..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl cursor-pointer"
            >
              Search
            </button>
            {(searchQuery || statusFilter !== 'ALL' || paymentFilter !== 'ALL' || categoryFilter !== 'ALL' || startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('ALL');
                  setPaymentFilter('ALL');
                  setCategoryFilter('ALL');
                  setStartDate('');
                  setEndDate('');
                  setPage(1);
                }}
                className="px-3 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold text-xs rounded-xl cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-semibold text-[11px]">Order:</span>
            <select
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="p-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 font-medium"
            >
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="FULFILLED">Fulfilled</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Payment Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-semibold text-[11px]">Payment:</span>
            <select
              value={paymentFilter}
              onChange={e => {
                setPaymentFilter(e.target.value);
                setPage(1);
              }}
              className="p-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 font-medium"
            >
              <option value="ALL">All Payments</option>
              <option value="PAID">Paid</option>
              <option value="PARTIALLY_PAID">Partially Paid</option>
              <option value="UNPAID">Unpaid</option>
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-semibold text-[11px]">Category:</span>
            <select
              value={categoryFilter}
              onChange={e => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="p-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 font-medium"
            >
              <option value="ALL">All Categories</option>
              {CUSTOMER_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-slate-400 font-semibold text-[11px]">Dates:</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="p-1 text-xs border border-slate-300 rounded-lg"
              title="Start Date"
            />
            <span className="text-slate-400">&ndash;</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="p-1 text-xs border border-slate-300 rounded-lg"
              title="End Date"
            />
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
              <tr>
                <th scope="col" className="px-4 py-3">Reference</th>
                <th scope="col" className="px-4 py-3">Customer & Category</th>
                <th scope="col" className="px-3 py-3">Products & Units</th>
                <th scope="col" className="px-3 py-3 text-right">Amount</th>
                <th scope="col" className="px-3 py-3 text-right">Balance Due</th>
                <th scope="col" className="px-3 py-3 text-center">Payment</th>
                <th scope="col" className="px-3 py-3 text-center">Status</th>
                <th scope="col" className="px-3 py-3">Created By</th>
                <th scope="col" className="px-3 py-3">Date</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
                    <span>Loading special sales records...</span>
                  </td>
                </tr>
              ) : sales.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <Briefcase className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No special sales found</p>
                    <p className="text-[11px] mt-0.5">Create your first faculty, bulk, or institutional order above.</p>
                  </td>
                </tr>
              ) : (
                sales.map(sale => {
                  const isPaid = sale.paymentStatus === 'PAID';
                  const isCancelled = sale.status === 'CANCELLED';

                  return (
                    <tr key={sale.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{sale.reference}</span>
                          {sale.whatsappDeliveries && sale.whatsappDeliveries.length > 0 && (
                            <span
                              className={`w-2 h-2 rounded-full ${
                                sale.whatsappDeliveries[0].status === 'DELIVERED'
                                  ? 'bg-emerald-500'
                                  : sale.whatsappDeliveries[0].status === 'QUEUED' || sale.whatsappDeliveries[0].status === 'SENDING'
                                  ? 'bg-blue-500 animate-pulse'
                                  : 'bg-rose-400'
                              }`}
                              title={`WhatsApp Status: ${sale.whatsappDeliveries[0].status}`}
                            />
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{sale.customerName}</div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-0.5">
                          <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-medium">
                            {sale.customerCategory}
                          </span>
                          {sale.department && <span>&bull; {sale.department}</span>}
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-800">
                          {sale.items.length} {sale.items.length === 1 ? 'product' : 'products'}
                        </div>
                        <div className="text-[10px] font-bold text-slate-500">
                          {sale.totalUnits} total units
                        </div>
                      </td>

                      <td className="px-3 py-3 text-right font-black text-slate-900 whitespace-nowrap">
                        ₹{Number(sale.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        {Number(sale.discountAmount) > 0 && (
                          <div className="text-[10px] font-semibold text-emerald-700">
                            -₹{Number(sale.discountAmount).toFixed(2)} off
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3 text-right font-bold whitespace-nowrap">
                        {Number(sale.balanceDue) > 0 ? (
                          <span className="text-rose-600">
                            ₹{Number(sale.balanceDue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-semibold">₹0.00</span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {getPaymentStatusBadge(sale.paymentStatus)}
                      </td>

                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {getStatusBadge(sale.status)}
                      </td>

                      <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                        {sale.createdByName || 'Admin'}
                      </td>

                      <td className="px-3 py-3 text-slate-500 whitespace-nowrap text-[11px]">
                        {new Date(sale.createdAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingSale(sale)}
                            className="p-1.5 hover:bg-slate-100 text-slate-700 rounded-lg transition-colors cursor-pointer"
                            title="View Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Record payment button if balance due and not cancelled */}
                          {!isPaid && !isCancelled && sale.status !== 'DRAFT' && (
                            <button
                              type="button"
                              onClick={() => setPaymentSale(sale)}
                              className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold rounded-lg transition-colors cursor-pointer text-[10px] flex items-center gap-1"
                              title="Record Payment"
                            >
                              <CreditCard className="w-3 h-3" />
                              <span>Pay</span>
                            </button>
                          )}

                          {/* Print / Download Bill */}
                          <button
                            type="button"
                            onClick={() => setPrintingSale(sale)}
                            className="p-1.5 hover:bg-slate-100 text-slate-700 rounded-lg transition-colors cursor-pointer"
                            title="Print / View Bill"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>

                          {/* Cancel button if permitted */}
                          {!isCancelled && (
                            <button
                              type="button"
                              onClick={() => setCancelSale(sale)}
                              className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors cursor-pointer"
                              title="Cancel Order"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              Showing page {page} of {totalPages} ({total} total records)
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ================= MODAL: CREATE SPECIAL SALE ================= */}
      {isCreateOpen && (
        <CreateSpecialSaleModal
          products={catalogProducts}
          stockMap={warehouseStockMap}
          onClose={() => setIsCreateOpen(false)}
          onSuccess={(newSale, msg) => {
            setIsCreateOpen(false);
            showToast('success', msg);
            fetchSales();
            fetchStats();
            fetchCatalogAndStock();
          }}
        />
      )}

      {/* ================= MODAL: VIEW SPECIAL SALE DETAILS ================= */}
      {viewingSale && (
        <SpecialSaleDetailsModal
          sale={viewingSale}
          onClose={() => setViewingSale(null)}
          onSaleUpdated={updated => {
            setViewingSale(updated);
            fetchSales();
            fetchStats();
            fetchCatalogAndStock();
          }}
          onOpenPayment={s => {
            setViewingSale(null);
            setPaymentSale(s);
          }}
          onOpenPrint={s => {
            setViewingSale(null);
            setPrintingSale(s);
          }}
          onOpenCancel={s => {
            setViewingSale(null);
            setCancelSale(s);
          }}
          showToast={showToast}
        />
      )}

      {/* ================= MODAL: RECORD PAYMENT ================= */}
      {paymentSale && (
        <RecordPaymentModal
          sale={paymentSale}
          onClose={() => setPaymentSale(null)}
          onSuccess={(updated, msg) => {
            setPaymentSale(null);
            showToast('success', msg);
            fetchSales();
            fetchStats();
          }}
        />
      )}

      {/* ================= MODAL: CANCEL ORDER ================= */}
      {cancelSale && (
        <CancelOrderModal
          sale={cancelSale}
          onClose={() => setCancelSale(null)}
          onSuccess={(updated, msg) => {
            setCancelSale(null);
            showToast('success', msg);
            fetchSales();
            fetchStats();
            fetchCatalogAndStock();
          }}
        />
      )}

      {/* ================= MODAL: PRINT / DOWNLOAD BILL ================= */}
      {printingSale && (
        <SpecialSaleBillModal
          sale={printingSale}
          onClose={() => setPrintingSale(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
};

// =========================================================================
// SUB-COMPONENT: CREATE SPECIAL SALE MODAL (WIZARD)
// =========================================================================
interface CreateSpecialSaleModalProps {
  products: Product[];
  stockMap: Record<string, number>;
  onClose: () => void;
  onSuccess: (sale: SpecialSale, msg: string) => void;
}

interface DraftLineItem {
  productId: string;
  quantity: number;
  standardPrice: number;
  specialPrice: number;
  isOverridden: boolean;
  overrideReason?: string;
  discountAmount: number;
}

const CreateSpecialSaleModal: React.FC<CreateSpecialSaleModalProps> = ({
  products,
  stockMap,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step 1: Customer Details
  const [customerName, setCustomerName] = useState('');
  const [customerCategory, setCustomerCategory] = useState('Faculty');
  const [customCategory, setCustomCategory] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [department, setDepartment] = useState('');
  const [notes, setNotes] = useState('');

  // Step 2: Line Items
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('ALL');

  // Step 3: Discounts, Charges & Payment
  const [orderDiscount, setOrderDiscount] = useState<number>(0);
  const [discountReason, setDiscountReason] = useState('');
  const [additionalCharges, setAdditionalCharges] = useState<number>(0);
  const [chargesReason, setChargesReason] = useState('');
  const [confirmImmediately, setConfirmImmediately] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [initialPaymentAmount, setInitialPaymentAmount] = useState<string>('');
  const [cashAmount, setCashAmount] = useState<string>('');
  const [upiAmount, setUpiAmount] = useState<string>('');
  const [paymentReference, setPaymentReference] = useState('');
  const [sendWhatsApp, setSendWhatsApp] = useState(true);

  // Defensive safe product array
  const safeProducts = useMemo(() => (Array.isArray(products) ? products : []), [products]);

  // Filtered Products for Picker
  const filteredCatalog = useMemo(() => {
    return safeProducts.filter(p => {
      if (p.isDeleted || p.isArchived) return false;
      if (projectFilter !== 'ALL' && p.projectId !== projectFilter) return false;
      if (productSearch.trim()) {
        const q = productSearch.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
      }
      return true;
    });
  }, [safeProducts, projectFilter, productSearch]);

  const uniqueProjects = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of safeProducts) {
      if (p?.project) map.set(p.project.id, p.project.name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [safeProducts]);

  // Add product to cart
  const handleAddProduct = (prod: Product) => {
    const existingIndex = lineItems.findIndex(i => i.productId === prod.id);
    if (existingIndex >= 0) {
      const updated = [...lineItems];
      updated[existingIndex].quantity += 1;
      setLineItems(updated);
      return;
    }
    const stdPrice = Number(prod.basePrice || 0);
    setLineItems(prev => [
      ...prev,
      {
        productId: prod.id,
        quantity: 1,
        standardPrice: stdPrice,
        specialPrice: stdPrice,
        isOverridden: false,
        overrideReason: '',
        discountAmount: 0,
      },
    ]);
  };

  const handleRemoveProduct = (productId: string) => {
    setLineItems(prev => prev.filter(i => i.productId !== productId));
  };

  const handleUpdateItem = (productId: string, field: keyof DraftLineItem, val: any) => {
    setLineItems(prev =>
      prev.map(i => {
        if (i.productId !== productId) return i;
        const updated = { ...i, [field]: val };
        if (field === 'specialPrice') {
          updated.isOverridden = Math.abs(Number(val) - i.standardPrice) > 0.001;
        }
        return updated;
      })
    );
  };

  // Financial Computations
  const subtotal = useMemo(() => {
    let sum = 0;
    for (const item of lineItems) {
      const total = Math.max(0, item.specialPrice * item.quantity - item.discountAmount);
      sum += total;
    }
    return Math.round(sum * 100) / 100;
  }, [lineItems]);

  const totalAmount = useMemo(() => {
    const total = subtotal - (Number(orderDiscount) || 0) + (Number(additionalCharges) || 0);
    return Math.max(0, Math.round(total * 100) / 100);
  }, [subtotal, orderDiscount, additionalCharges]);

  const totalUnits = useMemo(() => {
    return lineItems.reduce((acc, i) => acc + i.quantity, 0);
  }, [lineItems]);

  // Step 1 Validation
  const handleProceedToStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!customerName.trim()) {
      setErrorMsg('Customer or Organisation name is required.');
      return;
    }
    setStep(2);
  };

  // Step 2 Validation
  const handleProceedToStep3 = () => {
    setErrorMsg(null);
    if (lineItems.length === 0) {
      setErrorMsg('Please select at least one product for this order.');
      return;
    }
    for (const item of lineItems) {
      if (item.quantity <= 0) {
        setErrorMsg(`Product '${item.productId}' has an invalid quantity (${item.quantity}).`);
        return;
      }
      if (confirmImmediately) {
        const whAvail = stockMap[item.productId] ?? 0;
        if (whAvail < item.quantity) {
          setErrorMsg(
            `Insufficient warehouse stock for product '${item.productId}'. Requested: ${item.quantity}, Available: ${whAvail} in warehouse.`
          );
          return;
        }
      }
    }
    // Default initial payment to full amount
    setInitialPaymentAmount(String(totalAmount));
    setStep(3);
  };

  // Final Submit
  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    const finalCategory = customerCategory === 'Other' && customCategory.trim()
      ? customCategory.trim()
      : customerCategory;

    const payload: any = {
      customerName: customerName.trim(),
      customerCategory: finalCategory,
      contactPerson: contactPerson.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      billingAddress: billingAddress.trim() || undefined,
      department: department.trim() || undefined,
      notes: notes.trim() || undefined,
      items: lineItems.map(i => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.specialPrice,
        overrideReason: i.overrideReason?.trim() || undefined,
        discountAmount: i.discountAmount,
      })),
      discountAmount: Number(orderDiscount) || 0,
      discountReason: discountReason.trim() || undefined,
      additionalCharges: Number(additionalCharges) || 0,
      chargesReason: chargesReason.trim() || undefined,
      confirmImmediately,
      sendWhatsApp,
    };

    if (confirmImmediately && Number(initialPaymentAmount) > 0) {
      payload.initialPayment = {
        paymentMethod,
        amount: Number(initialPaymentAmount),
        cashAmount: paymentMethod === 'CASH_UPI' ? Number(cashAmount) || 0 : undefined,
        upiAmount: paymentMethod === 'CASH_UPI' ? Number(upiAmount) || 0 : undefined,
        reference: paymentReference.trim() || undefined,
      };
    }

    try {
      const res: any = await api.post('/special-sales', payload);
      onSuccess(res.sale, res.message || 'Special sale processed successfully!');
    } catch (err: any) {
      console.error('Failed to create special sale:', err);
      setErrorMsg(err.message || 'Failed to create special sale.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]">
        {/* Header & Steps */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
              <Plus className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                Create Special Sale
              </h3>
              <p className="text-xs text-slate-500">
                Institutional orders, bulk faculty purchases, and negotiated special pricing.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Steps Tracker */}
        <div className="px-5 py-2.5 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center justify-between max-w-md mx-auto">
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === 1 ? 'bg-emerald-600 text-white' : step > 1 ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {step > 1 ? <Check className="w-3.5 h-3.5" /> : '1'}
              </span>
              <span className={`text-xs font-semibold ${step === 1 ? 'text-emerald-950 font-bold' : 'text-slate-500'}`}>
                Customer
              </span>
            </div>
            <div className={`h-0.5 w-12 sm:w-16 ${step > 1 ? 'bg-emerald-600' : 'bg-slate-200'}`} />
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === 2 ? 'bg-emerald-600 text-white' : step > 2 ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {step > 2 ? <Check className="w-3.5 h-3.5" /> : '2'}
              </span>
              <span className={`text-xs font-semibold ${step === 2 ? 'text-emerald-950 font-bold' : 'text-slate-500'}`}>
                Products & Prices
              </span>
            </div>
            <div className={`h-0.5 w-12 sm:w-16 ${step === 3 ? 'bg-emerald-600' : 'bg-slate-200'}`} />
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === 3 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                3
              </span>
              <span className={`text-xs font-semibold ${step === 3 ? 'text-emerald-950 font-bold' : 'text-slate-500'}`}>
                Summary & Pay
              </span>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-4 flex-1">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* ================= STEP 1: CUSTOMER DETAILS ================= */}
          {step === 1 && (
            <form onSubmit={handleProceedToStep2} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Customer / Organisation Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    placeholder="e.g. Prof. R. Sharma / Delhi University / TechCorp"
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Customer Category *
                  </label>
                  <select
                    value={customerCategory}
                    onChange={e => setCustomerCategory(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 bg-white font-medium text-slate-800"
                  >
                    {CUSTOMER_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                {customerCategory === 'Other' && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Specify Custom Category *
                    </label>
                    <input
                      type="text"
                      required
                      value={customCategory}
                      onChange={e => setCustomCategory(e.target.value)}
                      placeholder="e.g. Rotary Club / Inter-College Delegate"
                      className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={contactPerson}
                    onChange={e => setContactPerson(e.target.value)}
                    placeholder="e.g. Dr. Verma (HoD Chemistry)"
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Phone Number (WhatsApp Bill)
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="e.g. contact@institution.edu"
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Institution / Department
                  </label>
                  <input
                    type="text"
                    value={department}
                    onChange={e => setDepartment(e.target.value)}
                    placeholder="e.g. School of Law / VIPS-TC Admin"
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Billing / Delivery Address
                  </label>
                  <input
                    type="text"
                    value={billingAddress}
                    onChange={e => setBillingAddress(e.target.value)}
                    placeholder="e.g. Room 402, Block A, VIPS Campus, Pitampura, Delhi"
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Special Sale Notes
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. Ordered for Annual College Conclave gift hampers. Delivery required by Friday."
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Continue to Product Selection</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {/* ================= STEP 2: PRODUCT SELECTION & NEGOTIATED PRICING ================= */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Product Search & Project Filter */}
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2.5">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search catalog products by name or product ID..."
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <select
                    value={projectFilter}
                    onChange={e => setProjectFilter(e.target.value)}
                    className="p-1.5 text-xs border border-slate-300 rounded-lg bg-white font-medium text-slate-700"
                  >
                    <option value="ALL">All Projects</option>
                    {uniqueProjects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quick Add Suggestions Grid */}
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
                  {filteredCatalog.slice(0, 12).map(prod => {
                    const whAvail = stockMap[prod.id] ?? 0;
                    const isAdded = lineItems.some(i => i.productId === prod.id);
                    return (
                      <button
                        key={prod.id}
                        type="button"
                        onClick={() => handleAddProduct(prod)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
                          isAdded
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold'
                            : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        <span>{prod.name}</span>
                        <span className="font-mono text-[9px] text-slate-400">({prod.id})</span>
                        <span
                          className={`text-[9px] px-1 py-0.2 rounded font-black ${
                            whAvail > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          WH: {whAvail}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected Order Line Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th scope="col" className="px-3.5 py-2.5">Product</th>
                      <th scope="col" className="px-2 py-2.5 text-center">Warehouse</th>
                      <th scope="col" className="px-2 py-2.5 text-right w-20">Quantity</th>
                      <th scope="col" className="px-2 py-2.5 text-right w-24">Special Unit ₹</th>
                      <th scope="col" className="px-2 py-2.5 text-right w-20">Item Disc ₹</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Line Total</th>
                      <th scope="col" className="px-2 py-2.5 text-center w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lineItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          <Package className="w-6 h-6 mx-auto mb-1 text-slate-300" />
                          <span>No products added yet. Click on products above to add them to this order.</span>
                        </td>
                      </tr>
                    ) : (
                      lineItems.map(item => {
                        const prod = products.find(p => p.id === item.productId);
                        const whAvail = stockMap[item.productId] ?? 0;
                        const isStockShortage = item.quantity > whAvail;
                        const lineTotal = Math.max(0, item.specialPrice * item.quantity - item.discountAmount);

                        return (
                          <tr key={item.productId} className={`hover:bg-slate-50/70 ${isStockShortage ? 'bg-rose-50/50' : ''}`}>
                            <td className="px-3.5 py-2">
                              <div className="font-bold text-slate-900">{prod?.name || item.productId}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                <span>{item.productId}</span> &bull;{' '}
                                <span className="font-sans">Std: ₹{item.standardPrice.toFixed(2)}</span>
                              </div>
                              {item.isOverridden && (
                                <div className="mt-1">
                                  <input
                                    type="text"
                                    placeholder="Price override reason..."
                                    value={item.overrideReason || ''}
                                    onChange={e => handleUpdateItem(item.productId, 'overrideReason', e.target.value)}
                                    className="w-full text-[10px] p-1 border border-amber-300 rounded bg-amber-50 text-amber-900 placeholder:text-amber-500 font-medium"
                                  />
                                </div>
                              )}
                            </td>

                            <td className="px-2 py-2 text-center whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-black ${
                                  whAvail >= item.quantity
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                    : 'bg-rose-100 text-rose-800 border border-rose-300'
                                }`}
                              >
                                {whAvail}
                              </span>
                            </td>

                            <td className="px-2 py-2 text-right">
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={item.quantity}
                                onChange={e => handleUpdateItem(item.productId, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))}
                                className={`w-16 p-1 text-right text-xs border rounded-lg font-bold ${
                                  isStockShortage ? 'border-rose-400 ring-1 ring-rose-400 bg-rose-50 text-rose-900' : 'border-slate-300'
                                }`}
                              />
                            </td>

                            <td className="px-2 py-2 text-right">
                              <div className="relative">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={item.specialPrice}
                                  onChange={e => handleUpdateItem(item.productId, 'specialPrice', Math.max(0, parseFloat(e.target.value) || 0))}
                                  className={`w-20 p-1 text-right text-xs border rounded-lg font-bold ${
                                    item.isOverridden
                                      ? 'border-amber-400 ring-1 ring-amber-400 bg-amber-50 text-amber-900'
                                      : 'border-slate-300 text-slate-800'
                                  }`}
                                />
                                {item.isOverridden && (
                                  <span className="absolute -top-2.5 right-1 px-1 bg-amber-500 text-white rounded text-[8px] font-black uppercase tracking-tight">
                                    Special
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="px-2 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={item.discountAmount}
                                onChange={e => handleUpdateItem(item.productId, 'discountAmount', Math.max(0, parseFloat(e.target.value) || 0))}
                                className="w-16 p-1 text-right text-xs border border-slate-300 rounded-lg text-emerald-800 font-bold"
                              />
                            </td>

                            <td className="px-3 py-2 text-right font-black text-slate-900 whitespace-nowrap">
                              ₹{lineTotal.toFixed(2)}
                            </td>

                            <td className="px-2 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveProduct(item.productId)}
                                className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Order Running Totals Bar */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-slate-600">
                  <span>Total Items: <strong className="text-slate-900">{lineItems.length}</strong></span>
                  <span>&bull;</span>
                  <span>Total Units: <strong className="text-slate-900">{totalUnits}</strong></span>
                </div>
                <div className="text-sm font-black text-slate-900">
                  Subtotal: <span className="text-emerald-700">₹{subtotal.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Customer</span>
                </button>
                <button
                  type="button"
                  onClick={handleProceedToStep3}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Review Summary & Discounts</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ================= STEP 3: SUMMARY, DISCOUNTS & CONFIRMATION ================= */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Order Review Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs space-y-1.5">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Customer Summary
                  </div>
                  <div className="font-bold text-slate-900 text-sm">{customerName}</div>
                  <div className="text-slate-600">Category: <span className="font-semibold">{customerCategory}</span></div>
                  {contactPerson && <div className="text-slate-600">Contact: {contactPerson}</div>}
                  {phone && <div className="text-slate-600 font-mono">Phone: {phone}</div>}
                  {department && <div className="text-slate-600">Department: {department}</div>}
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs space-y-1.5">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Order Financials
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Products Subtotal:</span>
                    <span className="font-bold text-slate-900">₹{subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Order Discount:</span>
                    <span className="font-bold text-emerald-700">-₹{(Number(orderDiscount) || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Additional Charges:</span>
                    <span className="font-bold text-slate-900">+₹{(Number(additionalCharges) || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200 font-black text-sm">
                    <span className="text-slate-900">Total Payable:</span>
                    <span className="text-emerald-700">₹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Order Discount & Additional Charges Controls */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Discounts & Additional Charges
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Order Discount Amount (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={orderDiscount || ''}
                      onChange={e => setOrderDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                      placeholder="e.g. 150"
                      className="w-full p-2 border border-slate-300 rounded-lg text-emerald-800 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Discount Reason / Approval
                    </label>
                    <input
                      type="text"
                      value={discountReason}
                      onChange={e => setDiscountReason(e.target.value)}
                      placeholder="e.g. 10% Faculty Concession approved by President"
                      className="w-full p-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Additional Charges (Delivery / Packaging ₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={additionalCharges || ''}
                      onChange={e => setAdditionalCharges(Math.max(0, parseFloat(e.target.value) || 0))}
                      placeholder="e.g. 50"
                      className="w-full p-2 border border-slate-300 rounded-lg font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Charges Reason
                    </label>
                    <input
                      type="text"
                      value={chargesReason}
                      onChange={e => setChargesReason(e.target.value)}
                      placeholder="e.g. Custom gift packaging / Courier charges"
                      className="w-full p-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              {/* Order Status Action Selector */}
              <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-700" />
                    <div>
                      <h4 className="text-xs font-bold text-emerald-950">
                        Order Confirmation & Warehouse Allocation
                      </h4>
                      <p className="text-[11px] text-emerald-800">
                        Confirming immediately will atomically deduct <strong>{totalUnits} units</strong> from warehouse stock.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmImmediately(true)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        confirmImmediately
                          ? 'bg-emerald-700 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-300'
                      }`}
                    >
                      Confirm Now
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmImmediately(false)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        !confirmImmediately
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-300'
                      }`}
                    >
                      Save as Draft
                    </button>
                  </div>
                </div>

                {/* If Confirm Immediately: Initial Payment Section */}
                {confirmImmediately && (
                  <div className="pt-3 border-t border-emerald-200/80 space-y-3 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-emerald-950 mb-1">
                          Payment Method
                        </label>
                        <select
                          value={paymentMethod}
                          onChange={e => setPaymentMethod(e.target.value)}
                          className="w-full p-2 border border-emerald-300 rounded-lg bg-white font-medium text-slate-800"
                        >
                          {PAYMENT_METHODS.map(m => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-emerald-950 mb-1">
                          Amount Paid Now (₹)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={totalAmount}
                          step="1"
                          value={initialPaymentAmount}
                          onChange={e => setInitialPaymentAmount(e.target.value)}
                          className="w-full p-2 border border-emerald-300 rounded-lg font-black text-slate-900 bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-emerald-950 mb-1">
                          UTR / Reference / Cheque
                        </label>
                        <input
                          type="text"
                          value={paymentReference}
                          onChange={e => setPaymentReference(e.target.value)}
                          placeholder="e.g. UPI Ref / Bank UTR"
                          className="w-full p-2 border border-emerald-300 rounded-lg bg-white font-mono"
                        />
                      </div>
                    </div>

                    {paymentMethod === 'CASH_UPI' && (
                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <div>
                          <label className="block text-[11px] font-semibold text-emerald-950 mb-1">
                            Cash Portion (₹)
                          </label>
                          <input
                            type="number"
                            value={cashAmount}
                            onChange={e => setCashAmount(e.target.value)}
                            className="w-full p-1.5 border border-emerald-300 rounded-lg bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-emerald-950 mb-1">
                            UPI Portion (₹)
                          </label>
                          <input
                            type="number"
                            value={upiAmount}
                            onChange={e => setUpiAmount(e.target.value)}
                            className="w-full p-1.5 border border-emerald-300 rounded-lg bg-white"
                          />
                        </div>
                      </div>
                    )}

                    {phone && (
                      <div className="flex items-center gap-2 pt-2">
                        <input
                          type="checkbox"
                          id="sendWhatsAppCheck"
                          checked={sendWhatsApp}
                          onChange={e => setSendWhatsApp(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                        <label htmlFor="sendWhatsAppCheck" className="text-[11px] text-emerald-950 font-medium cursor-pointer flex items-center gap-1">
                          <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Automatically queue branded bill to customer's WhatsApp ({phone})</span>
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={isSubmitting}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Pricing</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleFinalSubmit}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Processing Order...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{confirmImmediately ? 'Confirm & Allocate Stock' : 'Save as Draft'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// =========================================================================
// SUB-COMPONENT: ORDER DETAILS SLIDE-OVER / MODAL
// =========================================================================
interface SpecialSaleDetailsModalProps {
  sale: SpecialSale;
  onClose: () => void;
  onSaleUpdated: (sale: SpecialSale) => void;
  onOpenPayment: (sale: SpecialSale) => void;
  onOpenPrint: (sale: SpecialSale) => void;
  onOpenCancel: (sale: SpecialSale) => void;
  showToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

const SpecialSaleDetailsModal: React.FC<SpecialSaleDetailsModalProps> = ({
  sale,
  onClose,
  onSaleUpdated,
  onOpenPayment,
  onOpenPrint,
  onOpenCancel,
  showToast,
}) => {
  const [isFulfilling, setIsFulfilling] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);

  // Confirm Draft Order
  const handleConfirmOrder = async () => {
    setIsConfirming(true);
    try {
      const res: any = await api.post(`/special-sales/${sale.id}/confirm`, {});
      showToast('success', res.message || 'Order confirmed and stock allocated!');
      onSaleUpdated(res.sale);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to confirm order.');
    } finally {
      setIsConfirming(false);
    }
  };

  // Mark Fulfilled
  const handleMarkFulfilled = async () => {
    setIsFulfilling(true);
    try {
      const res: any = await api.post(`/special-sales/${sale.id}/fulfill`, {});
      showToast('success', res.message || 'Order marked as fulfilled!');
      onSaleUpdated(res.sale);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to fulfill order.');
    } finally {
      setIsFulfilling(false);
    }
  };

  // Send WhatsApp Bill
  const handleSendWhatsApp = async () => {
    setIsSendingWhatsApp(true);
    try {
      const res: any = await api.post(`/special-sales/${sale.id}/send-whatsapp`, {});
      showToast('success', res.message || 'WhatsApp bill queued successfully!');
      // Refresh sale details to show updated whatsappDeliveries
      const fresh = await api.get<SpecialSale>(`/special-sales/${sale.id}`);
      onSaleUpdated(fresh);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to send WhatsApp bill.');
    } finally {
      setIsSendingWhatsApp(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-mono font-black text-sm shrink-0">
              {sale.reference.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                  {sale.reference}
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-200 text-slate-800">
                  {sale.status}
                </span>
                <span className="px-2 py-0.5 text-[10px] font-black rounded bg-emerald-100 text-emerald-800">
                  {sale.paymentStatus}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {sale.customerName} &bull; {sale.customerCategory}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-4 flex-1 text-xs">
          {/* Customer & Order Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Customer Information
              </span>
              <div className="font-bold text-slate-900 text-sm">{sale.customerName}</div>
              <div className="text-slate-600">Category: <span className="font-semibold">{sale.customerCategory}</span></div>
              {sale.contactPerson && <div className="text-slate-600">Contact Person: {sale.contactPerson}</div>}
              {sale.phone && <div className="text-slate-600 font-mono">Phone: {sale.phone}</div>}
              {sale.email && <div className="text-slate-600">Email: {sale.email}</div>}
              {sale.department && <div className="text-slate-600">Dept: {sale.department}</div>}
              {sale.billingAddress && <div className="text-slate-600">Address: {sale.billingAddress}</div>}
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Financial Summary
              </span>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Subtotal:</span>
                <span className="font-semibold text-slate-900">₹{Number(sale.subtotal).toFixed(2)}</span>
              </div>
              {Number(sale.discountAmount) > 0 && (
                <div className="flex items-center justify-between text-emerald-700">
                  <span>Discount:</span>
                  <span className="font-bold">-₹{Number(sale.discountAmount).toFixed(2)}</span>
                </div>
              )}
              {Number(sale.additionalCharges) > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Additional Charges:</span>
                  <span className="font-semibold text-slate-900">+₹{Number(sale.additionalCharges).toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-slate-200 font-black text-sm">
                <span>Total Amount:</span>
                <span className="text-slate-900">₹{Number(sale.totalAmount).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-emerald-800">
                <span>Amount Paid:</span>
                <span className="font-bold">₹{Number(sale.amountPaid).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between font-black text-rose-600">
                <span>Balance Due:</span>
                <span>₹{Number(sale.balanceDue).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Ordered Products ({sale.totalUnits} units)
            </h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
                  <tr>
                    <th scope="col" className="px-3.5 py-2">Product</th>
                    <th scope="col" className="px-2 py-2 text-right">Qty</th>
                    <th scope="col" className="px-2 py-2 text-right">Standard ₹</th>
                    <th scope="col" className="px-2 py-2 text-right">Special Price ₹</th>
                    <th scope="col" className="px-3 py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sale.items.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="px-3.5 py-2">
                        <div className="font-bold text-slate-900">{item.product?.name || item.productId}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {item.productId}
                          {item.isPriceOverridden && (
                            <span className="ml-1 text-amber-700 font-sans font-semibold">
                              (Negotiated: {item.overrideReason || 'Special pricing'})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-bold text-slate-900">{item.quantity}</td>
                      <td className="px-2 py-2 text-right text-slate-500">₹{Number(item.standardPrice).toFixed(2)}</td>
                      <td className="px-2 py-2 text-right font-bold text-slate-900">
                        ₹{Number(item.specialPrice).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-black text-slate-900">
                        ₹{Number(item.lineTotal).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment History Table */}
          {sale.payments && sale.payments.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Payment History ({sale.payments.length})
              </h4>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th scope="col" className="px-3 py-1.5">Date</th>
                      <th scope="col" className="px-3 py-1.5">Method</th>
                      <th scope="col" className="px-3 py-1.5 text-right">Amount</th>
                      <th scope="col" className="px-3 py-1.5">Reference / Notes</th>
                      <th scope="col" className="px-3 py-1.5">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sale.payments.map(pay => (
                      <tr key={pay.id}>
                        <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">
                          {new Date(pay.paidAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-3 py-1.5 font-bold text-slate-800">{pay.paymentMethod}</td>
                        <td className="px-3 py-1.5 text-right font-black text-emerald-700">
                          ₹{Number(pay.amount).toFixed(2)}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500 font-mono text-[11px]">
                          {pay.reference || pay.notes || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">{pay.recordedByName || 'Admin'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Audit Trail & WhatsApp Status */}
          <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1 text-[11px] text-slate-500">
            <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
              Audit Trail
            </div>
            <div>Created: {new Date(sale.createdAt).toLocaleString('en-IN')} by {sale.createdByName || 'Admin'}</div>
            {sale.confirmedAt && (
              <div>Confirmed: {new Date(sale.confirmedAt).toLocaleString('en-IN')} by {sale.confirmedByName || 'Admin'}</div>
            )}
            {sale.fulfilledAt && (
              <div>Fulfilled: {new Date(sale.fulfilledAt).toLocaleString('en-IN')} by {sale.fulfilledByName || 'Admin'}</div>
            )}
            {sale.cancelledAt && (
              <div className="text-rose-600 font-semibold">
                Cancelled: {new Date(sale.cancelledAt).toLocaleString('en-IN')} by {sale.cancelledByName || 'Admin'} (Reason: {sale.cancelReason})
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div className="p-3.5 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenPrint(sale)}
              className="px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 text-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Bill</span>
            </button>

            {sale.phone && (
              <button
                type="button"
                disabled={isSendingWhatsApp}
                onClick={handleSendWhatsApp}
                className="px-3 py-1.5 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 text-xs disabled:opacity-50"
              >
                <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>{isSendingWhatsApp ? 'Queuing...' : 'Send WhatsApp Bill'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {sale.status === 'DRAFT' && (
              <button
                type="button"
                disabled={isConfirming}
                onClick={handleConfirmOrder}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 text-xs disabled:opacity-50"
              >
                {isConfirming ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                <span>Confirm & Deduct Stock</span>
              </button>
            )}

            {sale.status === 'CONFIRMED' && (
              <button
                type="button"
                disabled={isFulfilling}
                onClick={handleMarkFulfilled}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 text-xs disabled:opacity-50"
              >
                {isFulfilling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>Mark Fulfilled</span>
              </button>
            )}

            {Number(sale.balanceDue) > 0 && sale.status !== 'CANCELLED' && sale.status !== 'DRAFT' && (
              <button
                type="button"
                onClick={() => onOpenPayment(sale)}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 text-xs"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Record Payment</span>
              </button>
            )}

            {sale.status !== 'CANCELLED' && (
              <button
                type="button"
                onClick={() => onOpenCancel(sale)}
                className="px-3 py-1.5 border border-rose-200 text-rose-700 hover:bg-rose-50 font-bold rounded-xl transition-colors cursor-pointer text-xs"
              >
                Cancel Order
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// =========================================================================
// SUB-COMPONENT: RECORD PAYMENT MODAL
// =========================================================================
interface RecordPaymentModalProps {
  sale: SpecialSale;
  onClose: () => void;
  onSuccess: (sale: SpecialSale, msg: string) => void;
}

const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  sale,
  onClose,
  onSuccess,
}) => {
  const [amount, setAmount] = useState<string>(String(sale.balanceDue));
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [reference, setPaymentReference] = useState('');
  const [notes, setNotes] = useState('');
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setErrorMsg('Please enter a valid positive payment amount.');
      setIsSubmitting(false);
      return;
    }

    try {
      const res: any = await api.post(`/special-sales/${sale.id}/payments`, {
        paymentMethod,
        amount: parsed,
        cashAmount: paymentMethod === 'CASH_UPI' ? parseFloat(cashAmount) || 0 : undefined,
        upiAmount: paymentMethod === 'CASH_UPI' ? parseFloat(upiAmount) || 0 : undefined,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        sendWhatsApp,
      });

      onSuccess(res.sale, res.message || 'Payment recorded successfully!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record payment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-emerald-700" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Record Payment</h3>
              <p className="text-[11px] text-slate-500">{sale.reference} &bull; {sale.customerName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          {errorMsg && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Total Order Value:</span>
              <span className="font-bold text-slate-900">₹{Number(sale.totalAmount).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Already Paid:</span>
              <span className="font-bold text-emerald-700">₹{Number(sale.amountPaid).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between font-black text-rose-600 pt-1 border-t border-slate-200">
              <span>Outstanding Due:</span>
              <span>₹{Number(sale.balanceDue).toFixed(2)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Payment Amount (₹) *
            </label>
            <input
              type="number"
              min="1"
              max={sale.balanceDue}
              step="0.5"
              required
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full p-2.5 border border-slate-300 rounded-xl font-black text-base text-slate-900 focus:ring-1 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Payment Method *
            </label>
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-medium"
            >
              {PAYMENT_METHODS.map(m => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {paymentMethod === 'CASH_UPI' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Cash ₹</label>
                <input
                  type="number"
                  value={cashAmount}
                  onChange={e => setCashAmount(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">UPI ₹</label>
                <input
                  type="number"
                  value={upiAmount}
                  onChange={e => setUpiAmount(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-xl"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Transaction Reference / UTR
            </label>
            <input
              type="text"
              value={reference}
              onChange={e => setPaymentReference(e.target.value)}
              placeholder="e.g. 431209384912 / Bank Cheque No."
              className="w-full p-2 border border-slate-300 rounded-xl font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Payment Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Final settlement received via NEFT"
              className="w-full p-2 border border-slate-300 rounded-xl"
            />
          </div>

          {sale.phone && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="sendPaymentWa"
                checked={sendWhatsApp}
                onChange={e => setSendWhatsApp(e.target.checked)}
                className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <label htmlFor="sendPaymentWa" className="text-[11px] text-slate-700 font-medium cursor-pointer">
                Send updated payment receipt to customer via WhatsApp ({sale.phone})
              </label>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 border border-slate-300 rounded-xl text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Record Payment</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =========================================================================
// SUB-COMPONENT: CANCEL ORDER MODAL
// =========================================================================
interface CancelOrderModalProps {
  sale: SpecialSale;
  onClose: () => void;
  onSuccess: (sale: SpecialSale, msg: string) => void;
}

const CancelOrderModal: React.FC<CancelOrderModalProps> = ({
  sale,
  onClose,
  onSuccess,
}) => {
  const [cancelReason, setCancelReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelReason.trim()) {
      setErrorMsg('Please specify a cancellation reason.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res: any = await api.post(`/special-sales/${sale.id}/cancel`, {
        cancelReason: cancelReason.trim(),
      });
      onSuccess(res.sale, res.message || 'Order cancelled successfully.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to cancel order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-slate-100 bg-rose-50/70 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-800 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-rose-700" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-rose-900">Cancel Special Sale</h3>
              <p className="text-[11px] text-rose-700">{sale.reference} &bull; {sale.customerName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3 text-xs">
          {errorMsg && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          <p className="text-slate-600 leading-relaxed">
            Are you sure you want to cancel order <strong>{sale.reference}</strong>?
            {sale.status === 'CONFIRMED' || sale.status === 'FULFILLED' ? (
              <span className="block mt-1 font-semibold text-emerald-800">
                All <strong>{sale.totalUnits} units</strong> previously allocated will be automatically returned to the warehouse inventory.
              </span>
            ) : (
              <span className="block mt-1 text-slate-500">
                This draft will be marked as cancelled. No warehouse movements occurred.
              </span>
            )}
          </p>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Cancellation Reason *
            </label>
            <textarea
              required
              rows={3}
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="e.g. Order cancelled by client due to event rescheduling / duplicate entry..."
              className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 border border-slate-300 rounded-xl text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              <span>Confirm Cancellation</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =========================================================================
// SUB-COMPONENT: PRINTABLE / DOWNLOADABLE BILL MODAL
// =========================================================================
interface SpecialSaleBillModalProps {
  sale: SpecialSale;
  onClose: () => void;
  showToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

const SpecialSaleBillModal: React.FC<SpecialSaleBillModalProps> = ({
  sale,
  onClose,
  showToast,
}) => {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[94vh]">
        {/* Modal Controls Bar (hidden during browser print) */}
        <div className="p-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-slate-700" />
            <span className="text-xs font-bold text-slate-900">Official Special Sale Invoice / Bill</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Invoice</span>
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Invoice Printable View */}
        <div ref={printRef} className="overflow-y-auto p-6 sm:p-8 space-y-6 text-xs text-slate-900 bg-white">
          {/* Header Branding */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-black flex items-center justify-center text-sm">
                  E
                </span>
                <span className="text-base font-black tracking-tight text-slate-900">
                  ENACTUS VIPS-TC
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 max-w-xs leading-relaxed">
                Student Social Entrepreneurship &amp; Sustainability Initiative<br />
                Vivekananda Institute of Professional Studies, Delhi
              </p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-bold block">
                SPECIAL SALE INVOICE
              </span>
              <div className="text-lg font-mono font-black text-slate-900 mt-0.5">
                {sale.reference}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Date: {new Date(sale.createdAt).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </div>
            </div>
          </div>

          {/* Customer & Order Metadata */}
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Billed To:
              </span>
              <div className="font-bold text-slate-900 text-sm">{sale.customerName}</div>
              <div className="text-slate-600">Category: <span className="font-semibold">{sale.customerCategory}</span></div>
              {sale.department && <div className="text-slate-600">Department: {sale.department}</div>}
              {sale.contactPerson && <div className="text-slate-600">Contact: {sale.contactPerson}</div>}
              {sale.phone && <div className="text-slate-600 font-mono">Phone: {sale.phone}</div>}
              {sale.billingAddress && <div className="text-slate-600">Address: {sale.billingAddress}</div>}
            </div>

            <div className="space-y-1 text-right">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Order Status
              </span>
              <div className="font-bold text-slate-800 uppercase tracking-wider">{sale.status}</div>
              <div className="text-slate-600">
                Payment: <strong className={sale.paymentStatus === 'PAID' ? 'text-emerald-700' : 'text-rose-600'}>{sale.paymentStatus}</strong>
              </div>
              {sale.paymentMethod && <div className="text-slate-500">Method: {sale.paymentMethod}</div>}
              {sale.confirmedAt && (
                <div className="text-slate-500 text-[10px]">
                  Confirmed: {new Date(sale.confirmedAt).toLocaleDateString('en-IN')}
                </div>
              )}
            </div>
          </div>

          {/* Items Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-700 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
                <tr>
                  <th scope="col" className="px-3.5 py-2">Item Description</th>
                  <th scope="col" className="px-2 py-2 text-right">Qty</th>
                  <th scope="col" className="px-2 py-2 text-right">Rate (₹)</th>
                  <th scope="col" className="px-2 py-2 text-right">Disc (₹)</th>
                  <th scope="col" className="px-3.5 py-2 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sale.items.map(item => (
                  <tr key={item.id}>
                    <td className="px-3.5 py-2">
                      <div className="font-bold text-slate-900">{item.product?.name || item.productId}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{item.productId}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-bold text-slate-900">{item.quantity}</td>
                    <td className="px-2 py-2 text-right text-slate-600">₹{Number(item.specialPrice).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-slate-500">
                      {Number(item.discountAmount) > 0 ? `-₹${Number(item.discountAmount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3.5 py-2 text-right font-black text-slate-900">
                      ₹{Number(item.lineTotal).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Financial Totals */}
          <div className="flex justify-end text-xs">
            <div className="w-64 space-y-1.5">
              <div className="flex items-center justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-bold text-slate-900">₹{Number(sale.subtotal).toFixed(2)}</span>
              </div>
              {Number(sale.discountAmount) > 0 && (
                <div className="flex items-center justify-between text-emerald-700 font-medium">
                  <span>Order Discount:</span>
                  <span>-₹{Number(sale.discountAmount).toFixed(2)}</span>
                </div>
              )}
              {Number(sale.additionalCharges) > 0 && (
                <div className="flex items-center justify-between text-slate-600">
                  <span>Additional Charges:</span>
                  <span>+₹{Number(sale.additionalCharges).toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between font-black text-sm pt-1.5 border-t border-slate-200">
                <span>Final Total:</span>
                <span className="text-slate-900">₹{Number(sale.totalAmount).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-emerald-800 font-bold">
                <span>Amount Paid:</span>
                <span>₹{Number(sale.amountPaid).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between font-black text-rose-600 pt-1 border-t border-slate-100">
                <span>Balance Outstanding:</span>
                <span>₹{Number(sale.balanceDue).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Payment Details */}
          {sale.payments && sale.payments.length > 0 && (
            <div className="pt-3 border-t border-slate-100 space-y-1 text-[11px] text-slate-500">
              <span className="font-bold uppercase tracking-wider text-[10px] text-slate-700 block">
                Recorded Payments:
              </span>
              {sale.payments.map((p, idx) => (
                <div key={p.id} className="flex items-center justify-between">
                  <span>
                    Payment #{idx + 1}: {p.paymentMethod} {p.reference ? `(${p.reference})` : ''} on{' '}
                    {new Date(p.paidAt).toLocaleDateString('en-IN')}
                  </span>
                  <span className="font-bold text-slate-800">₹{Number(p.amount).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Footer Declaration */}
          <div className="pt-8 border-t border-slate-200 flex items-end justify-between text-[11px] text-slate-400">
            <div>
              <p>Thank you for supporting social entrepreneurship &amp; sustainable livelihoods!</p>
              <p className="mt-0.5">Enactus VIPS-TC &bull; enactusvips.com &bull; instagram.com/vips.en</p>
            </div>
            <div className="text-right">
              <div className="w-32 border-b border-slate-300 pb-1 mb-1"></div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                Authorized Signatory
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpecialSalesPage;
