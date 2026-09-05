import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { Sale, AppEvent } from '../types';
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
} from 'lucide-react';

export const SalesManagementPage: React.FC = () => {
  const { isDeveloper, isAdmin, hasPermission } = useAuth();
  const { socket } = useSocket();

  const [sales, setSales] = useState<Sale[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [activeTab, setActiveTab] = useState<'all-time' | 'per-event'>('all-time');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | 'UPI' | 'CASH'>('ALL');
  const [isLoading, setIsLoading] = useState(true);

  const canViewRevenue = isDeveloper || isAdmin || hasPermission('view_revenue');
  const canViewPII = isDeveloper || isAdmin || hasPermission('view_customer_pii');
  const canExport = isDeveloper || isAdmin || hasPermission('export_data');

  const fetchSalesData = async () => {
    try {
      const [salesRes, eventsRes] = await Promise.all([
        api.get('/sales'),
        api.get('/events'),
      ]);

      if (salesRes?.sales) setSales(salesRes.sales);
      if (eventsRes?.events) {
        setEvents(eventsRes.events);
        if (!selectedEventId && eventsRes.events.length > 0) {
          setSelectedEventId(eventsRes.events[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load sales records:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSalesData();
  }, []);

  // Listen for real-time sales
  useEffect(() => {
    if (!socket) return;
    const handleNewSale = () => {
      fetchSalesData();
    };

    socket.on('sale:created', handleNewSale);
    return () => {
      socket.off('sale:created', handleNewSale);
    };
  }, [socket]);

  // Tab & Filter Logic
  const filteredSales = sales.filter(s => {
    if (activeTab === 'per-event' && selectedEventId && s.eventId !== selectedEventId) {
      return false;
    }
    if (paymentFilter !== 'ALL' && s.paymentMethod !== paymentFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchProduct = s.productName?.toLowerCase().includes(q);
      const matchMember = s.memberName?.toLowerCase().includes(q);
      const matchEvent = s.eventName?.toLowerCase().includes(q);
      const matchProject = s.projectName?.toLowerCase().includes(q);
      const matchId = String(s.id).includes(q) || s.productId?.toLowerCase().includes(q);
      if (!matchProduct && !matchMember && !matchEvent && !matchProject && !matchId) {
        return false;
      }
    }
    return true;
  });

  // Export CSV Handler
  const handleExportCSV = () => {
    if (!canExport || filteredSales.length === 0) return;

    const headers = [
      'Serial No',
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

    const rows = filteredSales.map(s => [
      s.id,
      s.eventId,
      `"${s.eventName?.replace(/"/g, '""')}"`,
      `"${s.projectName}"`,
      s.productId,
      `"${s.productName?.replace(/"/g, '""')}"`,
      `"${s.memberName}"`,
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
  };

  const totalFilteredUnits = filteredSales.reduce((acc, s) => acc + s.quantity, 0);
  const totalFilteredRevenue = filteredSales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);

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
            Full audit log of recorded transactions with real-time updates and granular permission protection.
          </p>
        </div>

        {canExport && (
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm self-start sm:self-auto"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        )}
      </div>

      {/* Tabs: All-Time Sales vs Per-Event Sales */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('all-time')}
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all cursor-pointer ${
              activeTab === 'all-time'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            All-Time Sales (Combined)
          </button>
          <button
            onClick={() => setActiveTab('per-event')}
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
              onChange={e => setSelectedEventId(e.target.value)}
              className="text-xs font-semibold bg-white border border-slate-300 rounded-md p-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
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
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>

        {/* Payment Filter */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <span className="text-xs font-semibold text-slate-500">Payment:</span>
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {(['ALL', 'UPI', 'CASH'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPaymentFilter(p)}
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
            <span className="font-bold text-slate-900">{filteredSales.length} records</span>
          </div>
          <div>
            <span className="text-slate-500">Units:</span>{' '}
            <span className="font-bold text-slate-900">{totalFilteredUnits}</span>
          </div>
          {canViewRevenue && (
            <div>
              <span className="text-slate-500">Total:</span>{' '}
              <span className="font-black text-emerald-700">
                ₹{totalFilteredRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Serial No.</th>
                <th className="px-4 py-3">Project Name</th>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">Sales Member Name</th>
                <th className="px-4 py-3 text-right">Items Purchased</th>
                {canViewRevenue && <th className="px-4 py-3 text-right">Total Amount (₹)</th>}
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Time (Auto)</th>
                <th className="px-4 py-3">Event Name</th>
                <th className="px-4 py-3">Customer Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSales.length === 0 ? (
                <tr>
                  <td
                    colSpan={canViewRevenue ? 10 : 9}
                    className="px-4 py-8 text-center text-slate-400 text-xs"
                  >
                    No matching sales records found.
                  </td>
                </tr>
              ) : (
                filteredSales.map(sale => (
                  <tr key={sale.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      #{sale.id}
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
