import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { AnalyticsData, AppEvent, Project } from '../types';
import {
  BarChart3,
  PieChart as PieIcon,
  TrendingUp,
  Filter,
  DollarSign,
  Package,
  Calendar,
  Layers,
  Award,
  Gamepad2,
  Trophy,
  Gift,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  Legend,
} from 'recharts';

const COLORS = [
  '#0f172a',
  '#16a34a',
  '#2563eb',
  '#d97706',
  '#9333ea',
  '#dc2626',
  '#0891b2',
  '#4f46e5',
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

  const pieData = analytics
    ? (pieMode === 'product' ? analytics.productShare : analytics.projectShare).map(item => ({
        name: item.name,
        value: metricMode === 'revenue' && item.revenue !== undefined ? item.revenue : item.units,
      }))
    : [];

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Analytics
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Sales trends, project contributions, and product performance analytics.
          </p>
        </div>

        {/* Global Metric Mode Toggle (Units vs Revenue) */}
        {canViewRevenue && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-xs font-semibold text-slate-500">Metric:</span>
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

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span>Filters:</span>
        </div>

        {/* Event Filter */}
        <select
          value={selectedEventId}
          onChange={e => setSelectedEventId(e.target.value)}
          className="text-xs font-medium bg-slate-50 border border-slate-200 rounded p-1.5 text-slate-800"
        >
          <option value="">All Events</option>
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
          className="text-xs font-medium bg-slate-50 border border-slate-200 rounded p-1.5 text-slate-800"
        >
          <option value="">All Projects</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Date Filter */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="p-1 border border-slate-200 rounded bg-slate-50 text-xs"
          />
          <span>to</span>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="p-1 border border-slate-200 rounded bg-slate-50 text-xs"
          />
        </div>

        {(selectedEventId || selectedProjectId || startDate || endDate) && (
          <button
            onClick={() => {
              setSelectedEventId('');
              setSelectedProjectId('');
              setStartDate('');
              setEndDate('');
            }}
            className="text-xs text-red-600 font-semibold hover:underline ml-auto"
          >
            Reset Filters
          </button>
        )}
      </div>

      {isLoading || !analytics ? (
        <div className="p-12 text-center text-xs text-slate-500 font-medium">
          Loading analytics visualizations...
        </div>
      ) : (
        <>
          {/* Top Charts Grid: Pie Chart & Time Trend */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Pie Chart: Sales Share by Product / Project */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {pieMode === 'product' ? 'Product Share Distribution' : 'Project Share Breakdown'}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Measured by {metricMode === 'revenue' && canViewRevenue ? 'revenue generated' : 'units sold'}
                  </p>
                </div>

                {/* Toggle: by Product vs by Project */}
                <div className="inline-flex rounded border border-slate-200 bg-slate-50 p-0.5 text-[10px]">
                  <button
                    onClick={() => setPieMode('product')}
                    className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer ${
                      pieMode === 'product' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    Product
                  </button>
                  <button
                    onClick={() => setPieMode('project')}
                    className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer ${
                      pieMode === 'project' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    Project
                  </button>
                </div>
              </div>

              <div className="h-64 mt-4">
                {pieData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    No sales data available for this selection
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: any) =>
                          metricMode === 'revenue' && canViewRevenue
                            ? [`₹${Number(val).toFixed(2)}`, 'Revenue']
                            : [`${val} units`, 'Sold']
                        }
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Time Trend: Daily Sales Trend */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-col">
              <div className="pb-3 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">Daily Sales Timeline</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Volume progression over time
                </p>
              </div>

              <div className="h-64 mt-4">
                {analytics.timeTrend.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    No daily trends available yet
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analytics.timeTrend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <Tooltip
                        formatter={(val: any) =>
                          metricMode === 'revenue' && canViewRevenue
                            ? [`₹${Number(val).toFixed(2)}`, 'Revenue']
                            : [`${val} units`, 'Units Sold']
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey={metricMode === 'revenue' && canViewRevenue ? 'revenue' : 'units'}
                        stroke="#0f172a"
                        fill="#f8fafc"
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
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-200">
                <h3 className="text-sm font-bold text-slate-900">
                  Stall & Event Breakdown
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Best-selling product and total output per pop-up event
                </p>
              </div>

              {analytics.stallPerformance.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No event breakdown data available.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
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
                        <tr key={item.eventId} className="hover:bg-slate-50/50">
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {item.eventName}
                          </td>
                          <td className="px-4 py-3 text-slate-800">
                            <div className="flex items-center gap-1.5 font-medium">
                              <Award className="w-3.5 h-3.5 text-amber-500 shrink-0" />
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
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
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
                </div>

                {/* 4 Game KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                  <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Total Plays
                    </div>
                    <div className="text-2xl font-black text-slate-900 mt-1">
                      {analytics.gameAnalytics.totalGamesPlayed}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Across all events</div>
                  </div>

                  {canViewRevenue && analytics.gameAnalytics.totalGameRevenue !== null && (
                    <div className="p-3.5 bg-emerald-50/50 border border-emerald-200/80 rounded-xl">
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

                  <div className="p-3.5 bg-indigo-50/50 border border-indigo-200/80 rounded-xl">
                    <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">
                      Win Rate
                    </div>
                    <div className="text-2xl font-black text-indigo-900 mt-1">
                      {analytics.gameAnalytics.winRate}%
                    </div>
                    <div className="text-[11px] text-indigo-600 mt-0.5">
                      {analytics.gameAnalytics.totalWins} Wins / {analytics.gameAnalytics.totalLosses} Losses
                    </div>
                  </div>

                  <div className="p-3.5 bg-amber-50/50 border border-amber-200/80 rounded-xl">
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

                {/* Per-Game Breakdown Table */}
                <div className="mt-5">
                  <h4 className="text-xs font-bold text-slate-900 mb-2 uppercase tracking-wider">
                    Breakdown By Game
                  </h4>
                  {analytics.gameAnalytics.gameBreakdown.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400">
                      No game sessions recorded in this timeframe.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="px-4 py-2.5">Game Name</th>
                            <th className="px-4 py-2.5">Project</th>
                            <th className="px-4 py-2.5 text-right">Plays</th>
                            <th className="px-4 py-2.5 text-right">Wins</th>
                            <th className="px-4 py-2.5 text-right">Losses</th>
                            <th className="px-4 py-2.5 text-right">Win Rate</th>
                            <th className="px-4 py-2.5 text-right">Rewards Distributed</th>
                            {canViewRevenue && (
                              <th className="px-4 py-2.5 text-right">Total Revenue (₹)</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {analytics.gameAnalytics.gameBreakdown.map(g => (
                            <tr key={g.gameId} className="hover:bg-slate-50/50">
                              <td className="px-4 py-2.5 font-bold text-slate-900 flex items-center gap-1.5">
                                <Gamepad2 className="w-3.5 h-3.5 text-indigo-500" />
                                <span>{g.gameName}</span>
                              </td>
                              <td className="px-4 py-2.5 text-slate-600 font-medium">
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 border border-slate-200">
                                  {g.projectName}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-black text-slate-900">
                                {g.plays}
                              </td>
                              <td className="px-4 py-2.5 text-right font-bold text-emerald-700">
                                {g.wins}
                              </td>
                              <td className="px-4 py-2.5 text-right font-bold text-amber-700">
                                {g.losses}
                              </td>
                              <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                                {g.winRate}%
                              </td>
                              <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                                {g.rewardsIssued}
                              </td>
                              {canViewRevenue && (
                                <td className="px-4 py-2.5 text-right font-black text-emerald-700">
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
            </div>
          )}
        </>
      )}
    </div>
  );
};
