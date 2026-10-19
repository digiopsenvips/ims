import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { AnalyticsData, AppEvent, Project } from '../types';
import {
  BarChart3,
  Filter,
  Calendar,
  Layers,
  Award,
  Gamepad2,
  Trophy,
  Gift,
  RotateCcw,
  Store,
  TrendingUp,
  Percent,
  Banknote,
  Package,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';

const COLORS = [
  '#0f172a',
  '#059669',
  '#2563eb',
  '#d97706',
  '#7c3aed',
  '#e11d48',
  '#0891b2',
  '#4f46e5',
  '#10b981',
  '#f59e0b',
  '#6366f1',
  '#ec4899',
];

export const AnalyticsPage: React.FC = () => {
  const { isDeveloper, isAdmin, hasPermission } = useAuth();

  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  // Filter States
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Pie Chart Toggle
  const [pieMode, setPieMode] = useState<'product' | 'project'>('product');
  const [metricMode, setMetricMode] = useState<'units' | 'revenue'>('units');

  const [isLoading, setIsLoading] = useState(true);

  const canViewRevenue =
    isDeveloper || isAdmin || (analytics ? analytics.canViewRevenue : hasPermission('view_revenue'));

  const fetchAnalytics = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedEventId) params.append('eventId', selectedEventId);
      if (selectedProjectId) params.append('projectId', selectedProjectId);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const [data, evRes, prjRes] = await Promise.all([
        api.get(`/analytics/dashboard?${params.toString()}`),
        api.get('/events'),
        api.get('/projects'),
      ]);

      setAnalytics(data);
      if (evRes?.events) setEvents(evRes.events);
      if (prjRes?.projects) setProjects(prjRes.projects);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [selectedEventId, selectedProjectId, startDate, endDate]);

  const hasActiveFilters = Boolean(selectedEventId || selectedProjectId || startDate || endDate);

  const handleResetFilters = () => {
    setSelectedEventId('');
    setSelectedProjectId('');
    setStartDate('');
    setEndDate('');
  };

  const pieData = useMemo(() => {
    if (!analytics) return [];
    const source = pieMode === 'product' ? analytics.productShare : analytics.projectShare;
    return source
      .map(item => ({
        name: item.name,
        value: metricMode === 'revenue' && item.revenue !== undefined ? item.revenue : item.units,
      }))
      .filter(item => item.value > 0);
  }, [analytics, pieMode, metricMode]);

  const totalPieValue = useMemo(() => {
    return pieData.reduce((sum, item) => sum + item.value, 0);
  }, [pieData]);

  const formattedTimeTrend = useMemo(() => {
    if (!analytics?.timeTrend) return [];
    return analytics.timeTrend.map(item => {
      let displayDate = item.date;
      try {
        const d = new Date(item.date);
        displayDate = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      } catch {}
      return {
        ...item,
        displayDate,
      };
    });
  }, [analytics?.timeTrend]);

  return (
    <div className="space-y-5 w-full max-w-[1600px] mx-auto pb-12">
      {/* Page Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/70 flex items-center justify-center font-black shadow-xs shrink-0">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Analytics
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Sales trends, project contributions, stall outputs, and promotional performance.
            </p>
          </div>
        </div>

        {/* Global Metric Mode Toggle (Units vs Revenue) */}
        {canViewRevenue && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-xs font-semibold text-slate-500">Metric Mode:</span>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/70 p-1 text-xs">
              <button
                onClick={() => setMetricMode('units')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  metricMode === 'units'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Units Sold
              </button>
              <button
                onClick={() => setMetricMode('revenue')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  metricMode === 'revenue'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Revenue (₹)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 flex-wrap flex-1">
          <div className="flex items-center gap-1.5 font-bold text-slate-700">
            <Filter className="w-4 h-4 text-slate-400" />
            <span>Filters:</span>
          </div>

          {/* Event Filter */}
          <select
            value={selectedEventId}
            onChange={e => setSelectedEventId(e.target.value)}
            className="text-xs font-semibold bg-white border border-slate-300 rounded-xl py-2 px-3 text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
          >
            <option value="">All Events / Stalls</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>

          {/* Project Filter */}
          <select
            value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value)}
            className="text-xs font-semibold bg-white border border-slate-300 rounded-xl py-2 px-3 text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Date Range */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-semibold text-slate-500">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-transparent text-xs text-slate-800 focus:outline-none font-medium cursor-pointer"
            />
            <span className="text-[11px] font-semibold text-slate-400">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-transparent text-xs text-slate-800 focus:outline-none font-medium cursor-pointer"
            />
          </div>
        </div>

        {hasActiveFilters && (
          <button
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors cursor-pointer"
            title="Reset active filters"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Filters</span>
          </button>
        )}
      </div>

      {isLoading || !analytics ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-16 text-center text-xs text-slate-400 shadow-xs">
          <BarChart3 className="w-8 h-8 mx-auto mb-2 animate-bounce text-slate-400" />
          <p className="font-semibold text-slate-600">Loading analytics visualizations...</p>
        </div>
      ) : (
        <>
          {/* Top Charts Grid: Donut Chart & Timeline */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Donut Chart: Sales Share by Product / Project */}
            <div className="lg:col-span-6 bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {pieMode === 'product' ? 'Product Share Distribution' : 'Project Share Breakdown'}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Measured by {metricMode === 'revenue' && canViewRevenue ? 'gross revenue generated' : 'units sold'}
                  </p>
                </div>

                {/* Toggle: by Product vs by Project */}
                <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs">
                  <button
                    onClick={() => setPieMode('product')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      pieMode === 'product'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Product
                  </button>
                  <button
                    onClick={() => setPieMode('project')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      pieMode === 'project'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Project
                  </button>
                </div>
              </div>

              {pieData.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-xs text-slate-400">
                  <Package className="w-8 h-8 text-slate-300 mb-2" />
                  <span>No sales data recorded in this timeframe</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center mt-3">
                  {/* Left: Donut Chart */}
                  <div className="sm:col-span-6 h-56 relative flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={78}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {pieData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(val: any) =>
                            metricMode === 'revenue' && canViewRevenue
                              ? [`₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'Revenue']
                              : [`${val} units`, 'Units Sold']
                          }
                          contentStyle={{
                            backgroundColor: '#0f172a',
                            borderColor: '#1e293b',
                            borderRadius: '0.75rem',
                            color: '#ffffff',
                            fontSize: '11px',
                          }}
                          itemStyle={{ color: '#ffffff' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total</span>
                      <span className="text-base font-black text-slate-900">
                        {metricMode === 'revenue' && canViewRevenue
                          ? `₹${totalPieValue.toLocaleString('en-IN')}`
                          : totalPieValue}
                      </span>
                    </div>
                  </div>

                  {/* Right: Clean, Structured, Scrollable Legend */}
                  <div className="sm:col-span-6 max-h-56 overflow-y-auto space-y-1.5 pr-1 text-xs">
                    {pieData.map((item, idx) => {
                      const pct = totalPieValue > 0 ? ((item.value / totalPieValue) * 100).toFixed(1) : '0';
                      return (
                        <div
                          key={item.name}
                          className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                              style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                            />
                            <span className="truncate font-semibold text-slate-800" title={item.name}>
                              {item.name}
                            </span>
                          </div>
                          <div className="text-right shrink-0 flex items-center gap-2">
                            <span className="font-bold text-slate-900">
                              {metricMode === 'revenue' && canViewRevenue
                                ? `₹${item.value.toLocaleString('en-IN')}`
                                : `${item.value}u`}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono w-9 text-right">{pct}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Daily Sales Timeline */}
            <div className="lg:col-span-6 bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div className="pb-3 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">Daily Sales Timeline</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {metricMode === 'revenue' && canViewRevenue ? 'Gross revenue progression over time' : 'Unit volume progression over time'}
                </p>
              </div>

              <div className="h-64 mt-3">
                {formattedTimeTrend.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-xs text-slate-400">
                    <TrendingUp className="w-8 h-8 text-slate-300 mb-2" />
                    <span>No daily transactions recorded in this range</span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={formattedTimeTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="5%"
                            stopColor={metricMode === 'revenue' && canViewRevenue ? '#059669' : '#0f172a'}
                            stopOpacity={0.15}
                          />
                          <stop
                            offset="95%"
                            stopColor={metricMode === 'revenue' && canViewRevenue ? '#059669' : '#0f172a'}
                            stopOpacity={0.0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="displayDate"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        stroke="#cbd5e1"
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        stroke="#cbd5e1"
                      />
                      <Tooltip
                        formatter={(val: any) =>
                          metricMode === 'revenue' && canViewRevenue
                            ? [`₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'Revenue']
                            : [`${val} units`, 'Units Sold']
                        }
                        labelFormatter={(label: any) => `Date: ${label}`}
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#1e293b',
                          borderRadius: '0.75rem',
                          color: '#ffffff',
                          fontSize: '11px',
                        }}
                        itemStyle={{ color: '#ffffff' }}
                      />
                      <Area
                        type="monotone"
                        dataKey={metricMode === 'revenue' && canViewRevenue ? 'revenue' : 'units'}
                        stroke={metricMode === 'revenue' && canViewRevenue ? '#059669' : '#0f172a'}
                        fill="url(#colorSales)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Stall / Event Performance & Best Sellers */}
          {analytics.canViewEventBreakdown && (
            <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">
                  Stall & Event Breakdown
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Best-selling product and total output per pop-up event
                </p>
              </div>

              {analytics.stallPerformance.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No event breakdown data available for the active filters.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[750px]">
                    <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="px-4 py-3">Event / Stall</th>
                        <th className="px-4 py-3">Best-Selling Product</th>
                        <th className="px-4 py-3 text-right">Best Seller Units</th>
                        <th className="px-4 py-3 text-right">Total Units Sold</th>
                        {canViewRevenue && <th className="px-4 py-3 text-right">Total Revenue (₹)</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analytics.stallPerformance.map(item => (
                        <tr key={item.eventId} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {item.eventName}
                          </td>
                          <td className="px-4 py-3 text-slate-800">
                            <div className="flex items-center gap-1.5 font-medium">
                              <Award className="w-4 h-4 text-amber-500 shrink-0" />
                              <span>{item.bestSellingProduct}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-slate-800">
                            {item.bestSellingUnits}
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-900">
                            {item.totalUnits}
                          </td>
                          {canViewRevenue && (
                            <td className="px-4 py-3 text-right font-black text-emerald-700">
                              ₹{(item.totalRevenue || 0).toLocaleString('en-IN', {
                                minimumFractionDigits: 2,
                              })}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Stall Games & Rewards Analytics Section */}
          {analytics.gameAnalytics && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 border border-purple-200/60 flex items-center justify-center shrink-0">
                    <Gamepad2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Stall Games & Rewards Performance
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Attraction game sessions, conversion win rates, entry fees, and inventory reward distribution
                    </p>
                  </div>
                </div>

                <Link
                  to="/game-sessions"
                  className="text-xs font-semibold text-purple-700 hover:text-purple-800 hover:underline self-start sm:self-auto"
                >
                  View Game Sessions Ledger →
                </Link>
              </div>

              {/* 4 Game KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-4 bg-slate-50/80 border border-slate-200/80 rounded-xl">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Total Plays
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {analytics.gameAnalytics.totalGamesPlayed}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Across all events</div>
                </div>

                {canViewRevenue && analytics.gameAnalytics.totalGameRevenue !== null && (
                  <div className="p-4 bg-emerald-50/50 border border-emerald-200/80 rounded-xl">
                    <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                      Game Revenue
                    </div>
                    <div className="text-2xl font-black text-emerald-800 mt-1">
                      ₹{analytics.gameAnalytics.totalGameRevenue.toLocaleString('en-IN', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </div>
                    <div className="text-[11px] text-emerald-600 mt-0.5">Collected entry fees</div>
                  </div>
                )}

                <div className="p-4 bg-purple-50/50 border border-purple-200/80 rounded-xl">
                  <div className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">
                    Win Rate
                  </div>
                  <div className="text-2xl font-black text-purple-900 mt-1">
                    {analytics.gameAnalytics.winRate}%
                  </div>
                  <div className="text-[11px] text-purple-600 mt-0.5">
                    {analytics.gameAnalytics.totalWins} Wins / {analytics.gameAnalytics.totalLosses} Losses
                  </div>
                </div>

                <div className="p-4 bg-amber-50/50 border border-amber-200/80 rounded-xl">
                  <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                    Rewards Issued
                  </div>
                  <div className="text-2xl font-black text-amber-900 mt-1">
                    {analytics.gameAnalytics.totalRewardsIssued} units
                  </div>
                  <div className="text-[11px] text-amber-600 mt-0.5">
                    {canViewRevenue && analytics.gameAnalytics.estimatedRewardValue !== null && analytics.gameAnalytics.estimatedRewardValue > 0
                      ? `₹${analytics.gameAnalytics.estimatedRewardValue.toFixed(0)} retail value`
                      : 'Physical items awarded'}
                  </div>
                </div>
              </div>

              {/* Per-Game Breakdown Table or Intentional Empty State */}
              <div className="pt-2">
                <h4 className="text-xs font-bold text-slate-900 mb-2 uppercase tracking-wider">
                  Breakdown By Game
                </h4>
                {analytics.gameAnalytics.gameBreakdown.length === 0 ? (
                  <div className="p-6 bg-slate-50/60 border border-slate-200/60 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 border border-purple-200/60 flex items-center justify-center shrink-0">
                        <Gamepad2 className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900">
                          No game sessions recorded in this timeframe
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Rounds logged through the Play Game Terminal will appear here with win rates, prizes distributed, and revenue.
                        </div>
                      </div>
                    </div>
                    <Link
                      to="/games/play"
                      className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-colors shrink-0"
                    >
                      <Gamepad2 className="w-3.5 h-3.5" />
                      <span>Play Game Terminal</span>
                    </Link>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200/80 rounded-xl">
                    <table className="w-full text-left text-xs min-w-[700px] border-collapse">
                      <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th scope="col" className="px-4 py-2.5 min-w-[140px] whitespace-nowrap">Game Name</th>
                          <th scope="col" className="px-4 py-2.5 w-28 whitespace-nowrap">Project</th>
                          <th scope="col" className="px-4 py-2.5 text-right w-20 whitespace-nowrap">Plays</th>
                          <th scope="col" className="px-4 py-2.5 text-right w-20 whitespace-nowrap">Wins</th>
                          <th scope="col" className="px-4 py-2.5 text-right w-20 whitespace-nowrap">Losses</th>
                          <th scope="col" className="px-4 py-2.5 text-right w-24 whitespace-nowrap">Win Rate</th>
                          <th scope="col" className="px-4 py-2.5 text-right w-36 whitespace-nowrap">Rewards Distributed</th>
                          {canViewRevenue && (
                            <th scope="col" className="px-4 py-2.5 text-right w-32 whitespace-nowrap">Total Revenue (₹)</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analytics.gameAnalytics.gameBreakdown.map(g => (
                          <tr key={g.gameId} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-4 py-2.5 font-bold text-slate-900 flex items-center gap-1.5 whitespace-nowrap">
                              <Gamepad2 className="w-3.5 h-3.5 text-purple-600" />
                              <span>{g.gameName}</span>
                            </td>
                            <td className="px-4 py-2.5 text-slate-600 font-medium whitespace-nowrap">
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 border border-slate-200 whitespace-nowrap">
                                {g.projectName}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-black text-slate-900 whitespace-nowrap">
                              {g.plays}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-emerald-700 whitespace-nowrap">
                              {g.wins}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-amber-700 whitespace-nowrap">
                              {g.losses}
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">
                              {g.winRate}%
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-slate-900 whitespace-nowrap">
                              {g.rewardsIssued}
                            </td>
                            {canViewRevenue && (
                              <td className="px-4 py-2.5 text-right font-black text-emerald-700 whitespace-nowrap">
                                {g.revenue !== undefined
                                  ? `₹${g.revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                                  : '—'}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Combos & Special Offers Performance Section */}
          {analytics.comboAnalytics && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center justify-center shrink-0">
                    <Gift className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Event Combos & Special Offers Performance
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Dynamic bundles, promotional pricing rules & multi-product transaction volume
                    </p>
                  </div>
                </div>

                <Link
                  to="/combos"
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline self-start sm:self-auto"
                >
                  Manage Combos & Offers →
                </Link>
              </div>

              {/* 3 Combo KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="p-4 bg-slate-50/80 border border-slate-200/80 rounded-xl">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Combos Sold
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {analytics.comboAnalytics.totalCombosSold} bundles
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Across all events</div>
                </div>

                {canViewRevenue && analytics.comboAnalytics.totalComboRevenue !== null && (
                  <div className="p-4 bg-emerald-50/50 border border-emerald-200/80 rounded-xl">
                    <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                      Combo Revenue
                    </div>
                    <div className="text-2xl font-black text-emerald-800 mt-1">
                      ₹{analytics.comboAnalytics.totalComboRevenue.toLocaleString('en-IN', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </div>
                    <div className="text-[11px] text-emerald-600 mt-0.5">Total promotional gross sales</div>
                  </div>
                )}

                <div className="p-4 bg-slate-50/80 border border-slate-200/80 rounded-xl">
                  <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    Components Deducted
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {analytics.comboAnalytics.totalComboUnits} units
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Physical items packaged & decremented</div>
                </div>
              </div>

              {/* Per-Combo Breakdown Table or Intentional Empty State */}
              <div className="pt-2">
                <h4 className="text-xs font-bold text-slate-900 mb-2 uppercase tracking-wider">
                  Breakdown By Combo Offer
                </h4>
                {analytics.comboAnalytics.comboBreakdown.length === 0 ? (
                  <div className="p-6 bg-slate-50/60 border border-slate-200/60 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center shrink-0">
                        <Gift className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900">
                          No combo package sales recorded in this timeframe
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Multi-buy and package transactions will display here with bundle counts, component deductions, and promotional revenue.
                        </div>
                      </div>
                    </div>
                    <Link
                      to="/combos?action=create"
                      className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors shrink-0"
                    >
                      <Gift className="w-3.5 h-3.5" />
                      <span>Create Combo Offer</span>
                    </Link>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200/80 rounded-xl">
                    <table className="w-full text-left text-xs min-w-[650px]">
                      <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="px-4 py-2.5">Combo Offer</th>
                          <th className="px-4 py-2.5 text-right">Bundles Sold</th>
                          <th className="px-4 py-2.5 text-right">Units Bundled</th>
                          {canViewRevenue && (
                            <th className="px-4 py-2.5 text-right">Total Revenue (₹)</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analytics.comboAnalytics.comboBreakdown.map(c => (
                          <tr key={c.comboId} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-4 py-2.5 font-bold text-slate-900 flex items-center gap-1.5">
                              <Gift className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{c.comboName}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-black text-slate-900">
                              {c.salesCount}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-purple-700">
                              {c.unitsSold}
                            </td>
                            {canViewRevenue && (
                              <td className="px-4 py-2.5 text-right font-black text-emerald-700">
                                {c.revenue !== undefined
                                  ? `₹${c.revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                                  : '—'}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
