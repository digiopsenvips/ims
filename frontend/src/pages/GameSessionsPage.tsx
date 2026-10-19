import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { GameSession, Game, AppEvent } from '../types';
import {
  History,
  Search,
  Trophy,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Gamepad2,
  Phone,
  CreditCard,
  Banknote,
  RotateCcw,
  X,
  Layers,
  Store,
  CheckCircle2,
} from 'lucide-react';

export const GameSessionsPage: React.FC = () => {
  const { isDeveloper, isAdmin, hasPermission } = useAuth();
  const { socket } = useSocket();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const rawPageSize = parseInt(searchParams.get('pageSize') || '10', 10) || 10;
  const pageSize = [10, 25, 50, 100].includes(rawPageSize) ? rawPageSize : 10;

  const selectedEventId = searchParams.get('eventId') || '';
  const selectedGameId = searchParams.get('gameId') || '';
  const resultFilter = (searchParams.get('result') as 'ALL' | 'WIN' | 'LOSE') || 'ALL';
  const paymentFilter = (searchParams.get('payment') as 'ALL' | 'UPI' | 'CASH' | 'CASH_UPI') || 'ALL';
  const searchFromUrl = searchParams.get('search') || '';

  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [summary, setSummary] = useState<{ totalRevenue: number; totalRewardsIssued: number }>({
    totalRevenue: 0,
    totalRewardsIssued: 0,
  });

  const [searchQuery, setSearchQuery] = useState(searchFromUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const canViewRevenue = isDeveloper || isAdmin || hasPermission('view_revenue');
  const canViewPII = isDeveloper || isAdmin || hasPermission('view_customer_pii');

  const hasActiveFilters = Boolean(
    searchFromUrl.trim() ||
    selectedGameId ||
    selectedEventId ||
    resultFilter !== 'ALL' ||
    paymentFilter !== 'ALL'
  );

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const query = new URLSearchParams();
      query.set('page', '1');
      query.set('pageSize', '1000');
      if (selectedEventId) query.set('eventId', selectedEventId);
      if (selectedGameId) query.set('gameId', selectedGameId);
      if (resultFilter !== 'ALL') query.set('result', resultFilter);
      if (paymentFilter !== 'ALL') query.set('paymentMethod', paymentFilter);
      if (searchFromUrl.trim()) query.set('search', searchFromUrl.trim());

      const res = await api.get(`/games/sessions?${query.toString()}`);
      const dataToExport: GameSession[] = res?.sessions || sessions;

      const headers = [
        'Receipt ID',
        'Session Code',
        'Date & Time',
        'Game Name',
        'Stall / Event',
        'Result',
        'Reward Product',
        'Entry Fee (₹)',
        'Payment Method',
        'Operator',
        ...(canViewPII ? ['Player Name', 'Player Phone'] : []),
      ];

      const rows = dataToExport.map(s => [
        `"#${s.receiptNumber}"`,
        `"${s.sessionCode || ''}"`,
        `"${new Date(s.createdAt).toLocaleString('en-IN')}"`,
        `"${s.gameName || ''}"`,
        `"${s.eventName || 'N/A'}"`,
        s.result,
        `"${s.rewardDescription || (s.result === 'WIN' ? 'Win Reward' : 'Consolation')}"`,
        s.entryFee,
        s.paymentMethod,
        `"${s.sellerName || 'Staff'}"`,
        ...(canViewPII ? [`"${s.customerName || ''}"`, `"${s.customerPhone || ''}"`] : []),
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `game_sessions_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Game sessions export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const updateUrlState = useCallback(
    (updates: {
      page?: number;
      pageSize?: number;
      eventId?: string;
      gameId?: string;
      result?: 'ALL' | 'WIN' | 'LOSE';
      payment?: 'ALL' | 'UPI' | 'CASH' | 'CASH_UPI';
      search?: string;
    }) => {
      const newParams = new URLSearchParams(searchParams);

      const targetPage = updates.page !== undefined ? updates.page : currentPage;
      const targetPageSize = updates.pageSize !== undefined ? updates.pageSize : pageSize;
      const targetEventId = updates.eventId !== undefined ? updates.eventId : selectedEventId;
      const targetGameId = updates.gameId !== undefined ? updates.gameId : selectedGameId;
      const targetResult = updates.result !== undefined ? updates.result : resultFilter;
      const targetPayment = updates.payment !== undefined ? updates.payment : paymentFilter;
      const targetSearch = updates.search !== undefined ? updates.search : searchFromUrl;

      if (targetPage > 1) newParams.set('page', String(targetPage));
      else newParams.delete('page');

      if (targetPageSize !== 10) newParams.set('pageSize', String(targetPageSize));
      else newParams.delete('pageSize');

      if (targetEventId) newParams.set('eventId', targetEventId);
      else newParams.delete('eventId');

      if (targetGameId) newParams.set('gameId', targetGameId);
      else newParams.delete('gameId');

      if (targetResult !== 'ALL') newParams.set('result', targetResult);
      else newParams.delete('result');

      if (targetPayment !== 'ALL') newParams.set('payment', targetPayment);
      else newParams.delete('payment');

      if (targetSearch.trim()) newParams.set('search', targetSearch.trim());
      else newParams.delete('search');

      setSearchParams(newParams, { replace: true });
    },
    [searchParams, currentPage, pageSize, selectedEventId, selectedGameId, resultFilter, paymentFilter, searchFromUrl, setSearchParams]
  );

  const handleResetFilters = () => {
    setSearchQuery('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      updateUrlState({ page: 1, search: val });
    }, 300);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    updateUrlState({ page: 1, search: '' });
  };

  const fetchSessionData = useCallback(async () => {
    setIsFetching(true);
    try {
      const query = new URLSearchParams();
      query.set('page', String(currentPage));
      query.set('pageSize', String(pageSize));
      if (selectedEventId) query.set('eventId', selectedEventId);
      if (selectedGameId) query.set('gameId', selectedGameId);
      if (resultFilter !== 'ALL') query.set('result', resultFilter);
      if (paymentFilter !== 'ALL') query.set('paymentMethod', paymentFilter);
      if (searchFromUrl.trim()) query.set('search', searchFromUrl.trim());

      const res = await api.get(`/games/sessions?${query.toString()}`);
      if (res?.sessions) {
        setSessions(res.sessions);
        setTotalRecords(res.pagination?.totalRecords || 0);
        if (res.summary) setSummary(res.summary);
      }
    } catch (err) {
      console.error('Failed to fetch game sessions:', err);
    } finally {
      setIsLoading(false);
      setIsFetching(false);
    }
  }, [currentPage, pageSize, selectedEventId, selectedGameId, resultFilter, paymentFilter, searchFromUrl]);

  useEffect(() => {
    fetchSessionData();
  }, [fetchSessionData]);

  useEffect(() => {
    Promise.all([api.get('/games'), api.get('/events')]).then(([gamesRes, eventsRes]) => {
      if (gamesRes?.games) setGames(gamesRes.games);
      if (eventsRes?.events) setEvents(eventsRes.events);
    });
  }, []);

  // Socket listener for live game play updates
  useEffect(() => {
    if (!socket) return;
    socket.on('game:played', fetchSessionData);
    socket.on('sale:created', fetchSessionData);

    return () => {
      socket.off('game:played', fetchSessionData);
      socket.off('sale:created', fetchSessionData);
    };
  }, [socket, fetchSessionData]);

  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const fromRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toRecord = Math.min(currentPage * pageSize, totalRecords);

  return (
    <div className="space-y-5 w-full max-w-[1600px] mx-auto pb-12">
      {/* Page Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 border border-purple-200/70 flex items-center justify-center font-black shadow-xs shrink-0">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Game Sessions Ledger
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Official chronological record of every physical game play, physical outcome, and issued reward.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
          <Link
            to="/games/play"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <Gamepad2 className="w-4 h-4" />
            <span>Play Game</span>
          </Link>
          <Link
            to="/games"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
          >
            <span>Manage Games</span>
          </Link>
          <button
            onClick={handleExportCSV}
            disabled={isExporting || totalRecords === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
            title="Export game sessions to CSV"
            aria-label="Export game sessions to CSV"
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600" /> : <Download className="w-3.5 h-3.5 text-slate-500" />}
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className={`grid grid-cols-1 ${canViewRevenue ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-4`}>
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Total Sessions
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 tracking-tight">
              {totalRecords}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Physical rounds recorded
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 border border-slate-200/60">
            <History className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Rewards Issued
            </div>
            <div className="text-2xl sm:text-3xl font-black text-purple-700 mt-1 tracking-tight">
              {summary.totalRewardsIssued}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Prizes & consolations handed out
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0 border border-purple-200/60">
            <Trophy className="w-5 h-5" />
          </div>
        </div>

        {canViewRevenue && (
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Total Game Revenue
              </div>
              <div className="text-2xl sm:text-3xl font-black text-emerald-700 mt-1 tracking-tight">
                ₹{summary.totalRevenue}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Entry fees collected
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200/60">
              <Banknote className="w-5 h-5" />
            </div>
          </div>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search session #, receipt, player name or phone..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-9 pr-8 py-2 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-600/20 focus:border-purple-600 transition-all"
            />
            {isFetching ? (
              <Loader2 className="w-3.5 h-3.5 absolute right-3 top-2.5 text-slate-400 animate-spin" />
            ) : searchQuery ? (
              <button
                onClick={handleClearSearch}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>

          {/* Select Dropdowns */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Game filter */}
            <select
              value={selectedGameId}
              onChange={e => updateUrlState({ page: 1, gameId: e.target.value })}
              className="text-xs font-semibold bg-white border border-slate-300 rounded-xl py-2 px-3 text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-600/20 focus:border-purple-600"
            >
              <option value="">All Games</option>
              {games.map(g => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            {/* Stall/Event filter */}
            <select
              value={selectedEventId}
              onChange={e => updateUrlState({ page: 1, eventId: e.target.value })}
              className="text-xs font-semibold bg-white border border-slate-300 rounded-xl py-2 px-3 text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-600/20 focus:border-purple-600"
            >
              <option value="">All Stalls</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors cursor-pointer"
                title="Reset all filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Secondary Filter Controls: Result & Payment Pills */}
        <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Outcome Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Result:
              </span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {(['ALL', 'WIN', 'LOSE'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => updateUrlState({ page: 1, result: r })}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                      resultFilter === r
                        ? 'bg-white text-purple-700 shadow-2xs font-extrabold'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {r === 'WIN' ? '🏆 Wins' : r === 'LOSE' ? '❌ Losses' : 'All'}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Payment:
              </span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {(['ALL', 'UPI', 'CASH', 'CASH_UPI'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => updateUrlState({ page: 1, payment: p })}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                      paymentFilter === p
                        ? 'bg-white text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {p === 'CASH_UPI' ? 'Split' : p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Rows per page selector */}
          <div className="flex items-center gap-2 self-end sm:self-auto text-slate-500 text-xs">
            <span>Per page:</span>
            <select
              value={pageSize}
              onChange={e => updateUrlState({ page: 1, pageSize: parseInt(e.target.value, 10) })}
              className="font-semibold bg-white border border-slate-200 rounded-lg py-1 px-2 text-slate-800 cursor-pointer focus:outline-none"
            >
              {[10, 25, 50, 100].map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Sessions Table Container */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[1100px] border-collapse">
            <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th scope="col" className="px-4 py-3 w-24 whitespace-nowrap">Receipt ID</th>
                <th scope="col" className="px-4 py-3 w-28 whitespace-nowrap">Session Code</th>
                <th scope="col" className="px-4 py-3 min-w-[140px] whitespace-nowrap">Game Name</th>
                <th scope="col" className="px-4 py-3 w-24 whitespace-nowrap">Result</th>
                <th scope="col" className="px-4 py-3 min-w-[160px]">Reward Issued</th>
                <th scope="col" className="px-4 py-3 text-right w-24 whitespace-nowrap">Entry Fee</th>
                <th scope="col" className="px-4 py-3 w-28 whitespace-nowrap">Payment</th>
                <th scope="col" className="px-4 py-3 w-32 whitespace-nowrap">Cashier / Seller</th>
                <th scope="col" className="px-4 py-3 w-36 whitespace-nowrap">Stall / Event</th>
                <th scope="col" className="px-4 py-3 w-36 whitespace-nowrap">Player Info</th>
                <th scope="col" className="px-4 py-3 w-40 whitespace-nowrap">Date & Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-16 text-center text-slate-400">
                    <Loader2 className="w-6 h-6 mx-auto mb-2.5 animate-spin text-purple-600" />
                    <p className="font-medium text-slate-600">Loading game sessions...</p>
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-14 text-center">
                    {hasActiveFilters ? (
                      <div className="max-w-sm mx-auto space-y-2">
                        <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-2">
                          <Search className="w-5 h-5" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">No matching game sessions</h3>
                        <p className="text-xs text-slate-500">
                          No sessions match your active filters or search terms. Try clearing or broadening your search criteria.
                        </p>
                        <div className="pt-2">
                          <button
                            onClick={handleResetFilters}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Clear Filters</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="max-w-md mx-auto space-y-2.5">
                        <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 border border-purple-200/60 flex items-center justify-center mx-auto mb-2">
                          <Gamepad2 className="w-6 h-6" />
                        </div>
                        <h3 className="text-base font-bold text-slate-900">No Game Sessions Recorded Yet</h3>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          When visitors play stall games during an active event, physical game outcomes, entry fee collections, and issued rewards will appear here in real time.
                        </p>
                        <div className="pt-2">
                          <Link
                            to="/games/play"
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-colors cursor-pointer"
                          >
                            <Gamepad2 className="w-4 h-4" />
                            <span>Open Play Game Terminal</span>
                          </Link>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                sessions.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                      #{s.receiptNumber}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-mono font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100 text-[11px] whitespace-nowrap">
                        {s.sessionCode}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">
                      {s.gameName}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.result === 'WIN' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap">
                          <Trophy className="w-3 h-3 text-emerald-600" />
                          <span>WIN</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
                          <XCircle className="w-3 h-3 text-slate-500" />
                          <span>LOSS</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 min-w-[160px]">
                      {s.rewardDescription || '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-slate-900 whitespace-nowrap">
                      ₹{s.entryFee}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
                        {s.paymentMethod === 'CASH_UPI' ? (
                          <>
                            <Banknote className="w-3 h-3" />
                            <span>Split</span>
                          </>
                        ) : s.paymentMethod === 'UPI' ? (
                          <>
                            <CreditCard className="w-3 h-3 text-blue-600" />
                            <span>UPI</span>
                          </>
                        ) : (
                          <>
                            <Banknote className="w-3 h-3 text-emerald-600" />
                            <span>Cash</span>
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {s.sellerName}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {s.eventName}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.customerName ? (
                        <div>
                          <div className="font-semibold text-slate-900">{s.customerName}</div>
                          {canViewPII && s.customerPhone && (
                            <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1 mt-0.5 whitespace-nowrap">
                              <Phone className="w-2.5 h-2.5" />
                              <span>{s.customerPhone}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Walk-in</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {new Date(s.createdAt).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="px-4 py-3.5 bg-slate-50/80 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="text-slate-500">
            Showing <strong className="text-slate-900">{fromRecord}–{toRecord}</strong> of{' '}
            <strong className="text-slate-900">{totalRecords}</strong> sessions
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => updateUrlState({ page: currentPage - 1 })}
              disabled={currentPage <= 1}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-2xs transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>
            <span className="px-3 font-semibold text-slate-700">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => updateUrlState({ page: currentPage + 1 })}
              disabled={currentPage >= totalPages}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-2xs transition-colors"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
