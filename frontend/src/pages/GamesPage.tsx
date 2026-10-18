import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { Game, Product, AppEvent, Project } from '../types';
import {
  Gamepad2,
  Plus,
  Search,
  Filter,
  Trophy,
  Frown,
  Coins,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  Pencil,
  Power,
  RotateCcw,
  Sparkles,
  QrCode,
  X,
  Loader2,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Copy,
  Check,
  Info,
  Calendar,
  Building2,
} from 'lucide-react';

export const GamesPage: React.FC = () => {
  const { user, isDeveloper, isAdmin, isHead } = useAuth();
  const { socket } = useSocket();

  const [games, setGames] = useState<Game[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [eventFilter, setEventFilter] = useState<string>('ALL');
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isTogglingStatus, setIsTogglingStatus] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [viewingGame, setViewingGame] = useState<any | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [qrGame, setQrGame] = useState<Game | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    projectId: '',
    eventId: '',
    entryFee: '30',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    winRewardProductId: '',
    winRewardQuantity: '1',
    loseRewardProductId: '',
    loseRewardQuantity: '1',
  });
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canManage = isDeveloper || isAdmin;

  const loadData = async () => {
    try {
      const [gamesRes, prodRes, eventsRes, projRes] = await Promise.all([
        api.get('/games'),
        api.get('/products'),
        api.get('/events'),
        api.get('/projects'),
      ]);

      if (gamesRes?.games) setGames(gamesRes.games);
      if (prodRes?.products) setProducts(prodRes.products.filter((p: Product) => !p.isArchived));
      if (eventsRes?.events) setEvents(eventsRes.events);
      if (projRes?.projects) setProjects(projRes.projects);
    } catch (err) {
      console.error('Failed to load games data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Listen for socket events
  useEffect(() => {
    if (!socket) return;
    socket.on('game:updated', loadData);
    socket.on('game:played', loadData);
    socket.on('inventory:updated', loadData);

    return () => {
      socket.off('game:updated', loadData);
      socket.off('game:played', loadData);
      socket.off('inventory:updated', loadData);
    };
  }, [socket]);

  const openCreateModal = () => {
    setEditingGame(null);
    setFormData({
      name: '',
      description: '',
      projectId: projects[0]?.id || '',
      eventId: events[0]?.id || '',
      entryFee: '30',
      status: 'ACTIVE',
      winRewardProductId: products[0]?.id || '',
      winRewardQuantity: '1',
      loseRewardProductId: products[1]?.id || products[0]?.id || '',
      loseRewardQuantity: '1',
    });
    setFormError(null);
    setShowCreateModal(true);
  };

  const openEditModal = (game: Game) => {
    setEditingGame(game);
    setFormData({
      name: game.name,
      description: game.description || '',
      projectId: game.projectId || '',
      eventId: game.eventId || '',
      entryFee: String(game.entryFee),
      status: game.status,
      winRewardProductId: game.winReward.productId,
      winRewardQuantity: String(game.winReward.quantity),
      loseRewardProductId: game.loseReward?.productId || '',
      loseRewardQuantity: String(game.loseReward?.quantity || 1),
    });
    setFormError(null);
    setShowCreateModal(true);
  };

  const handleOpenGameDetails = async (game: Game) => {
    // Show modal immediately with current summary data so UI responds instantly
    setViewingGame(game);
    setIsLoadingDetails(true);
    setDetailsError(null);

    try {
      const res = await api.get(`/games/${game.id}`);
      if (res?.game) {
        setViewingGame(res.game);
      }
    } catch (err: any) {
      console.error('Failed to load full game details:', err);
      setDetailsError(err.message || 'Failed to load live game details from database');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewingGame) setViewingGame(null);
        if (showCreateModal) setShowCreateModal(false);
        if (qrGame) setQrGame(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewingGame, showCreateModal, qrGame]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const isEventEnded = (eventId?: string | null) => {
    if (!eventId) return false;
    const ev = events.find(e => e.id === eventId);
    if (!ev) return false;
    return ev.status === 'ENDED' || new Date(ev.endDatetime).getTime() < Date.now();
  };

  const handleToggleStatus = async (game: Game) => {
    const nextStatus = game.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const confirmMsg =
      game.status === 'ACTIVE'
        ? `Are you sure you want to deactivate "${game.name}"? Volunteers will not be able to record plays for this game until it is reactivated.`
        : `Activate "${game.name}" for live stall play?`;

    if (!window.confirm(confirmMsg)) return;

    setIsTogglingStatus(game.id);
    try {
      await api.patch(`/games/${game.id}/status`, { status: nextStatus });
      setStatusMessage({
        text: `"${game.name}" is now ${nextStatus === 'ACTIVE' ? 'Active (Playable)' : 'Inactive'}.`,
        type: 'success',
      });
      await loadData();
    } catch (err: any) {
      console.error('Failed to update status:', err);
      setStatusMessage({
        text: err.message || 'Failed to update game status.',
        type: 'error',
      });
    } finally {
      setIsTogglingStatus(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    try {
      if (!formData.name.trim()) throw new Error('Game name is required');
      if (!formData.winRewardProductId) throw new Error('Win reward product is required');

      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        projectId: formData.projectId || undefined,
        eventId: formData.eventId || undefined,
        entryFee: parseFloat(formData.entryFee) || 0,
        status: formData.status,
        winRewardProductId: formData.winRewardProductId,
        winRewardQuantity: parseInt(formData.winRewardQuantity, 10) || 1,
        loseRewardProductId: formData.loseRewardProductId || undefined,
        loseRewardQuantity: parseInt(formData.loseRewardQuantity, 10) || 1,
      };

      if (editingGame) {
        await api.put(`/games/${editingGame.id}`, payload);
      } else {
        await api.post('/games', payload);
      }

      setShowCreateModal(false);
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save game');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredGames = games.filter(g => {
    if (statusFilter !== 'ALL' && g.status !== statusFilter) return false;
    if (eventFilter !== 'ALL' && g.eventId !== eventFilter) return false;
    if (searchQuery.trim()) {
      const term = searchQuery.toLowerCase();
      const matchName = g.name.toLowerCase().includes(term);
      const matchDesc = (g.description || '').toLowerCase().includes(term);
      const matchProject = (g.projectName || '').toLowerCase().includes(term);
      const matchEvent = (g.eventName || '').toLowerCase().includes(term);
      const matchReward =
        g.winReward.productName.toLowerCase().includes(term) ||
        (g.loseReward?.productName || '').toLowerCase().includes(term);
      if (!matchName && !matchDesc && !matchProject && !matchEvent && !matchReward) return false;
    }
    return true;
  });

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-12">
      {/* 1. Header with Title & Primary Actions */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 flex items-center justify-center font-black shadow-2xs shrink-0">
            <Gamepad2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Games Management
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure physical stall games, reward products, entry pricing, and live inventory links.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            to="/games/play"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 shadow-2xs transition-colors cursor-pointer"
          >
            <Gamepad2 className="w-4 h-4" />
            <span>Play Game Terminal</span>
          </Link>

          {canManage && (
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Game</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Feedback Notification Banner */}
      {statusMessage && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between gap-2 text-xs font-semibold animate-fadeIn ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="p-1 hover:bg-black/5 rounded cursor-pointer transition-colors"
            title="Dismiss message"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 2. Redesigned Search & Filters Bar */}
      <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Field with Usable Width */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search game, reward, event, project..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 min-h-[36px] transition-colors text-slate-800 placeholder:text-slate-400"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 absolute right-2.5 top-1/2 -translate-y-1/2 rounded cursor-pointer"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Controls: Status + Event */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Status Segmented Control */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
              Status:
            </span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs h-9">
              {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === s
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Event Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
              Stall:
            </span>
            <select
              value={eventFilter}
              onChange={e => setEventFilter(e.target.value)}
              className="h-9 text-xs font-semibold bg-white border border-slate-300 rounded-lg py-1 px-3 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer min-w-[170px]"
            >
              <option value="ALL">All Stalls & Events</option>
              {events.map(ev => {
                const ended = ev.status === 'ENDED' || new Date(ev.endDatetime).getTime() < Date.now();
                return (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} {ended ? '(Concluded)' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Reset Filters Link */}
          {(searchQuery || statusFilter !== 'ALL' || eventFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('ALL');
                setEventFilter('ALL');
              }}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer flex items-center gap-1 px-2 py-1 hover:bg-indigo-50 rounded-md transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* 3. Games Grid & Empty State */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400">
          <Loader2 className="w-7 h-7 mx-auto mb-2.5 animate-spin text-purple-600" />
          <span className="text-xs font-semibold">Loading games catalog and reward stocks...</span>
        </div>
      ) : filteredGames.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
          <Gamepad2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-900">
            {games.length === 0 ? 'No games created yet' : 'No games found matching criteria'}
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            {games.length === 0
              ? 'Click "Create Game" above to launch Ring Toss, Bottle Flip, or other stall attractions.'
              : 'Try searching with a different term, or reset your status and stall filters.'}
          </p>
          {games.length === 0 && canManage ? (
            <button
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Game</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('ALL');
                setEventFilter('ALL');
              }}
              className="mt-4 inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset all filters</span>
            </button>
          )}
        </div>
      ) : (
        /* Responsive Card Grid with Sensible Column Widths */
        <div
          className={`grid gap-5 ${
            filteredGames.length === 1 && !searchQuery && statusFilter === 'ALL' && eventFilter === 'ALL'
              ? 'grid-cols-1 lg:grid-cols-2 max-w-5xl'
              : filteredGames.length === 2
              ? 'grid-cols-1 md:grid-cols-2'
              : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
          }`}
        >
          {filteredGames.map(game => {
            const hasLowStock = game.winReward.isLowStock || game.loseReward?.isLowStock;
            const hasOutOfStock = game.winReward.isOutOfStock || game.loseReward?.isOutOfStock;
            const eventEnded = isEventEnded(game.eventId);

            return (
              <div
                key={game.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs hover:shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top Bar: Title, Project Tag & Entry Fee */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2
                          className="text-base font-bold text-slate-900 tracking-tight leading-snug break-words"
                          title={game.name}
                        >
                          {game.name}
                        </h2>
                        <span
                          className={`px-1.5 py-0.5 text-[9px] font-extrabold uppercase rounded border ${
                            game.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {game.status}
                        </span>
                      </div>
                      {game.projectName && (
                        <span className="text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200/80 px-2 py-0.5 rounded uppercase tracking-wider inline-block mt-1">
                          Project {game.projectName}
                        </span>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Entry Fee
                      </div>
                      <div className="text-base font-black text-slate-900 mt-0.5">
                        ₹{game.entryFee}
                      </div>
                    </div>
                  </div>

                  {/* Description (wraps cleanly) */}
                  {game.description && (
                    <p className="text-xs text-slate-500 mt-2.5 line-clamp-2 leading-relaxed">
                      {game.description}
                    </p>
                  )}

                  {/* Assigned Event / Stall info */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      Stall:
                    </span>
                    <div className="text-right flex items-center gap-1 truncate max-w-[190px]">
                      <span className="font-semibold text-slate-700 truncate">
                        {game.eventName || 'All Stalls (Global)'}
                      </span>
                      {eventEnded && (
                        <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded shrink-0">
                          Concluded
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Rewards Config Block */}
                  <div className="mt-3 bg-slate-50 border border-slate-200/80 rounded-xl p-3 space-y-2">
                    {/* Win Reward */}
                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="font-semibold text-slate-800 truncate" title={game.winReward.productName}>
                          WIN: {game.winReward.productName} × {game.winReward.quantity}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        {game.winReward.isOutOfStock ? (
                          <span className="px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-red-100 text-red-800 border border-red-200">
                            Out of Stock
                          </span>
                        ) : game.winReward.isLowStock ? (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-100 text-amber-800 border border-amber-200">
                            Low: {game.winReward.availableStock}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                            Stock: {game.winReward.availableStock}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Lose Reward */}
                    {game.loseReward ? (
                      <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-200/60 gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Frown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-semibold text-slate-700 truncate" title={game.loseReward.productName}>
                            LOSE: {game.loseReward.productName} × {game.loseReward.quantity}
                          </span>
                        </div>
                        <div className="shrink-0 text-right">
                          {game.loseReward.isOutOfStock ? (
                            <span className="px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-red-100 text-red-800 border border-red-200">
                              Out of Stock
                            </span>
                          ) : game.loseReward.isLowStock ? (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-100 text-amber-800 border border-amber-200">
                              Low: {game.loseReward.availableStock}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                              Stock: {game.loseReward.availableStock}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-200/60 italic">
                        No consolation reward configured
                      </div>
                    )}
                  </div>

                  {/* Stock Warnings Banner */}
                  {hasOutOfStock ? (
                    <div className="mt-2.5 p-2 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-800 font-semibold">
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>Reward out of stock! Game play will be restricted.</span>
                    </div>
                  ) : hasLowStock ? (
                    <div className="mt-2.5 p-2 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2 text-xs text-amber-800 font-semibold">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Low reward stock warning</span>
                    </div>
                  ) : null}

                  {/* Performance stats mini-strip */}
                  {game.stats && (
                    <div className="mt-3 grid grid-cols-4 gap-1 text-center bg-slate-50 p-2 rounded-lg border border-slate-100 text-[10px]">
                      <div>
                        <div className="text-slate-400 font-semibold uppercase">Plays</div>
                        <div className="font-bold text-slate-900 mt-0.5">{game.stats.totalPlays}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 font-semibold uppercase">Wins</div>
                        <div className="font-bold text-emerald-700 mt-0.5">{game.stats.wins}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 font-semibold uppercase">Losses</div>
                        <div className="font-bold text-slate-700 mt-0.5">{game.stats.losses}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 font-semibold uppercase">Revenue</div>
                        <div className="font-black text-slate-900 mt-0.5">₹{game.stats.totalRevenue}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Action Buttons */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenGameDetails(game)}
                      className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                      title={`View Details for ${game.name}`}
                      aria-label={`View Details for ${game.name}`}
                    >
                      <Eye className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setQrGame(game)}
                      className="p-1.5 text-slate-500 hover:text-purple-700 hover:bg-purple-50 rounded-md transition-colors cursor-pointer"
                      title={`Customer Display Placard & QR Code for ${game.name}`}
                      aria-label={`Customer Display Placard & QR Code for ${game.name}`}
                    >
                      <QrCode className="w-4 h-4" />
                    </button>

                    {canManage && (
                      <button
                        type="button"
                        onClick={() => openEditModal(game)}
                        className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                        title={`Edit configuration for ${game.name}`}
                        aria-label={`Edit configuration for ${game.name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}

                    {canManage && (
                      <button
                        type="button"
                        disabled={isTogglingStatus === game.id}
                        onClick={() => handleToggleStatus(game)}
                        className={`p-1.5 rounded-md transition-colors cursor-pointer disabled:opacity-50 ${
                          game.status === 'ACTIVE'
                            ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                            : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                        }`}
                        title={game.status === 'ACTIVE' ? `Deactivate ${game.name}` : `Activate ${game.name}`}
                        aria-label={game.status === 'ACTIVE' ? `Deactivate ${game.name}` : `Activate ${game.name}`}
                      >
                        {isTogglingStatus === game.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                        ) : (
                          <Power className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Play Action Button */}
                  <Link
                    to={`/games/play?gameId=${game.id}${game.eventId ? `&eventId=${game.eventId}` : ''}`}
                    aria-label={`Play ${game.name}`}
                    title={
                      eventEnded
                        ? 'Assigned stall has concluded (view read-only)'
                        : hasOutOfStock
                        ? 'Reward is out of stock'
                        : game.status !== 'ACTIVE'
                        ? 'Game is currently inactive'
                        : `Launch Play Terminal for ${game.name}`
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      game.status === 'ACTIVE' && !hasOutOfStock && !eventEnded
                        ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                    }`}
                  >
                    <span>
                      {eventEnded ? 'Stall Closed' : hasOutOfStock ? 'Out of Stock' : game.status !== 'ACTIVE' ? 'Inactive' : 'Play'}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}

          {/* Useful companion card when only 1 game exists (avoids huge awkward blank area without adding fake records) */}
          {filteredGames.length === 1 && !searchQuery && statusFilter === 'ALL' && eventFilter === 'ALL' && (
            canManage ? (
              <div
                onClick={openCreateModal}
                className="border-2 border-dashed border-slate-200 hover:border-slate-300 rounded-2xl p-6 bg-slate-50/50 hover:bg-slate-50/90 transition-all flex flex-col items-center justify-center text-center cursor-pointer min-h-[340px] group"
              >
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform shadow-2xs">
                  <Plus className="w-6 h-6 stroke-[2.5]" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">Add Another Stall Game</h3>
                <p className="text-xs text-slate-500 max-w-xs mt-1 leading-relaxed">
                  Set up Bottle Flip, Dart Throw, or Spin the Wheel to increase stall footfall and drive product sales.
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white border border-slate-200 group-hover:border-slate-300 rounded-lg text-xs font-bold text-slate-700 shadow-2xs">
                  <Plus className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Create Game</span>
                </span>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-2xl p-6 bg-slate-50/60 flex flex-col justify-between min-h-[340px]">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-purple-700">
                    <Info className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Stall Games Guide</span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">How Stall Games Operate</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Stall games let volunteers collect entry fees and issue inventory rewards directly from active event stock.
                  </p>
                  <ul className="text-xs text-slate-500 space-y-1.5 list-disc list-inside">
                    <li>Entry fees are tracked into event game revenue automatically.</li>
                    <li>Winning rewards deduct real-time inventory from the product catalog.</li>
                    <li>QR placards can be scanned by visitors to view rules on their phones.</li>
                  </ul>
                </div>
                <div className="pt-4 border-t border-slate-200/80 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-medium">Volunteer Terminal</span>
                  <Link
                    to="/games/play"
                    className="text-xs font-bold text-purple-700 hover:text-purple-900 flex items-center gap-1"
                  >
                    <span>Open Terminal &rarr;</span>
                  </Link>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* 4. CREATE / EDIT GAME MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-xl border border-slate-200 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingGame ? 'Edit Game Configuration' : 'Create New Game'}
                </h3>
                <p className="text-xs text-slate-500">
                  Physical stall game with automated reward stock deduction.
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Game Name & Entry Fee */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Game Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ring Toss, Bottle Flip"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 focus:ring-1 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Entry Fee (₹) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    placeholder="30"
                    value={formData.entryFee}
                    onChange={e => setFormData({ ...formData, entryFee: e.target.value })}
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 focus:ring-1 focus:ring-slate-900 font-bold"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Description / How to Play
                </label>
                <textarea
                  rows={2}
                  placeholder="Rules, ring throw distance, chances per play..."
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2 focus:ring-1 focus:ring-slate-900"
                />
              </div>

              {/* Project & Event Association */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Project Line
                  </label>
                  <select
                    value={formData.projectId}
                    onChange={e => setFormData({ ...formData, projectId: e.target.value })}
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white cursor-pointer"
                  >
                    <option value="">None / General</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Stall / Event
                  </label>
                  <select
                    value={formData.eventId}
                    onChange={e => setFormData({ ...formData, eventId: e.target.value })}
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white cursor-pointer"
                  >
                    <option value="">Any Stall / Event</option>
                    {events.map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} ({ev.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* WIN REWARD */}
              <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                  <Trophy className="w-4 h-4 text-amber-600" />
                  <span>WIN REWARD (Customer Wins)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Reward Product (From Products Database) *
                    </label>
                    <select
                      required
                      value={formData.winRewardProductId}
                      onChange={e => setFormData({ ...formData, winRewardProductId: e.target.value })}
                      className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white cursor-pointer"
                    >
                      <option value="">Select a product...</option>
                      {products.map(p => {
                        const stock = p.inventory?.quantityOnHand ?? 0;
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name} [{p.id}] (Stock: {stock})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Quantity *
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={formData.winRewardQuantity}
                      onChange={e => setFormData({ ...formData, winRewardQuantity: e.target.value })}
                      className="w-full text-xs border border-slate-300 rounded-lg p-2 font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* LOSE REWARD (Consolation) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <Frown className="w-4 h-4 text-slate-500" />
                  <span>LOSE REWARD (Consolation / Participation)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Consolation Product
                    </label>
                    <select
                      value={formData.loseRewardProductId}
                      onChange={e => setFormData({ ...formData, loseRewardProductId: e.target.value })}
                      className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white cursor-pointer"
                    >
                      <option value="">No consolation reward</option>
                      {products.map(p => {
                        const stock = p.inventory?.quantityOnHand ?? 0;
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name} [{p.id}] (Stock: {stock})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Quantity
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={formData.loseRewardQuantity}
                      onChange={e => setFormData({ ...formData, loseRewardQuantity: e.target.value })}
                      className="w-full text-xs border border-slate-300 rounded-lg p-2 font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Game Status
                </label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      value="ACTIVE"
                      checked={formData.status === 'ACTIVE'}
                      onChange={() => setFormData({ ...formData, status: 'ACTIVE' })}
                    />
                    <span className="font-semibold text-emerald-800">Active (Playable)</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      value="INACTIVE"
                      checked={formData.status === 'INACTIVE'}
                      onChange={() => setFormData({ ...formData, status: 'INACTIVE' })}
                    />
                    <span className="font-semibold text-slate-600">Inactive</span>
                  </label>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingGame ? 'Update Game' : 'Save Game'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. VIEW GAME DETAILS MODAL (FULL RECORD & LIVE SESSIONS) */}
      {viewingGame && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-details-title"
          onClick={e => {
            if (e.target === e.currentTarget) setViewingGame(null);
          }}
        >
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 my-8 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold shrink-0 mt-0.5">
                  <Gamepad2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 id="game-details-title" className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                      {viewingGame.name}
                    </h3>
                    <span
                      className={`px-2 py-0.5 text-[10px] font-extrabold uppercase rounded border ${
                        viewingGame.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {viewingGame.status}
                    </span>
                    {viewingGame.projectName && (
                      <span className="text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded uppercase tracking-wider">
                        Project {viewingGame.projectName}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Entry Fee: <strong className="text-emerald-700 font-bold">₹{viewingGame.entryFee}</strong> &bull; Stall:{' '}
                    <strong className="text-slate-700">{viewingGame.eventName || 'Any Stall / Global'}</strong>
                  </p>
                </div>
              </div>

              <button
                onClick={() => setViewingGame(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors"
                aria-label="Close game details modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live Loading Indicator */}
            {isLoadingDetails && (
              <div className="p-2.5 bg-purple-50/80 border border-purple-200 text-purple-800 text-xs rounded-xl flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600 shrink-0" />
                <span>Loading live game sessions and updated stock from database...</span>
              </div>
            )}

            {/* Error Banner with Retry */}
            {detailsError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{detailsError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenGameDetails(viewingGame)}
                  className="px-2 py-1 bg-white border border-red-300 hover:bg-red-50 rounded text-[11px] font-bold text-red-700 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Description & Rules Section */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>Rules & How to Play</span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">
                {viewingGame.description || 'No specific game rules provided. Outcome is verified and recorded by stall volunteer.'}
              </p>
            </div>

            {/* Reward Configuration & Current Stock */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Configured Rewards & Inventory Stock
              </div>

              {/* Win Reward */}
              <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>WIN Reward</span>
                  </div>
                  <div className="text-xs text-amber-900 font-semibold mt-0.5 truncate">
                    {viewingGame.winReward?.productName} &times; {viewingGame.winReward?.quantity}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-slate-500 font-medium">Available Stock</div>
                  <div className="text-sm font-black text-slate-900">
                    {viewingGame.winReward?.isOutOfStock ? (
                      <span className="text-red-600 text-xs font-bold uppercase">Out of Stock</span>
                    ) : (
                      viewingGame.winReward?.availableStock ?? 0
                    )}
                  </div>
                </div>
              </div>

              {/* Lose Reward */}
              {viewingGame.loseReward ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Frown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>LOSE Consolation</span>
                    </div>
                    <div className="text-xs text-slate-700 font-semibold mt-0.5 truncate">
                      {viewingGame.loseReward.productName} &times; {viewingGame.loseReward.quantity}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-slate-500 font-medium">Available Stock</div>
                    <div className="text-sm font-black text-slate-900">
                      {viewingGame.loseReward.isOutOfStock ? (
                        <span className="text-red-600 text-xs font-bold uppercase">Out of Stock</span>
                      ) : (
                        viewingGame.loseReward.availableStock ?? 0
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-2 text-[11px] text-slate-400 italic bg-slate-50 border border-dashed border-slate-200 rounded-lg text-center">
                  No consolation reward configured for losses.
                </div>
              )}
            </div>

            {/* Performance KPIs */}
            {viewingGame.stats && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Performance Metrics
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Total Plays</div>
                    <div className="text-base font-black text-slate-900 mt-0.5">
                      {viewingGame.stats.totalPlays ?? 0}
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Wins / Losses</div>
                    <div className="text-sm font-black text-slate-900 mt-0.5">
                      <span className="text-emerald-700">{viewingGame.stats.wins ?? 0}W</span>
                      <span className="text-slate-300 mx-1">/</span>
                      <span className="text-slate-600">{viewingGame.stats.losses ?? 0}L</span>
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Win Rate</div>
                    <div className="text-base font-black text-purple-700 mt-0.5">
                      {viewingGame.stats.winRate ?? 0}%
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Total Revenue</div>
                    <div className="text-base font-black text-emerald-700 mt-0.5">
                      ₹{viewingGame.stats.revenue ?? viewingGame.stats.totalRevenue ?? 0}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Recent Sessions Ledger Mini-Table */}
            {viewingGame.recentSessions && viewingGame.recentSessions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <span>Recent Game Plays</span>
                  <Link
                    to={`/game-sessions?gameId=${viewingGame.id}`}
                    className="text-purple-600 hover:text-purple-800 lowercase first-letter:uppercase tracking-normal font-semibold flex items-center gap-1"
                  >
                    <span>View all in ledger &rarr;</span>
                  </Link>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200">
                      <tr>
                        <th className="py-1.5 px-2.5">Session</th>
                        <th className="py-1.5 px-2.5">Result</th>
                        <th className="py-1.5 px-2.5">Reward</th>
                        <th className="py-1.5 px-2.5">Operator</th>
                        <th className="py-1.5 px-2.5 text-right">Fee</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {viewingGame.recentSessions.slice(0, 5).map((s: any) => (
                        <tr key={s.id} className="hover:bg-slate-50/50">
                          <td className="py-2 px-2.5 font-mono text-[11px] text-purple-700 font-semibold">
                            {s.sessionCode}
                          </td>
                          <td className="py-2 px-2.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                                s.result === 'WIN'
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {s.result}
                            </span>
                          </td>
                          <td className="py-2 px-2.5 text-slate-700 truncate max-w-[130px]">
                            {s.rewardDescription}
                          </td>
                          <td className="py-2 px-2.5 text-slate-600 truncate max-w-[90px]">
                            {s.sellerName}
                          </td>
                          <td className="py-2 px-2.5 text-right font-bold text-slate-900">
                            ₹{s.entryFee}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Modal Footer Actions */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] text-slate-400 font-medium">
                Created: {new Date(viewingGame.createdAt).toLocaleDateString('en-IN')}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewingGame(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Close
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      const g = viewingGame;
                      setViewingGame(null);
                      openEditModal(g);
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Edit Game</span>
                  </button>
                )}
                <Link
                  to={`/games/play?gameId=${viewingGame.id}${viewingGame.eventId ? `&eventId=${viewingGame.eventId}` : ''}`}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Gamepad2 className="w-3.5 h-3.5" />
                  <span>Play Game</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. CUSTOMER QR & RULES PREVIEW MODAL */}
      {qrGame && (() => {
        const playUrl = `${window.location.origin}/play/${qrGame.id}`;
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(playUrl)}`;

        return (
          <div
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qr-modal-title"
            onClick={e => {
              if (e.target === e.currentTarget) setQrGame(null);
            }}
          >
            <div className="bg-white rounded-2xl max-w-sm w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 text-center my-8 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span id="qr-modal-title" className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Customer Stall Placard
                </span>
                <button
                  onClick={() => setQrGame(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors"
                  aria-label="Close customer placard"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3.5">
                <div className="text-[10px] font-black tracking-widest text-slate-400 uppercase">
                  ENACTUS VIPS-TC STALL
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">
                    🎯 {qrGame.name}
                  </h3>
                  {qrGame.description && (
                    <p className="text-[11px] text-slate-500 mt-1 max-w-[250px] mx-auto line-clamp-2">
                      {qrGame.description}
                    </p>
                  )}
                </div>

                <div className="inline-block px-3.5 py-1 bg-purple-100 text-purple-900 text-sm font-black rounded-full border border-purple-200">
                  ₹{qrGame.entryFee} / Play
                </div>

                {/* Real Scannable QR Code */}
                <div className="w-44 h-44 mx-auto bg-white border-2 border-slate-900 rounded-2xl p-2.5 flex flex-col items-center justify-center shadow-xs relative overflow-hidden">
                  <img
                    src={qrImageUrl}
                    alt={`Scannable QR code to play ${qrGame.name}`}
                    className="w-36 h-36 object-contain rounded-md"
                    loading="lazy"
                  />
                  <span className="text-[9px] font-bold text-slate-500 mt-1 uppercase tracking-tight">
                    Scan to View Game Rules
                  </span>
                </div>

                {/* Rewards Card */}
                <div className="text-xs text-left bg-white p-3 rounded-xl border border-slate-200 space-y-1.5 shadow-2xs">
                  <div className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                    Stall Rewards:
                  </div>
                  <div className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>WIN: {qrGame.winReward.productName} × {qrGame.winReward.quantity}</span>
                  </div>
                  {qrGame.loseReward && (
                    <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <Frown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>LOSE: {qrGame.loseReward.productName} × {qrGame.loseReward.quantity}</span>
                    </div>
                  )}
                </div>

                <p className="text-[10px] text-slate-400 italic">
                  * Outcome is officially verified and recorded by stall volunteer.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(playUrl);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
                  title="Copy customer link to clipboard"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>

                <Link
                  to={`/play/${qrGame.id}`}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Screen</span>
                </Link>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
