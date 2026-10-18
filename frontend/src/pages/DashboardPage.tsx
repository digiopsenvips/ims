import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { Sale, AppEvent, InventoryItem } from '../types';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  PackageCheck,
  Calendar,
  ShoppingCart,
  Boxes,
  Users,
  FolderTree,
  ArrowUpRight,
  ReceiptText,
  Sparkles,
  Activity,
  Gamepad2,
  Dices,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { user, isDeveloper, isAdmin, hasPermission } = useAuth();
  const { socket } = useSocket();

  const [sales, setSales] = useState<Sale[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const canViewRevenue = isDeveloper || isAdmin || hasPermission('view_revenue');
  const canViewInventory = isDeveloper || isAdmin || hasPermission('view_inventory');

  const loadDashboardData = async () => {
    try {
      const [salesRes, eventsRes] = await Promise.all([
        api.get('/sales?all=true'),
        api.get('/events'),
      ]);

      if (salesRes?.sales) setSales(salesRes.sales);
      if (eventsRes?.events) setEvents(eventsRes.events);

      if (canViewInventory) {
        const invRes = await api.get('/inventory');
        if (invRes?.inventory) setInventory(invRes.inventory);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  // Listen for real-time sales, inventory, and event updates
  useEffect(() => {
    if (!socket) return;

    socket.on('sale:created', loadDashboardData);
    socket.on('inventory:updated', loadDashboardData);
    socket.on('event:updated', loadDashboardData);
    socket.on('game:played', loadDashboardData);

    return () => {
      socket.off('sale:created', loadDashboardData);
      socket.off('inventory:updated', loadDashboardData);
      socket.off('event:updated', loadDashboardData);
      socket.off('game:played', loadDashboardData);
    };
  }, [socket]);

  // Calculations
  const activeEvent = useMemo(() => {
    const now = Date.now();
    return (
      events.find(e => e.status === 'ACTIVE' && now < new Date(e.endDatetime).getTime()) ||
      events.find(e => e.status === 'ACTIVE') ||
      events.find(e => e.status !== 'ENDED' && now < new Date(e.endDatetime).getTime()) ||
      null
    );
  }, [events]);

  // Helper to extract true units count from a sale (handling multi-item sales and legacy single-product sales)
  const getSaleUnits = (s: any): number => {
    if (s.items && Array.isArray(s.items) && s.items.length > 0) {
      return s.items.reduce((sum: number, it: any) => sum + (Number(it.quantity) || 0), 0);
    }
    return Number(s.quantity) || 0;
  };

  const totalUnitsSold = sales.reduce((acc, s) => acc + getSaleUnits(s), 0);
  const totalRevenue = sales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
  const totalStockOnHand = inventory.reduce((acc, i) => acc + (Number(i.quantityOnHand) || 0), 0);
  const averageTransactionValue = sales.length > 0 ? totalRevenue / sales.length : 0;

  // Games stats breakdown
  const gameSales = useMemo(() => {
    return sales.filter(s => s.transactionType === 'GAME' || !!s.gameId);
  }, [sales]);

  const gameRevenue = useMemo(() => {
    return gameSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
  }, [gameSales]);

  const gameWins = useMemo(() => {
    return gameSales.filter(s => s.gameSession?.result === 'WIN').length;
  }, [gameSales]);

  const gameLosses = useMemo(() => {
    return gameSales.filter(s => s.gameSession?.result === 'LOSE').length;
  }, [gameSales]);

  // Active event specific metrics
  const activeEventSales = useMemo(() => {
    if (!activeEvent) return [];
    return sales.filter(s => s.eventId === activeEvent.id);
  }, [sales, activeEvent]);

  const activeEventRevenue = activeEventSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
  const activeEventUnitsSold = activeEventSales.reduce((acc, s) => acc + getSaleUnits(s), 0);
  const activeEventAllocatedTotal = useMemo(() => {
    if (!activeEvent || !activeEvent.allocations) return 0;
    return activeEvent.allocations.reduce((acc, a) => acc + (Number(a.allocatedQty) || 0), 0);
  }, [activeEvent]);

  const activeEventProgressPct =
    activeEventAllocatedTotal > 0
      ? Math.min(100, Math.round((activeEventUnitsSold / activeEventAllocatedTotal) * 100))
      : 0;

  // Top Selling Products across all sales (handling line items, combos, and single products)
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; project: string; units: number; revenue: number }>();
    sales.forEach(s => {
      if (s.items && Array.isArray(s.items) && s.items.length > 0) {
        s.items.forEach(item => {
          const key = item.productId || item.productName || 'Unknown';
          const pName = item.productName || item.productId || 'Unknown Item';
          const prjName = item.projectName || s.projectName || '';
          const cur = map.get(key) || { name: pName, project: prjName, units: 0, revenue: 0 };
          cur.units += Number(item.quantity) || 1;
          cur.revenue += Number(item.lineTotal) || (Number(item.unitPrice) * (Number(item.quantity) || 1)) || 0;
          map.set(key, cur);
        });
      } else if (s.comboName || s.transactionType === 'COMBO') {
        const key = s.comboId || s.comboName || 'Combo';
        const cur = map.get(key) || { name: s.comboName || 'Special Combo Offer', project: s.projectName || 'Bundles', units: 0, revenue: 0 };
        cur.units += Number(s.quantity) || 1;
        cur.revenue += Number(s.totalAmount) || 0;
        map.set(key, cur);
      } else if (s.productId || s.productName) {
        const key = s.productId || s.productName || 'Unknown';
        const cur = map.get(key) || { name: s.productName || 'Product', project: s.projectName || '', units: 0, revenue: 0 };
        cur.units += Number(s.quantity) || 1;
        cur.revenue += Number(s.totalAmount) || 0;
        map.set(key, cur);
      }
    });
    return Array.from(map.values())
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);
  }, [sales]);

  // Clean IST timestamp formatter matching Sales History
  const formatTxTime = (dateStr: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    const datePart = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const timePart = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${datePart} ${timePart}`;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Live Stall Operational Hero Banner */}
      {activeEvent ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE STALL ACTIVE
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  {activeEvent.location ? `Location: ${activeEvent.location}` : 'Campus Stall'}
                </span>
              </div>

              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  {activeEvent.name}
                </h1>
                <p className="text-xs text-slate-500 mt-1 max-w-xl">
                  {activeEvent.location
                    ? `Live stall operations in progress at ${activeEvent.location}. Inventory and receipts are syncing in real time.`
                    : 'Live stall operations in progress. Inventory and receipts are syncing in real time.'}
                </p>
              </div>

              {/* Progress bar of event sales */}
              <div className="pt-1 max-w-md">
                <div className="flex items-center justify-between text-xs mb-1.5 text-slate-600">
                  <span className="font-medium">
                    Stall Stock Sold: <strong className="text-slate-900">{activeEventUnitsSold}</strong> of {activeEventAllocatedTotal} units
                  </span>
                  <span className="text-emerald-700 font-bold">{activeEventProgressPct}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                    style={{ width: `${activeEventProgressPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Quick action buttons & event quick stats */}
            <div className="flex flex-col sm:flex-row md:flex-col lg:flex-row items-stretch md:items-end gap-3 shrink-0">
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-center sm:text-left min-w-[140px]">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Stall Sales
                </span>
                <span className="text-lg font-black text-slate-900">
                  {activeEventSales.length} bills
                </span>
                {canViewRevenue && (
                  <span className="text-xs text-emerald-700 font-bold block mt-0.5">
                    ₹{activeEventRevenue.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                )}
              </div>

              <Link
                to="/games/play"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold rounded-xl shadow-2xs transition-colors cursor-pointer"
              >
                <Gamepad2 className="w-4 h-4" />
                <span>Play Game</span>
              </Link>

              <Link
                to="/sales-entry"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-2xs transition-colors cursor-pointer"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>New Sale (POS)</span>
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Operations Overview
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Welcome, <strong className="text-slate-800">{user?.name}</strong> &bull; Enactus VIPS-TC Inventory & Sales Management System
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/games/play"
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer"
            >
              <Gamepad2 className="w-4 h-4" />
              <span>Play Game</span>
            </Link>
            <Link
              to="/sales-entry"
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>New Sale (POS)</span>
            </Link>
          </div>
        </div>
      )}

      {/* 2. Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Revenue */}
        {canViewRevenue ? (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Total Revenue
              </span>
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center font-bold text-sm">
                ₹
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-3 tracking-tight">
              ₹{totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-slate-500 mt-1.5 flex items-center gap-1.5">
              <span className="text-emerald-700 font-bold">All-time</span>
              <span>across {sales.length} transactions</span>
            </div>
          </div>
        ) : (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Total Transactions
              </span>
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center">
                <ReceiptText className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-3 tracking-tight">
              {sales.length}
            </div>
            <div className="text-xs text-slate-500 mt-1.5">Recorded sales receipts</div>
          </div>
        )}

        {/* Total Units Sold */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between h-full">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Units Sold
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 flex items-center justify-center">
              <PackageCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-3 tracking-tight">
            {totalUnitsSold}
          </div>
          <div className="text-xs text-slate-500 mt-1.5 flex items-center gap-1.5">
            <span className="font-semibold text-slate-700">{events.length}</span> stalls & events held
          </div>
        </div>

        {/* Average Transaction Value (ATV) */}
        {canViewRevenue ? (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Average Bill Value
              </span>
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 border border-purple-100 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-3 tracking-tight">
              ₹{averageTransactionValue.toFixed(0)}
            </div>
            <div className="text-xs text-slate-500 mt-1.5">
              Per customer transaction
            </div>
          </div>
        ) : (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Active Events
              </span>
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 border border-purple-100 flex items-center justify-center">
                <Calendar className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-3 tracking-tight">
              {events.filter(e => e.status === 'ACTIVE').length}
            </div>
            <div className="text-xs text-slate-500 mt-1.5">Active college stalls</div>
          </div>
        )}

        {/* Live Main Inventory */}
        {canViewInventory ? (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Stock On Hand
              </span>
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center">
                <Boxes className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-3 tracking-tight">
              {totalStockOnHand}
            </div>
            <div className="text-xs text-slate-500 mt-1.5">
              Across {inventory.length} catalog items
            </div>
          </div>
        ) : (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Live Status
              </span>
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center">
                <Activity className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl font-black text-slate-900 mt-3">Connected</div>
            <div className="text-xs text-emerald-700 font-semibold mt-1.5">Real-time sync operational</div>
          </div>
        )}
      </div>

      {/* 3. Operational Split: Top Products & Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Top Selling Products List */}
        <div className="lg:col-span-6 bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Top Selling Products</h2>
              <p className="text-xs text-slate-500 mt-0.5">Most popular items by unit sales</p>
            </div>
            <Link
              to="/analytics"
              className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 transition-colors"
            >
              <span>Full Analytics</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {topProducts.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">No sales recorded yet.</div>
          ) : (
            <div className="space-y-3.5 my-auto">
              {topProducts.map((p, idx) => {
                const maxUnits = topProducts[0]?.units || 1;
                const pct = Math.round((p.units / maxUnits) * 100);

                return (
                  <div key={p.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 text-center font-bold text-slate-400 text-[11px]">
                          #{idx + 1}
                        </span>
                        <span className="font-semibold text-slate-900 truncate">{p.name}</span>
                        {p.project && (
                          <span className="text-[9px] font-bold uppercase text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded shrink-0">
                            {p.project}
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-black text-slate-900">{p.units} sold</span>
                        {canViewRevenue && (
                          <span className="text-slate-400 text-[11px] ml-2">
                            ₹{p.revenue.toFixed(0)}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Visual Bar */}
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Operations Modules */}
        <div className="lg:col-span-6 bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-3.5">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Operations Suite</h2>
            <p className="text-xs text-slate-500 mt-0.5">Quick access to organization modules</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              to="/sales-entry"
              className="p-3.5 bg-slate-50 hover:bg-emerald-50/50 border border-slate-200/70 hover:border-emerald-300 rounded-xl transition-all group flex items-start justify-between cursor-pointer"
            >
              <div>
                <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-800 transition-colors">
                  New Sale (POS)
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Fast stall checkout terminal</div>
              </div>
              <ShoppingCart className="w-4 h-4 text-slate-400 group-hover:text-emerald-700 transition-colors shrink-0 mt-0.5" />
            </Link>

            <Link
              to="/sales"
              className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between cursor-pointer"
            >
              <div>
                <div className="text-xs font-bold text-slate-900 group-hover:text-slate-950 transition-colors">
                  Sales History
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Filter, search & receipts</div>
              </div>
              <ReceiptText className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors shrink-0 mt-0.5" />
            </Link>

            {canViewInventory && (
              <Link
                to="/inventory"
                className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold text-slate-900 group-hover:text-slate-950 transition-colors">
                    Inventory
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Live warehouse stock & feeding</div>
                </div>
                <Boxes className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors shrink-0 mt-0.5" />
              </Link>
            )}

            <Link
              to="/games/play"
              className="p-3.5 bg-purple-50/60 hover:bg-purple-100/60 border border-purple-200/70 rounded-xl transition-all group flex items-start justify-between cursor-pointer"
            >
              <div>
                <div className="text-xs font-bold text-purple-900 group-hover:text-purple-950 transition-colors flex items-center gap-1.5">
                  <Gamepad2 className="w-3.5 h-3.5 text-purple-700" />
                  <span>Stall Games (Play)</span>
                </div>
                <div className="text-[11px] text-purple-700/80 mt-0.5">Quick play & reward payout</div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-purple-400 group-hover:text-purple-700 transition-colors shrink-0 mt-0.5" />
            </Link>

            <Link
              to="/events"
              className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between cursor-pointer"
            >
              <div>
                <div className="text-xs font-bold text-slate-900 group-hover:text-slate-950 transition-colors">
                  Events
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Stall allocations & event pricing</div>
              </div>
              <Calendar className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors shrink-0 mt-0.5" />
            </Link>

            {(isDeveloper || isAdmin) && (
              <>
                <Link
                  to="/games"
                  className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between cursor-pointer"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900 group-hover:text-slate-950 transition-colors">
                      Manage Games
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Prizes, fees & rules setup</div>
                  </div>
                  <Dices className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors shrink-0 mt-0.5" />
                </Link>

                <Link
                  to="/projects-products"
                  className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between cursor-pointer"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900 group-hover:text-slate-950 transition-colors">
                      Products
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Tahsin & Upcycle catalog</div>
                  </div>
                  <FolderTree className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors shrink-0 mt-0.5" />
                </Link>

                <Link
                  to="/users"
                  className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between cursor-pointer"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900 group-hover:text-slate-950 transition-colors">
                      Users
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Manage roles & member access</div>
                  </div>
                  <Users className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors shrink-0 mt-0.5" />
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 4. Dedicated Stall Games & Rewards Section (Polished Light Theme) */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 border border-purple-100 flex items-center justify-center shrink-0">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900 tracking-tight">Stall Games & Rewards</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                  Live Operations
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Stall attraction games, entry fees, and reward product distributions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Link
              to="/games/play"
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Gamepad2 className="w-3.5 h-3.5" />
              <span>Launch Game</span>
            </Link>
            <Link
              to="/games"
              className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>Manage Catalog</span>
            </Link>
          </div>
        </div>

        {/* 4 Games KPI Statistics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-4 border-t border-slate-100">
          <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200/60 flex flex-col justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Plays</span>
            <span className="text-2xl font-black text-slate-900 mt-1.5 block">{gameSales.length}</span>
            <span className="text-[11px] text-slate-500 mt-1 block">Recorded stall plays</span>
          </div>

          {canViewRevenue ? (
            <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200/60 flex flex-col justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Game Revenue</span>
              <span className="text-2xl font-black text-emerald-700 mt-1.5 block">
                ₹{gameRevenue.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
              <span className="text-[11px] text-slate-500 mt-1 block">Collected entry fees</span>
            </div>
          ) : (
            <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200/60 flex flex-col justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Active Games</span>
              <span className="text-2xl font-black text-purple-700 mt-1.5 block">1 Active</span>
              <span className="text-[11px] text-slate-500 mt-1 block">Available for stalls</span>
            </div>
          )}

          <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200/60 flex flex-col justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Wins vs Losses</span>
            <div className="text-2xl font-black text-slate-900 mt-1.5 flex items-center gap-1.5">
              <span className="text-emerald-700 font-bold">{gameWins}W</span>
              <span className="text-slate-300 font-light">/</span>
              <span className="text-slate-600 font-bold">{gameLosses}L</span>
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">
              {gameSales.length > 0 ? `${Math.round((gameWins / gameSales.length) * 100)}% Win Rate` : 'No plays recorded yet'}
            </span>
          </div>

          <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200/60 flex flex-col justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Sessions Ledger</span>
              <Link
                to="/game-sessions"
                className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-purple-700 hover:text-purple-900 group transition-colors"
              >
                <span>View Sessions</span>
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">Complete audit trail & CSV</span>
          </div>
        </div>
      </div>

      {/* 5. Live Transaction Stream */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ReceiptText className="w-4 h-4 text-emerald-600" />
              <h2 className="text-base font-bold text-slate-900 tracking-tight">Live Transaction Stream</h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Real-time
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Chronological transaction audit stream &bull; Showing recent {Math.min(8, sales.length)} of {sales.length} records
            </p>
          </div>
          <Link
            to="/sales"
            className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50/60 hover:bg-emerald-50 border border-emerald-200/70 rounded-lg transition-colors shrink-0 self-start sm:self-auto cursor-pointer"
          >
            <span>View All Sales ({sales.length})</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {sales.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 space-y-2">
            <ReceiptText className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-semibold text-slate-600">No transactions recorded yet</p>
            <p className="text-slate-400">Transactions processed in New Sale or Stall Games will appear here in real time.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-100 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3.5 font-bold">Receipt ID</th>
                  <th className="px-5 py-3.5 font-bold">Product / Game / Offer</th>
                  <th className="px-5 py-3.5 font-bold">Stall / Event</th>
                  <th className="px-5 py-3.5 font-bold">Cashier</th>
                  <th className="px-5 py-3.5 font-bold text-right">Units / Plays</th>
                  {canViewRevenue && <th className="px-5 py-3.5 font-bold text-right">Amount</th>}
                  <th className="px-5 py-3.5 font-bold">Payment</th>
                  <th className="px-5 py-3.5 font-bold text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.slice(0, 8).map(sale => (
                  <tr key={sale.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Receipt ID */}
                    <td className="px-5 py-3.5">
                      <span className="font-mono font-bold text-slate-900 bg-slate-100/80 px-2 py-0.5 rounded border border-slate-200/60 text-xs">
                        #{sale.receiptNumber ?? '—'}
                      </span>
                    </td>

                    {/* Product / Game / Combo */}
                    <td className="px-5 py-3.5">
                      {sale.transactionType === 'GAME' || !!sale.gameId ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-900 flex items-center gap-1">
                              <span>🎮</span>
                              <span>{sale.game?.name || sale.productName || 'Stall Game'}</span>
                            </span>
                            {sale.gameSession && (
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase border ${
                                sale.gameSession.result === 'WIN'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}>
                                {sale.gameSession.result === 'WIN' ? '🏆 Winner' : '❌ Consolation'}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {sale.rewardDescription ? (
                              <span>Reward: <strong className="text-slate-700">{sale.rewardDescription}</strong></span>
                            ) : (
                              <span>Stall Attraction Play</span>
                            )}
                          </div>
                        </div>
                      ) : sale.transactionType === 'COMBO' || !!sale.comboId ? (
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-900 flex items-center gap-1">
                            <span>🎁</span>
                            <span>{sale.comboName || sale.productName || 'Combo Offer'}</span>
                          </div>
                          {sale.items && sale.items.length > 0 ? (
                            <div className="text-[11px] text-slate-500 truncate max-w-xs">
                              {sale.items.map(it => `${it.productName} × ${it.quantity}`).join(', ')}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400">Bundle Offer</div>
                          )}
                        </div>
                      ) : sale.items && sale.items.length > 0 ? (
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-900">
                            {sale.items.map(it => `${it.productName} (${it.quantity})`).join(', ')}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {sale.items.length} line {sale.items.length === 1 ? 'item' : 'items'}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-900">{sale.productName || 'Product'}</div>
                          {sale.projectName && (
                            <div className="text-[11px] text-slate-400">
                              Project {sale.projectName}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Stall / Event */}
                    <td className="px-5 py-3.5 text-slate-700 font-medium">
                      {sale.eventName || 'Campus Stall'}
                    </td>

                    {/* Cashier */}
                    <td className="px-5 py-3.5 text-slate-800 font-medium">
                      {sale.memberName || 'Cashier'}
                    </td>

                    {/* Units / Plays */}
                    <td className="px-5 py-3.5 text-right font-black text-slate-900">
                      {getSaleUnits(sale)}
                    </td>

                    {/* Amount */}
                    {canViewRevenue && (
                      <td className="px-5 py-3.5 text-right font-black text-slate-900">
                        {sale.totalAmount !== null && sale.totalAmount !== undefined
                          ? `₹${Number(sale.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                          : '—'}
                      </td>
                    )}

                    {/* Payment Badge */}
                    <td className="px-5 py-3.5">
                      {sale.paymentMethod === 'CASH_UPI' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                          Cash + UPI
                        </span>
                      ) : sale.paymentMethod === 'UPI' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                          UPI
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Cash
                        </span>
                      )}
                    </td>

                    {/* Time */}
                    <td className="px-5 py-3.5 text-right text-slate-500 text-[11px] font-medium font-mono">
                      {formatTxTime(sale.saleTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
