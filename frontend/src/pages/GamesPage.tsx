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

  // Modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [viewingGame, setViewingGame] = useState<Game | null>(null);
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
      if (prodRes?.products) setProducts(prodRes.products);
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

  const handleToggleStatus = async (game: Game) => {
    try {
      const nextStatus = game.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await api.patch(`/games/${game.id}/status`, { status: nextStatus });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
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
      {/* 1. Header with Stats & Actions */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-600 text-white flex items-center justify-center font-black shadow-xs">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Game Management
              </h1>
              <p className="text-xs text-slate-500">
                Configure physical stall games, reward products, entry pricing, and live inventory links.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            to="/games/play"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <Gamepad2 className="w-4 h-4" />
            <span>🎮 Play Game Terminal</span>
          </Link>

          {canManage && (
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Game</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Search & Filters Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="w-full md:w-80 relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search game, reward, event, project..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status:</span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === s ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Event Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Event:</span>
            <select
              value={eventFilter}
              onChange={e => setEventFilter(e.target.value)}
              className="text-xs font-semibold bg-white border border-slate-300 rounded-lg py-1 px-2.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer"
            >
              <option value="ALL">All Events / Stalls</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 3. Games Grid */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
          <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-slate-400" />
          Loading games catalog...
        </div>
      ) : filteredGames.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Gamepad2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-900">No games found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            {games.length === 0
              ? 'No games configured yet. Click "Create Game" above to launch Ring Toss, Bottle Flip, or other stall games.'
              : 'No games match your active filters or search terms.'}
          </p>
          {canManage && games.length === 0 && (
            <button
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Game</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGames.map(game => {
            const hasLowStock = game.winReward.isLowStock || game.loseReward?.isLowStock;
            const hasOutOfStock = game.winReward.isOutOfStock || game.loseReward?.isOutOfStock;

            return (
              <div
                key={game.id}
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-all"
              >
                <div>
                  {/* Top Bar: Title, Project & Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-slate-900 tracking-tight">
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
                        <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider mt-0.5 inline-block">
                          Project {game.projectName}
                        </span>
                      )}
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-400 uppercase">Entry Fee</div>
                      <div className="text-base font-black text-emerald-700">
                        ₹{game.entryFee}
                      </div>
                    </div>
                  </div>

                  {game.description && (
                    <p className="text-xs text-slate-500 mt-2 line-clamp-2">
                      {game.description}
                    </p>
                  )}

                  {/* Event association */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">Stall / Event:</span>
                    <span className="font-semibold text-slate-700 truncate max-w-[180px]">
                      {game.eventName || 'Any Stall'}
                    </span>
                  </div>

                  {/* Rewards Config Block */}
                  <div className="mt-3 bg-slate-50 border border-slate-200/80 rounded-lg p-2.5 space-y-2">
                    {/* Win Reward */}
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="font-semibold text-slate-800 truncate">
                          WIN: {game.winReward.productName} × {game.winReward.quantity}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        {game.winReward.isOutOfStock ? (
                          <span className="px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-red-100 text-red-800 border border-red-200">
                            🔴 Out of Stock
                          </span>
                        ) : game.winReward.isLowStock ? (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-100 text-amber-800 border border-amber-200">
                            ⚠ Low: {game.winReward.availableStock}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                            Stock: {game.winReward.availableStock}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Lose Reward */}
                    {game.loseReward && (
                      <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-200/60">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Frown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-semibold text-slate-700 truncate">
                            LOSE: {game.loseReward.productName} × {game.loseReward.quantity}
                          </span>
                        </div>
                        <div className="shrink-0 text-right">
                          {game.loseReward.isOutOfStock ? (
                            <span className="px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-red-100 text-red-800 border border-red-200">
                              🔴 Out of Stock
                            </span>
                          ) : game.loseReward.isLowStock ? (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-100 text-amber-800 border border-amber-200">
                              ⚠ Low: {game.loseReward.availableStock}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                              Stock: {game.loseReward.availableStock}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stock Warnings Banner */}
                  {hasOutOfStock ? (
                    <div className="mt-2.5 p-2 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-800 font-semibold">
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>🔴 Reward out of stock! Game play will be restricted.</span>
                    </div>
                  ) : hasLowStock ? (
                    <div className="mt-2.5 p-2 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2 text-xs text-amber-800 font-semibold">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>⚠ Low reward stock warning</span>
                    </div>
                  ) : null}

                  {/* Performance stats mini-strip */}
                  {game.stats && (
                    <div className="mt-3 grid grid-cols-4 gap-1 text-center bg-slate-50/60 p-2 rounded-lg border border-slate-100 text-[10px]">
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
                      onClick={() => setViewingGame(game)}
                      className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                      title="View Details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => setQrGame(game)}
                      className="p-1.5 text-slate-500 hover:text-purple-700 hover:bg-purple-50 rounded-md transition-colors cursor-pointer"
                      title="Customer QR & Rules"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>

                    {canManage && (
                      <button
                        onClick={() => openEditModal(game)}
                        className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                        title="Edit Game Configuration"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}

                    {canManage && (
                      <button
                        onClick={() => handleToggleStatus(game)}
                        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                          game.status === 'ACTIVE'
                            ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                            : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                        }`}
                        title={game.status === 'ACTIVE' ? 'Deactivate Game' : 'Activate Game'}
                      >
                        <Power className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <Link
                    to={`/games/play?gameId=${game.id}${game.eventId ? `&eventId=${game.eventId}` : ''}`}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      game.status === 'ACTIVE' && !hasOutOfStock
                        ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-400 pointer-events-none'
                    }`}
                  >
                    <span>Play</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
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

      {/* 5. VIEW GAME DETAILS MODAL */}
      {viewingGame && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-xl border border-slate-200 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center font-bold">
                  <Gamepad2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 leading-tight">
                    {viewingGame.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {viewingGame.projectName ? `Project ${viewingGame.projectName}` : 'Stall Game'} &bull; Entry: ₹{viewingGame.entryFee}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingGame(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {viewingGame.description && (
              <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                {viewingGame.description}
              </p>
            )}

            {/* Reward Configuration & Current Stock */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Configured Rewards
              </div>
              <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5 text-amber-600" />
                    <span>WIN Reward</span>
                  </div>
                  <div className="text-xs text-amber-900 font-semibold mt-0.5">
                    {viewingGame.winReward.productName} × {viewingGame.winReward.quantity}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500 font-medium">Available Stock</div>
                  <div className="text-sm font-black text-slate-900">
                    {viewingGame.winReward.availableStock}
                  </div>
                </div>
              </div>

              {viewingGame.loseReward && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Frown className="w-3.5 h-3.5 text-slate-500" />
                      <span>LOSE Consolation</span>
                    </div>
                    <div className="text-xs text-slate-700 font-semibold mt-0.5">
                      {viewingGame.loseReward.productName} × {viewingGame.loseReward.quantity}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500 font-medium">Available Stock</div>
                    <div className="text-sm font-black text-slate-900">
                      {viewingGame.loseReward.availableStock}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Performance KPIs */}
            {viewingGame.stats && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Performance Metrics
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Total Plays</div>
                    <div className="text-base font-black text-slate-900 mt-0.5">{viewingGame.stats.totalPlays}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Win Rate</div>
                    <div className="text-base font-black text-purple-700 mt-0.5">{viewingGame.stats.winRate}%</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Total Revenue</div>
                    <div className="text-base font-black text-emerald-700 mt-0.5">₹{viewingGame.stats.totalRevenue}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-medium">
                Created: {new Date(viewingGame.createdAt).toLocaleDateString('en-IN')}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setViewingGame(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Close
                </button>
                <Link
                  to={`/games/play?gameId=${viewingGame.id}`}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-xs cursor-pointer flex items-center gap-1"
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
      {qrGame && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200 space-y-4 text-center my-8">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Customer Display Card
              </span>
              <button
                onClick={() => setQrGame(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
              <div className="text-[11px] font-black tracking-widest text-slate-400 uppercase">
                ENACTUS VIPS-TC STALL
              </div>
              <div className="text-2xl font-black text-slate-900 tracking-tight">
                🎯 {qrGame.name}
              </div>
              <div className="inline-block px-3 py-1 bg-purple-100 text-purple-900 text-sm font-black rounded-full border border-purple-200">
                ₹{qrGame.entryFee} / Play
              </div>

              {/* Simulated QR Code placeholder / direct link */}
              <div className="w-40 h-40 mx-auto bg-white border-2 border-slate-900 rounded-xl p-2 flex flex-col items-center justify-center shadow-xs">
                <QrCode className="w-28 h-28 text-slate-900" />
                <span className="text-[9px] font-bold text-slate-500 mt-1 uppercase tracking-tight">
                  Scan to View Rules
                </span>
              </div>

              <div className="text-xs text-left bg-white p-3 rounded-xl border border-slate-200 space-y-1.5">
                <div className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                  Rewards:
                </div>
                <div className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-amber-500" />
                  <span>WIN: {qrGame.winReward.productName} × {qrGame.winReward.quantity}</span>
                </div>
                {qrGame.loseReward && (
                  <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <Frown className="w-3.5 h-3.5 text-slate-400" />
                    <span>LOSE: {qrGame.loseReward.productName} × {qrGame.loseReward.quantity}</span>
                  </div>
                )}
              </div>

              <p className="text-[10px] text-slate-400 italic">
                * Outcome is officially verified and recorded by stall volunteer.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2">
              <Link
                to={`/play/${qrGame.id}`}
                target="_blank"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Customer Screen</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
