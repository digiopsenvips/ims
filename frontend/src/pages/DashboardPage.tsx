import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { Sale, AppEvent, InventoryItem } from '../types';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  PackageCheck,
  Calendar,
  DollarSign,
  ShoppingCart,
  Boxes,
  Users,
  FolderTree,
  ArrowUpRight,
  ReceiptText,
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
        api.get('/sales'),
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

  // Listen for real-time sales and inventory updates
  useEffect(() => {
    if (!socket) return;

    socket.on('sale:created', loadDashboardData);
    socket.on('inventory:updated', loadDashboardData);
    socket.on('event:updated', loadDashboardData);

    return () => {
      socket.off('sale:created', loadDashboardData);
      socket.off('inventory:updated', loadDashboardData);
      socket.off('event:updated', loadDashboardData);
    };
  }, [socket]);

  // Aggregate Metrics
  const activeEventsCount = events.filter(e => e.status === 'ACTIVE').length;
  const totalUnitsSold = sales.reduce((acc, s) => acc + s.quantity, 0);
  const totalRevenue = sales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalStockOnHand = inventory.reduce((acc, i) => acc + i.quantityOnHand, 0);

  return (
    <div className="space-y-6">
      {/* Top Welcome Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Executive Overview
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Logged in as <span className="font-semibold text-slate-800">{user?.name}</span> &bull; Enactus VIPS-TC Operations
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/sales-entry"
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Open Sale Form</span>
          </Link>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Events */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Active Events
            </span>
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-slate-900 mt-3">{activeEventsCount}</div>
          <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
            <span className="font-bold text-slate-700">{events.length}</span> total scheduled
          </div>
        </div>

        {/* Total Units Sold */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Units Sold
            </span>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <PackageCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-slate-900 mt-3">{totalUnitsSold}</div>
          <div className="text-xs text-slate-500 mt-1">
            Across {sales.length} transactions
          </div>
        </div>

        {/* Total Revenue (if permitted) */}
        {canViewRevenue ? (
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Total Revenue
              </span>
              <div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900 mt-3">
              ₹{totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              All events combined
            </div>
          </div>
        ) : (
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Sales Transactions
              </span>
              <div className="w-9 h-9 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900 mt-3">{sales.length}</div>
            <div className="text-xs text-slate-500 mt-1">Revenue hidden per role</div>
          </div>
        )}

        {/* Live Main Inventory (if permitted) */}
        {canViewInventory && (
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Stock On Hand
              </span>
              <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Boxes className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900 mt-3">{totalStockOnHand}</div>
            <div className="text-xs text-slate-500 mt-1">
              Across {inventory.length} products
            </div>
          </div>
        )}
      </div>

      {/* Quick Access Modules */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
          Quick Access Modules
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {(isDeveloper || isAdmin) && (
            <Link
              to="/projects-products"
              className="p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:shadow-sm transition-all flex items-center justify-between group"
            >
              <div>
                <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                  Projects & Products
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Manage projects & products</div>
              </div>
              <FolderTree className="w-4 h-4 text-slate-400 group-hover:text-slate-800 transition-colors" />
            </Link>
          )}

          {canViewInventory && (
            <Link
              to="/inventory"
              className="p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:shadow-sm transition-all flex items-center justify-between group"
            >
              <div>
                <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                  Bulk Stock Intake
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Live counts & feeding</div>
              </div>
              <Boxes className="w-4 h-4 text-slate-400 group-hover:text-slate-800 transition-colors" />
            </Link>
          )}

          <Link
            to="/events"
            className="p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:shadow-sm transition-all flex items-center justify-between group"
          >
            <div>
              <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                Events & Pricing
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Per-event stock allocations</div>
            </div>
            <Calendar className="w-4 h-4 text-slate-400 group-hover:text-slate-800 transition-colors" />
          </Link>

          {(isDeveloper || isAdmin) ? (
            <Link
              to="/users"
              className="p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:shadow-sm transition-all flex items-center justify-between group"
            >
              <div>
                <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                  User Management
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">RBAC & permissions</div>
              </div>
              <Users className="w-4 h-4 text-slate-400 group-hover:text-slate-800 transition-colors" />
            </Link>
          ) : (
            <Link
              to="/sales"
              className="p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:shadow-sm transition-all flex items-center justify-between group"
            >
              <div>
                <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                  Sales Records
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">View all transactions</div>
              </div>
              <ReceiptText className="w-4 h-4 text-slate-400 group-hover:text-slate-800 transition-colors" />
            </Link>
          )}
        </div>
      </div>

      {/* Recent Live Sales Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Recent Transactions</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live ledger updated automatically via WebSocket
            </p>
          </div>
          <Link
            to="/sales"
            className="text-xs font-bold text-slate-700 hover:text-slate-950 flex items-center gap-1.5 transition-colors"
          >
            <span>View All Sales</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {sales.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">
            No sales recorded yet. Start recording sales in the Sales Portal.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Serial No.</th>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3">Event</th>
                  <th className="px-5 py-3">Sales Member</th>
                  <th className="px-5 py-3 text-right">Items</th>
                  {canViewRevenue && <th className="px-5 py-3 text-right">Total (₹)</th>}
                  <th className="px-5 py-3">Payment</th>
                  <th className="px-5 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.slice(0, 8).map(sale => (
                  <tr key={sale.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 font-mono font-bold text-slate-900">
                      #{sale.id}
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-slate-900">
                      {sale.productName}
                      <span className="block text-[10px] text-slate-400 font-normal mt-0.5">
                        {sale.projectName} &bull; {sale.productId}
                      </span>
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
                          ? `₹${sale.totalAmount.toFixed(2)}`
                          : '—'}
                      </td>
                    )}
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded text-[10px] font-bold ${
                          sale.paymentMethod === 'UPI'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {sale.paymentMethod}
                      </span>
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
