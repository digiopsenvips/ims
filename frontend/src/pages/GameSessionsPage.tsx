import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { GameSession, Game, AppEvent, PaymentMethod } from '../types';
import {
  History,
  Search,
  Filter,
  Trophy,
  Frown,
  Calendar,
  Layers,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Gamepad2,
  User as UserIcon,
  Phone,
  ArrowUpDown,
  CreditCard,
  Banknote,
} from 'lucide-react';

export const GameSessionsPage: React.FC = () => {
  const { user, isDeveloper, isAdmin, isHead, hasPermission } = useAuth();
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

  const canViewRevenue = isDeveloper || isAdmin || hasPermission('view_revenue');
  const canViewPII = isDeveloper || isAdmin || hasPermission('view_customer_pii');

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

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      updateUrlState({ page: 1, search: val });
    }, 300);
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

  // Socket listener
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
    <div className="space-y-5 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center font-black shadow-xs">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Game Sessions Ledger
              </h1>
              <p className="text-xs text-slate-500">
                Official chronological record of every physical game play, physical outcome, and issued reward.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/games/play"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <Gamepad2 className="w-4 h-4" />
            <span>Play Game</span>
          </Link>
          <Link
            to="/games"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
          >
            Manage Games
          </Link>
        </div>
      </div>

      {/* Filter and Metric Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search */}
        <div className="w-full md:w-72 relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search session #, receipt, player..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full pl-9 pr-8 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
          {isFetching && (
            <Loader2 className="w-3.5 h-3.5 absolute right-3 top-3 text-slate-400 animate-spin" />
          )}
        </div>

        {/* Dropdowns / Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
          {/* Game filter */}
          <select
            value={selectedGameId}
            onChange={e => updateUrlState({ page: 1, gameId: e.target.value })}
            className="text-xs font-semibold bg-white border border-slate-300 rounded-lg py-1.5 px-2.5 text-slate-800 cursor-pointer"
          >
            <option value="">All Games</option>
            {games.map(g => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          {/* Event filter */}
          <select
            value={selectedEventId}
            onChange={e => updateUrlState({ page: 1, eventId: e.target.value })}
            className="text-xs font-semibold bg-white border border-slate-300 rounded-lg py-1.5 px-2.5 text-slate-800 cursor-pointer"
          >
            <option value="">All Stalls</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>

          {/* Result Filter */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {(['ALL', 'WIN', 'LOSE'] as const).map(r => (
              <button
                key={r}
                onClick={() => updateUrlState({ page: 1, result: r })}
                className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  resultFilter === r ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {r === 'WIN' ? '🏆 WINS' : r === 'LOSE' ? '❌ LOSSES' : 'ALL'}
              </button>
            ))}
          </div>

          {/* Payment Filter */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {(['ALL', 'UPI', 'CASH', 'CASH_UPI'] as const).map(p => (
              <button
                key={p}
                onClick={() => updateUrlState({ page: 1, payment: p })}
                className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  paymentFilter === p ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {p === 'CASH_UPI' ? 'SPLIT' : p}
              </button>
            ))}
          </div>
        </div>

        {/* Mini stats summary */}
        <div className="flex items-center gap-4 text-xs shrink-0">
          <div>
            <span className="text-slate-500">Sessions:</span>{' '}
            <span className="font-bold text-slate-900">{totalRecords}</span>
          </div>
          <div>
            <span className="text-slate-500">Rewards:</span>{' '}
            <span className="font-bold text-purple-700">{summary.totalRewardsIssued}</span>
          </div>
          {canViewRevenue && (
            <div>
              <span className="text-slate-500">Revenue:</span>{' '}
              <span className="font-black text-emerald-700">₹{summary.totalRevenue}</span>
            </div>
          )}
        </div>
      </div>

      {/* Sessions Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden relative">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Receipt ID</th>
                <th className="px-4 py-3">Session Code</th>
                <th className="px-4 py-3">Game Name</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">Reward Issued</th>
                <th className="px-4 py-3 text-right">Entry Fee</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Cashier / Seller</th>
                <th className="px-4 py-3">Stall / Event</th>
                <th className="px-4 py-3">Player Info</th>
                <th className="px-4 py-3">Date & Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-400">
                    <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin text-slate-400" />
                    Loading game sessions...
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                    No matching game sessions found.
                  </td>
                </tr>
              ) : (
                sessions.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-900">
                      #{s.receiptNumber}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-purple-700">
                      {s.sessionCode}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {s.gameName}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                          s.result === 'WIN'
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {s.result === 'WIN' ? '🏆 WIN' : '❌ LOSE'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {s.rewardDescription}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-slate-900">
                      ₹{s.entryFee}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {s.paymentMethod === 'CASH_UPI' ? 'CASH + UPI' : s.paymentMethod}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {s.sellerName}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {s.eventName}
                    </td>
                    <td className="px-4 py-3">
                      {s.customerName ? (
                        <div>
                          <div className="font-semibold text-slate-900">{s.customerName}</div>
                          {canViewPII && s.customerPhone && (
                            <div className="text-[10px] text-slate-400 font-mono">{s.customerPhone}</div>
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
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
          <div className="text-slate-500">
            Showing <strong className="text-slate-900">{fromRecord}–{toRecord}</strong> of{' '}
            <strong className="text-slate-900">{totalRecords}</strong> sessions
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => updateUrlState({ page: currentPage - 1 })}
              disabled={currentPage <= 1}
              className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-bold text-slate-700">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => updateUrlState({ page: currentPage + 1 })}
              disabled={currentPage >= totalPages}
              className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
