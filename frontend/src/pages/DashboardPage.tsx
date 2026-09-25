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
  IndianRupee,
  ShoppingCart,
  Boxes,
  Users,
  FolderTree,
  ArrowUpRight,
  ReceiptText,
  Clock,
  Sparkles,
  Zap,
  Activity,
  Gamepad2,
  Trophy,
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

  const totalUnitsSold = sales.reduce((acc, s) => acc + s.quantity, 0);
  const totalRevenue = sales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalStockOnHand = inventory.reduce((acc, i) => acc + i.quantityOnHand, 0);
  const averageTransactionValue = sales.length > 0 ? totalRevenue / sales.length : 0;

  // Games stats breakdown
  const gameSales = useMemo(() => {
    return sales.filter(s => s.transactionType === 'GAME' || !!s.gameId);
  }, [sales]);

  const gameRevenue = useMemo(() => {
    return gameSales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
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

  const activeEventRevenue = activeEventSales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const activeEventUnitsSold = activeEventSales.reduce((acc, s) => acc + s.quantity, 0);
  const activeEventAllocatedTotal = useMemo(() => {
    if (!activeEvent || !activeEvent.allocations) return 0;
    return activeEvent.allocations.reduce((acc, a) => acc + a.allocatedQty, 0);
  }, [activeEvent]);

  const activeEventProgressPct =
    activeEventAllocatedTotal > 0
      ? Math.min(100, Math.round((activeEventUnitsSold / activeEventAllocatedTotal) * 100))
      : 0;

  // Top Selling Products across all sales
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; project: string; units: number; revenue: number }>();
    sales.forEach(s => {
      const key = s.productId || s.productName;
      const cur = map.get(key) || { name: s.productName, project: s.projectName || '', units: 0, revenue: 0 };
      cur.units += s.quantity;
      cur.revenue += s.totalAmount || 0;
      map.set(key, cur);
    });
    return Array.from(map.values())
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);
  }, [sales]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Live Stall Operational Hero Banner */}
      {activeEvent ? (
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-2xl p-5 sm:p-6 shadow-md relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  LIVE STALL ACTIVE
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {activeEvent.location ? `At ${activeEvent.location}` : 'Campus Stall'}
                </span>
              </div>

              <div>
                <h1 className="text-2xl font-black tracking-tight text-white">
                  {activeEvent.name}
                </h1>
                <p className="text-xs text-slate-300 mt-1 max-w-xl">
                  {activeEvent.location
                    ? `Live stall operations in progress at ${activeEvent.location}. Inventory and bills are syncing in real time.`
                    : 'Live stall operations in progress. Inventory and bills are syncing in real time.'}
                </p>
              </div>

              {/* Progress bar of event sales */}
              <div className="pt-2 max-w-md">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-300 font-semibold">
                    Stall Stock Sold: <strong>{activeEventUnitsSold}</strong> of {activeEventAllocatedTotal} units
                  </span>
                  <span className="text-emerald-400 font-bold">{activeEventProgressPct}%</span>
                </div>
                <div className="w-full h-2 bg-slate-700/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${activeEventProgressPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Quick action buttons & event quick stats */}
            <div className="flex flex-col sm:flex-row md:flex-col lg:flex-row items-stretch md:items-end gap-3 shrink-0">
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10 text-center sm:text-left min-w-[130px]">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Stall Sales
                </span>
                <span className="text-lg font-black text-white">
                  {activeEventSales.length} bills
                </span>
                {canViewRevenue && (
                  <span className="text-xs text-emerald-400 font-bold block mt-0.5">
                    ₹{activeEventRevenue.toFixed(0)}
                  </span>
                )}
              </div>

              <Link
                to="/games/play"
                className="inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md transition-all active:scale-95"
              >
                <Gamepad2 className="w-4 h-4" />
                <span>Play Game</span>
              </Link>

              <Link
                to="/sales-entry"
                className="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md transition-all active:scale-95"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Open New Sale (POS)</span>
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
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
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
            >
              <Gamepad2 className="w-4 h-4" />
              <span>Play Game</span>
            </Link>
            <Link
              to="/sales-entry"
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>New Sale</span>
            </Link>
          </div>
        </div>
      )}

      {/* 2. Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Revenue */}
        {canViewRevenue ? (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-sm hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Total Revenue
              </span>
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                ₹
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-3 tracking-tight">
              ₹{totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
              <span className="text-emerald-700 font-bold">All-time</span>
              <span>across {sales.length} transactions</span>
            </div>
          </div>
        ) : (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-sm hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Total Transactions
              </span>
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                <ReceiptText className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900 mt-3 tracking-tight">{sales.length}</div>
            <div className="text-xs text-slate-500 mt-1">Recorded sales bills</div>
          </div>
        )}

        {/* Total Units Sold */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-sm hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Units Sold
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <PackageCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-3 tracking-tight">
            {totalUnitsSold}
          </div>
          <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <span className="font-semibold text-slate-700">{events.length}</span> events held
          </div>
        </div>

        {/* Average Transaction Value (ATV) */}
        {canViewRevenue ? (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-sm hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Average Bill Value
              </span>
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-3 tracking-tight">
              ₹{averageTransactionValue.toFixed(0)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Per customer transaction
            </div>
          </div>
        ) : (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-sm hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Active Events
              </span>
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <Calendar className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900 mt-3 tracking-tight">
              {events.filter(e => e.status === 'ACTIVE').length}
            </div>
            <div className="text-xs text-slate-500 mt-1">Active college stalls</div>
          </div>
        )}

        {/* Live Main Inventory */}
        {canViewInventory ? (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-sm hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Stock On Hand
              </span>
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <Boxes className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-3 tracking-tight">
              {totalStockOnHand}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Across {inventory.length} catalog items
            </div>
          </div>
        ) : (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-sm hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Live Status
              </span>
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Activity className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl font-black text-slate-900 mt-3">Connected</div>
            <div className="text-xs text-emerald-600 font-medium mt-1">Real-time sync operational</div>
          </div>
        )}
      </div>

      {/* 3. Operational Split: Top Products & Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Top Selling Products List */}
        <div className="lg:col-span-6 bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
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
            <div className="py-8 text-center text-xs text-slate-400">No sales recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, idx) => {
                const maxUnits = topProducts[0]?.units || 1;
                const pct = Math.round((p.units / maxUnits) * 100);

                return (
                  <div key={p.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 text-center font-bold text-slate-400 text-[11px]">
                          #{idx + 1}
                        </span>
                        <span className="font-semibold text-slate-900 truncate">{p.name}</span>
                        {p.project && (
                          <span className="text-[9px] font-bold uppercase text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded shrink-0">
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
              className="p-3.5 bg-slate-50 hover:bg-emerald-50/50 border border-slate-200/70 hover:border-emerald-300 rounded-xl transition-all group flex items-start justify-between"
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
              className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between"
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
                className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between"
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
              className="p-3.5 bg-indigo-50/70 hover:bg-indigo-100/70 border border-indigo-200/80 rounded-xl transition-all group flex items-start justify-between"
            >
              <div>
                <div className="text-xs font-bold text-indigo-950 group-hover:text-indigo-900 transition-colors flex items-center gap-1.5">
                  <Gamepad2 className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Stall Games (Play)</span>
                </div>
                <div className="text-[11px] text-indigo-700/70 mt-0.5">Quick play & reward payout</div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-indigo-400 group-hover:text-indigo-700 transition-colors shrink-0 mt-0.5" />
            </Link>

            <Link
              to="/events"
              className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between"
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
                  className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900 group-hover:text-slate-950 transition-colors">
                      Manage Games
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Prizes, fees & rules setup</div>
                  </div>
                  <Gamepad2 className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors shrink-0 mt-0.5" />
                </Link>

                <Link
                  to="/projects-products"
                  className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between"
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
                  className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 hover:border-slate-300 rounded-xl transition-all group flex items-start justify-between"
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

      {/* 3.5. Dedicated Stall Games Section */}
      <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-900 text-white rounded-2xl p-5 shadow-xs border border-indigo-800/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-white tracking-wide uppercase">Stall Games & Rewards</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  Live Operations
                </span>
              </div>
              <p className="text-xs text-indigo-200/80 mt-0.5">
                Stall attraction games, entry fees, and reward product distributions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/games/play"
              className="px-3.5 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
            >
              <Gamepad2 className="w-3.5 h-3.5" />
              <span>Launch Game</span>
            </Link>
            <Link
              to="/games"
              className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg border border-white/15 transition-colors"
            >
              Manage Catalog
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-white/10 text-xs">
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-indigo-200/70 block">Total Plays</span>
            <span className="text-xl font-black text-white mt-1 block">{gameSales.length}</span>
            <span className="text-[10px] text-indigo-200/60 mt-0.5 block">Played by visitors</span>
          </div>
          {canViewRevenue && (
            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-indigo-200/70 block">Game Revenue</span>
              <span className="text-xl font-black text-emerald-400 mt-1 block">
                ₹{gameRevenue.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
              <span className="text-[10px] text-indigo-200/60 mt-0.5 block">Collected entry fees</span>
            </div>
          )}
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-indigo-200/70 block">Wins vs Losses</span>
            <div className="text-base font-black text-white mt-1 flex items-center gap-1.5">
              <span className="text-emerald-400 font-bold">{gameWins}W</span>
              <span className="text-white/40">/</span>
              <span className="text-amber-400 font-bold">{gameLosses}L</span>
            </div>
            <span className="text-[10px] text-indigo-200/60 mt-0.5 block">
              {gameSales.length > 0 ? `${Math.round((gameWins / gameSales.length) * 100)}% Win Rate` : 'No plays yet'}
            </span>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-indigo-200/70 block">Sessions Ledger</span>
            <Link
              to="/game-sessions"
              className="text-xs font-bold text-indigo-300 hover:text-white mt-2 inline-flex items-center gap-1 transition-colors"
            >
              <span>View Sessions</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
            <span className="text-[10px] text-indigo-200/60 mt-0.5 block">Complete audit trail</span>
          </div>
        </div>
      </div>

      {/* 4. Live Stream of Recent Sales */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Live Transaction Stream</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Updated automatically via WebSocket connection
            </p>
          </div>
          <Link
            to="/sales"
            className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5 transition-colors"
          >
            <span>View All Sales</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {sales.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">
            No sales recorded yet. Start recording sales in New Sale.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/60 text-slate-500 border-b border-slate-100 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Receipt #</th>
                  <th className="px-5 py-3">Product / Game</th>
                  <th className="px-5 py-3">Stall / Event</th>
                  <th className="px-5 py-3">Seller</th>
                  <th className="px-5 py-3 text-right">Units / Plays</th>
                  {canViewRevenue && <th className="px-5 py-3 text-right">Amount (₹)</th>}
                  <th className="px-5 py-3">Payment</th>
                  <th className="px-5 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.slice(0, 8).map(sale => (
                  <tr key={sale.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 font-mono font-bold text-slate-900">
                      #{sale.receiptNumber ?? '—'}
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-slate-900">
                      {sale.transactionType === 'GAME' ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-indigo-950 font-bold">🎮 {sale.game?.name || sale.productName}</span>
                            {sale.gameSession && (
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                                sale.gameSession.result === 'WIN' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                              }`}>
                                {sale.gameSession.result}
                              </span>
                            )}
                          </div>
                          <span className="block text-[10px] text-slate-400 font-normal mt-0.5">
                            {sale.rewardDescription ? `Reward: ${sale.rewardDescription}` : 'Stall Game'}
                          </span>
                        </div>
                      ) : (
                        <div>
                          {sale.productName}
                          <span className="block text-[10px] text-slate-400 font-normal mt-0.5">
                            {sale.projectName} &bull; {sale.productId}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 font-medium">
                      {sale.eventName}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700">
                      {sale.memberName}
                    </td>
                    <td className="px-5 py-3.5 text-right font-black text-slate-900">
                      {sale.quantity}
                    </td>
                    {canViewRevenue && (
                      <td className="px-5 py-3.5 text-right font-black text-slate-900">
                        {sale.totalAmount !== null && sale.totalAmount !== undefined
                          ? `₹${sale.totalAmount.toFixed(0)}`
                          : '—'}
                      </td>
                    )}
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
                    <td className="px-5 py-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                      {new Date(sale.saleTime).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
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
