import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { AppEvent, Game, Product, Project, Sale, EventAllocation } from '../types';
import {
  Store,
  Calendar,
  MapPin,
  Clock,
  CreditCard,
  Banknote,
  Trophy,
  Gamepad2,
  Plus,
  Search,
  Filter,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Package,
  Edit,
  PowerOff,
  ChevronRight,
  TrendingUp,
  BarChart3,
  Users,
  ReceiptText,
  Layers,
  Sparkles,
  RefreshCw,
  X,
  Coins,
  Frown,
  Check,
  Eye,
  ShoppingCart,
  Dices,
} from 'lucide-react';

function formatISTDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export const EventDetailsPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isDeveloper, isAdmin, isHead, hasPermission } = useAuth();
  const { socket } = useSocket();

  const [event, setEvent] = useState<AppEvent | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Tab State
  const validTabs = ['overview', 'games', 'products', 'sales', 'analytics'];
  const activeTab = searchParams.get('tab') || 'overview';
  const setTab = (t: string) => {
    setSearchParams({ tab: t });
  };

  // Products Tab Filters
  const [productSearch, setProductSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  // Sales Tab Filters
  const [saleTypeFilter, setSaleTypeFilter] = useState<'ALL' | 'SALE' | 'GAME'>('ALL');
  const [saleSearch, setSaleSearch] = useState('');

  // Add Game Wizard Modal State
  const [showAddGameModal, setShowAddGameModal] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [gameFormData, setGameFormData] = useState({
    name: '',
    description: '',
    entryFee: '30',
    winRewardProductId: '',
    winRewardQuantity: '1',
    loseRewardProductId: '',
    loseRewardQuantity: '1',
  });
  const [isSubmittingGame, setIsSubmittingGame] = useState(false);
  const [gameError, setGameError] = useState<string | null>(null);

  // Edit Event Modal State
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [isEndingEvent, setIsEndingEvent] = useState(false);

  const canManage = isDeveloper || isAdmin || isHead || hasPermission('edit_events');

  const fetchEventData = async () => {
    if (!eventId) return;
    try {
      const [evData, prodRes, projRes] = await Promise.all([
        api.get<AppEvent>(`/events/${eventId}`),
        api.get('/products'),
        api.get('/projects'),
      ]);

      if (evData) setEvent(evData);
      if (prodRes?.products) setProducts(prodRes.products);
      if (projRes?.projects) setProjects(projRes.projects);
    } catch (err: any) {
      console.error('Failed to load event details:', err);
      setStatusMessage({ type: 'error', text: err.message || 'Failed to load event data' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEventData();
  }, [eventId]);

  // WebSocket sync
  useEffect(() => {
    if (!socket) return;
    const handleUpdate = () => fetchEventData();
    socket.on('event:updated', handleUpdate);
    socket.on('sale:created', handleUpdate);
    socket.on('game:played', handleUpdate);
    socket.on('game:updated', handleUpdate);
    socket.on('inventory:updated', handleUpdate);

    return () => {
      socket.off('event:updated', handleUpdate);
      socket.off('sale:created', handleUpdate);
      socket.off('game:played', handleUpdate);
      socket.off('game:updated', handleUpdate);
      socket.off('inventory:updated', handleUpdate);
    };
  }, [socket, eventId]);

  // Handle End Event
  const handleEndEvent = async () => {
    if (!event || !confirm(`Are you sure you want to end "${event.name}"? Unsold inventory will be returned.`)) return;
    setIsEndingEvent(true);
    try {
      await api.patch(`/events/${event.id}/status`, { status: 'ENDED' });
      setStatusMessage({ type: 'success', text: 'Event ended and stock reconciled successfully!' });
      await fetchEventData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to end event' });
    } finally {
      setIsEndingEvent(false);
    }
  };

  // Open Add Game Wizard
  const openAddGameWizard = () => {
    setWizardStep(1);
    setGameFormData({
      name: '',
      description: '',
      entryFee: '30',
      winRewardProductId: products[0]?.id || '',
      winRewardQuantity: '1',
      loseRewardProductId: '',
      loseRewardQuantity: '1',
    });
    setGameError(null);
    setShowAddGameModal(true);
  };

  // Submit Add Game Wizard
  const handleSaveGame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;
    setGameError(null);
    setIsSubmittingGame(true);

    try {
      if (!gameFormData.name.trim()) throw new Error('Game name is required');
      if (!gameFormData.winRewardProductId) throw new Error('Win reward product is required');

      const payload = {
        name: gameFormData.name.trim(),
        description: gameFormData.description.trim() || undefined,
        eventId: event.id,
        entryFee: parseFloat(gameFormData.entryFee) || 0,
        status: 'ACTIVE',
        winRewardProductId: gameFormData.winRewardProductId,
        winRewardQuantity: parseInt(gameFormData.winRewardQuantity, 10) || 1,
        loseRewardProductId: gameFormData.loseRewardProductId || undefined,
        loseRewardQuantity: parseInt(gameFormData.loseRewardQuantity, 10) || 1,
      };

      await api.post('/games', payload);
      setStatusMessage({ type: 'success', text: `Game "${gameFormData.name}" added to stall successfully!` });
      setShowAddGameModal(false);
      await fetchEventData();
    } catch (err: any) {
      setGameError(err.message || 'Failed to create game');
    } finally {
      setIsSubmittingGame(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center text-slate-400">
        <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-slate-700" />
        <p className="text-sm font-bold">Loading Event Stall Console...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="max-w-4xl mx-auto p-12 text-center space-y-4">
        <AlertCircle className="w-12 h-12 mx-auto text-rose-500" />
        <h2 className="text-xl font-bold text-slate-900">Event Not Found</h2>
        <p className="text-sm text-slate-500">The requested event stall could not be located.</p>
        <Link
          to="/events"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Events</span>
        </Link>
      </div>
    );
  }

  const isActive = event.status === 'ACTIVE';
  const isEnded = event.status === 'ENDED';
  const summary = event.summary || {
    totalRevenue: (event.totalRevenue || 0) + (event.gameRevenue || 0),
    productRevenue: event.totalRevenue || 0,
    gameRevenue: event.gameRevenue || 0,
    totalAllocatedUnits: event.totalAllocated || 0,
    totalSoldUnits: event.totalSold || 0,
    totalRemainingUnits: event.totalRemaining || 0,
    totalTransactions: (event.sales?.length || 0),
    totalSalesCount: event.sales?.filter((s: any) => s.transactionType !== 'GAME').length || 0,
    totalGamesPlayed: event.gamesPlayed || 0,
  };

  const soldPct = summary.totalAllocatedUnits > 0
    ? Math.min(100, Math.round((summary.totalSoldUnits / summary.totalAllocatedUnits) * 100))
    : 0;

  // Filtered Products for Products Tab
  const filteredAllocations = (event.allocations || []).filter(alloc => {
    const matchesSearch =
      alloc.productName.toLowerCase().includes(productSearch.toLowerCase()) ||
      alloc.productId.toLowerCase().includes(productSearch.toLowerCase());
    const matchesProject = projectFilter === 'ALL' || alloc.projectName === projectFilter;
    const matchesLowStock = !lowStockOnly || alloc.remainingQty <= 5;
    return matchesSearch && matchesProject && matchesLowStock;
  });

  // Filtered Sales for Sales Tab
  const eventSales: Sale[] = event.sales || [];
  const filteredSales = eventSales.filter(s => {
    const isGame = s.transactionType === 'GAME' || !!s.gameId;
    if (saleTypeFilter === 'SALE' && isGame) return false;
    if (saleTypeFilter === 'GAME' && !isGame) return false;

    if (saleSearch.trim()) {
      const q = saleSearch.toLowerCase().trim();
      const numMatch = s.receiptNumber ? String(s.receiptNumber).includes(q.replace('#', '')) : false;
      const gameMatch = s.gameName?.toLowerCase().includes(q) || false;
      const descMatch = s.description?.toLowerCase().includes(q) || false;
      const memberMatch = s.memberName?.toLowerCase().includes(q) || false;
      return numMatch || gameMatch || descMatch || memberMatch;
    }
    return true;
  });

  return (
    <div className="space-y-6 pb-20">
      {/* Top Banner & Status Message */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between shadow-xs ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. Header Card: Event Info & Quick Stall Actions */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Link
                to="/events"
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 mr-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Events</span>
              </Link>
              <span className="text-slate-300">/</span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : isEnded
                    ? 'bg-slate-100 text-slate-600 border border-slate-200'
                    : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}
              >
                {isActive && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
                {event.status}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {event.name}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
              <span className="flex items-center gap-1 font-medium">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span>{event.location}</span>
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-700 font-semibold">{formatISTDateTime(event.startDatetime)}</span>
                <span className="text-slate-400">to</span>
                <span className="text-slate-700 font-semibold">{formatISTDateTime(event.endDatetime)}</span>
              </span>
            </div>
          </div>

          {/* Quick Stall Actions */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link
              to={`/sales-entry?eventId=${event.id}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>+ New Sale</span>
            </Link>

            <Link
              to={`/games/play?eventId=${event.id}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
            >
              <Gamepad2 className="w-4 h-4" />
              <span>🎮 Play Game</span>
            </Link>

            {canManage && !isEnded && isActive && (
              <button
                onClick={handleEndEvent}
                disabled={isEndingEvent}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                title="End event and return unsold items"
              >
                <PowerOff className="w-3.5 h-3.5" />
                <span>End Event</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. Modern Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-100 pt-3 overflow-x-auto no-scrollbar">
          {[
            { id: 'overview', label: 'Overview', icon: Store },
            { id: 'games', label: `Games (${event.games?.length || 0})`, icon: Dices },
            { id: 'products', label: `Products (${event.allocations?.length || 0})`, icon: Package },
            { id: 'sales', label: `Sales (${eventSales.length})`, icon: ReceiptText },
            { id: 'analytics', label: 'Analytics', icon: BarChart3 },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-slate-900 text-slate-900 bg-slate-50'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ========================================================= */}
      {/* TAB 1: OVERVIEW                                           */}
      {/* ========================================================= */}
      {activeTab === 'overview' && (
        <div className="space-y-6 animate-fadeIn">
          {/* 4 KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Stall Revenue */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Total Stall Revenue
              </div>
              <div className="text-2xl font-black text-emerald-700 mt-1">
                ₹{summary.totalRevenue.toLocaleString('en-IN')}
              </div>
              <div className="text-xs text-slate-500 mt-1.5 space-y-0.5">
                <div>🛍️ Products: <strong>₹{summary.productRevenue.toLocaleString('en-IN')}</strong></div>
                <div>🎮 Games: <strong>₹{summary.gameRevenue.toLocaleString('en-IN')}</strong></div>
              </div>
            </div>

            {/* Units Sold & Progress */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Units Sold
              </div>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {summary.totalSoldUnits}{' '}
                <span className="text-sm font-semibold text-slate-400">/ {summary.totalAllocatedUnits}</span>
              </div>
              <div className="mt-2">
                <div className="flex justify-between text-[11px] font-bold text-slate-600 mb-1">
                  <span>{soldPct}% Sold</span>
                  <span>{summary.totalRemainingUnits} remaining</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all"
                    style={{ width: `${soldPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Games Activity */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Games Played
              </div>
              <div className="text-2xl font-black text-purple-900 mt-1">
                {summary.totalGamesPlayed} <span className="text-sm font-semibold text-slate-400">plays</span>
              </div>
              <div className="text-xs text-slate-500 mt-1.5 flex items-center justify-between">
                <span>Active Games: <strong>{event.games?.length || 0}</strong></span>
                <button
                  onClick={() => setTab('games')}
                  className="text-purple-700 font-bold hover:underline"
                >
                  Manage →
                </button>
              </div>
            </div>

            {/* Total Stall Transactions */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Total Transactions
              </div>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {summary.totalTransactions}
              </div>
              <div className="text-xs text-slate-500 mt-1.5 space-y-0.5">
                <div>Sales: <strong>{summary.totalSalesCount}</strong></div>
                <div>Game Plays: <strong>{summary.totalGamesPlayed}</strong></div>
              </div>
            </div>
          </div>

          {/* Quick Action Banner */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Stall Terminal Operations</span>
                <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase rounded bg-emerald-500 text-slate-950">
                  Ready
                </span>
              </h3>
              <p className="text-xs text-slate-300 max-w-xl">
                Operate sales or interactive games directly from this stall console. All transactions will automatically record under <strong>{event.name}</strong> and update inventory in real-time.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/sales-entry?eventId=${event.id}`}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                + Open POS Sale
              </Link>
              <Link
                to={`/games/play?eventId=${event.id}`}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                🎮 Play Game
              </Link>
              {canManage && (
                <button
                  onClick={openAddGameWizard}
                  className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  + Add Game
                </button>
              )}
            </div>
          </div>

          {/* Quick Previews: Games & Recent Sales */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Assigned Games Preview */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4 text-purple-600" />
                  <span>Stall Games ({event.games?.length || 0})</span>
                </h3>
                <button
                  onClick={() => setTab('games')}
                  className="text-xs font-bold text-purple-700 hover:underline"
                >
                  View All →
                </button>
              </div>

              {(!event.games || event.games.length === 0) ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl text-xs text-slate-400 space-y-2">
                  <p>No games assigned to this stall yet.</p>
                  {canManage && (
                    <button
                      onClick={openAddGameWizard}
                      className="px-3 py-1.5 bg-purple-600 text-white text-xs font-bold rounded-lg shadow-xs"
                    >
                      + Add First Game
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {event.games.slice(0, 3).map((g: any) => (
                    <div
                      key={g.id}
                      className="p-3 bg-slate-50 hover:bg-slate-100/70 border border-slate-200/80 rounded-xl flex items-center justify-between transition-colors"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{g.name}</span>
                          <span className="text-[10px] text-purple-700 font-bold bg-purple-100 px-1.5 py-0.2 rounded">
                            ₹{g.entryFee}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          🏆 {g.winReward?.productName || 'Reward'} ({g.plays || 0} plays)
                        </div>
                      </div>

                      <Link
                        to={`/games/play?eventId=${event.id}&gameId=${g.id}`}
                        className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors"
                      >
                        Play
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Sales Ledger Preview */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <ReceiptText className="w-4 h-4 text-emerald-600" />
                  <span>Recent Activity ({eventSales.length})</span>
                </h3>
                <button
                  onClick={() => setTab('sales')}
                  className="text-xs font-bold text-emerald-700 hover:underline"
                >
                  Full Ledger →
                </button>
              </div>

              {eventSales.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl text-xs text-slate-400">
                  No transactions recorded at this stall yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {eventSales.slice(0, 4).map(s => {
                    const isGame = s.transactionType === 'GAME' || !!s.gameId;
                    return (
                      <div
                        key={s.id}
                        className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                            #{s.receiptNumber}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-extrabold uppercase ${
                              isGame
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {isGame ? '🎮 GAME' : 'SALE'}
                          </span>
                          <span className="font-semibold text-slate-800 truncate max-w-[160px]">
                            {s.gameName || s.description || 'Transaction'}
                          </span>
                        </div>

                        <div className="text-right font-black text-slate-900">
                          ₹{Number(s.totalAmount).toFixed(2)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: GAMES                                              */}
      {/* ========================================================= */}
      {activeTab === 'games' && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight">Stall Games & Activities</h2>
              <p className="text-xs text-slate-500">
                Games configured to operate at {event.name}. Cashiers can play and issue rewards instantly.
              </p>
            </div>

            {canManage && (
              <button
                onClick={openAddGameWizard}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add Game to Stall</span>
              </button>
            )}
          </div>

          {(!event.games || event.games.length === 0) ? (
            <div className="bg-white p-12 rounded-2xl border border-slate-200/80 text-center space-y-3 shadow-xs">
              <Dices className="w-12 h-12 mx-auto text-purple-300" />
              <h3 className="text-base font-bold text-slate-800">No Games Configured Yet</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Add crowd-attracting games like Ring Toss, Lucky Wheel, or Dice Roll with inventory-backed rewards.
              </p>
              {canManage && (
                <button
                  onClick={openAddGameWizard}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
                >
                  + Add New Game
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {event.games.map((game: any) => (
                <div
                  key={game.id}
                  className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-all"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-base font-black text-slate-900">{game.name}</h3>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                              game.status === 'ACTIVE'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {game.status}
                          </span>
                        </div>
                        {game.description && (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{game.description}</p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Entry</div>
                        <div className="text-lg font-black text-purple-900">₹{game.entryFee}</div>
                      </div>
                    </div>

                    {/* Rewards Summary */}
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/60 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-amber-800 font-bold flex items-center gap-1">
                          🏆 <span>WIN:</span>
                        </span>
                        <span className="font-semibold text-slate-900 text-right truncate max-w-[170px]">
                          {game.winReward?.productName || '—'} × {game.winReward?.quantity || 1}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 text-right">
                        Available Stock: <strong>{game.winReward?.availableStock ?? '—'}</strong>
                      </div>

                      {game.loseReward && (
                        <div className="pt-1.5 border-t border-slate-200/60 flex items-center justify-between">
                          <span className="text-slate-600 font-bold flex items-center gap-1">
                            ❌ <span>LOSE:</span>
                          </span>
                          <span className="font-semibold text-slate-700 text-right truncate max-w-[170px]">
                            {game.loseReward.productName} × {game.loseReward.quantity || 1}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Performance metrics */}
                    <div className="grid grid-cols-2 gap-2 text-center pt-1">
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Plays</div>
                        <div className="text-sm font-black text-slate-800">{game.plays || 0}</div>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Revenue</div>
                        <div className="text-sm font-black text-emerald-700">₹{game.revenue || 0}</div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-2 mt-4">
                    <Link
                      to={`/games/play?eventId=${event.id}&gameId=${game.id}`}
                      className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold text-center shadow-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Gamepad2 className="w-3.5 h-3.5" />
                      <span>Play Game</span>
                    </Link>

                    <Link
                      to="/games"
                      className="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                      title="Manage Game in Games Portal"
                    >
                      Manage
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: PRODUCTS & INVENTORY                               */}
      {/* ========================================================= */}
      {activeTab === 'products' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Controls Bar */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search products by name or SKU..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              {/* Project Filter */}
              <select
                value={projectFilter}
                onChange={e => setProjectFilter(e.target.value)}
                className="text-xs p-1.5 border border-slate-200 rounded-lg bg-white text-slate-700 font-semibold focus:outline-none"
              >
                <option value="ALL">All Projects</option>
                {projects.map(p => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>

              {/* Low Stock Toggle */}
              <button
                type="button"
                onClick={() => setLowStockOnly(!lowStockOnly)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${
                  lowStockOnly
                    ? 'bg-amber-500 text-white border-amber-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                ⚠️ Low Stock (&le; 5)
              </button>
            </div>

            <div className="text-xs font-bold text-slate-500 shrink-0">
              Showing {filteredAllocations.length} of {event.allocations?.length || 0} product allocations
            </div>
          </div>

          {/* Clean Modern Products Table */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3">Product SKU</th>
                    <th className="px-4 py-3">Product Name</th>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3 text-right">Event Price (₹)</th>
                    <th className="px-4 py-3 text-right">Allocated</th>
                    <th className="px-4 py-3 text-right">Sold</th>
                    <th className="px-4 py-3 text-right">Remaining</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAllocations.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400">
                        No product allocations match your current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredAllocations.map(alloc => {
                      const isDepleted = alloc.remainingQty <= 0;
                      const isLow = alloc.remainingQty > 0 && alloc.remainingQty <= 5;

                      return (
                        <tr key={alloc.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold text-slate-600">
                            {alloc.productId}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-900">
                            {alloc.productName}
                          </td>
                          <td className="px-4 py-3 text-slate-600 font-medium">
                            {alloc.projectName}
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-900">
                            ₹{Number(alloc.priceAtEvent).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600 font-semibold">
                            {alloc.allocatedQty}
                          </td>
                          <td className="px-4 py-3 text-right text-emerald-700 font-bold">
                            {alloc.soldQty}
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-900 text-sm">
                            {alloc.remainingQty}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isDepleted ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-red-100 text-red-800">
                                Depleted
                              </span>
                            ) : isLow ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-100 text-amber-800">
                                Low Stock
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-100 text-emerald-800">
                                In Stock
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 4: SALES LEDGER                                       */}
      {/* ========================================================= */}
      {activeTab === 'sales' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Controls Bar */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              {/* Type Filter Buttons */}
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-bold">
                <button
                  onClick={() => setSaleTypeFilter('ALL')}
                  className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                    saleTypeFilter === 'ALL' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  All ({eventSales.length})
                </button>
                <button
                  onClick={() => setSaleTypeFilter('SALE')}
                  className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                    saleTypeFilter === 'SALE' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Sales Only
                </button>
                <button
                  onClick={() => setSaleTypeFilter('GAME')}
                  className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                    saleTypeFilter === 'GAME' ? 'bg-white text-purple-800 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Games Only
                </button>
              </div>

              {/* Search */}
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by receipt # or cashier..."
                  value={saleSearch}
                  onChange={e => setSaleSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 text-xs border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="text-xs font-bold text-slate-500">
              {filteredSales.length} Transactions Found
            </div>
          </div>

          {/* Transactions Table */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3">Receipt #</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Details / Items</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3 text-right">Amount (₹)</th>
                    <th className="px-4 py-3">Cashier</th>
                    <th className="px-4 py-3">Date / Time (IST)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        No transactions found matching your criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredSales.map(sale => {
                      const isGame = sale.transactionType === 'GAME' || !!sale.gameId;

                      return (
                        <tr key={sale.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3 font-mono font-black text-slate-900">
                            #{sale.receiptNumber}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                isGame
                                  ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              {isGame ? '🎮 GAME' : 'SALE'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">
                              {sale.gameName || sale.description || 'Stall Transaction'}
                            </div>
                            {sale.rewardDescription && (
                              <div className="text-[10px] text-purple-700 font-medium">
                                Issued: {sale.rewardDescription}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-700">
                            {sale.paymentMethod}
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-900 text-sm">
                            ₹{Number(sale.totalAmount).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-slate-600 font-medium">
                            {sale.memberName || '—'}
                          </td>
                          <td className="px-4 py-3 text-slate-500 font-medium whitespace-nowrap">
                            {formatISTDateTime(sale.createdAt)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 5: ANALYTICS                                          */}
      {/* ========================================================= */}
      {activeTab === 'analytics' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Revenue Distribution */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-600" />
                <span>Revenue Breakdown</span>
              </h3>

              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                    <span>🛍️ Product Sales</span>
                    <span>₹{summary.productRevenue.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full"
                      style={{
                        width: `${summary.totalRevenue > 0 ? (summary.productRevenue / summary.totalRevenue) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                    <span>🎮 Game Sessions</span>
                    <span>₹{summary.gameRevenue.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-purple-600 h-full rounded-full"
                      style={{
                        width: `${summary.totalRevenue > 0 ? (summary.gameRevenue / summary.totalRevenue) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Inventory Sell-Through */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-600" />
                <span>Inventory Sell-Through</span>
              </h3>

              <div className="p-4 bg-slate-50 rounded-xl space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-medium">Total Allocated:</span>
                  <span className="font-bold text-slate-900">{summary.totalAllocatedUnits} units</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-medium">Total Sold:</span>
                  <span className="font-bold text-emerald-700">{summary.totalSoldUnits} units</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-medium">Unsold Remaining:</span>
                  <span className="font-bold text-slate-900">{summary.totalRemainingUnits} units</span>
                </div>
                <div className="flex justify-between text-xs pt-2 border-t border-slate-200 font-bold">
                  <span className="text-slate-700">Sell-through Rate:</span>
                  <span className="text-slate-900">{soldPct}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: STEP-BY-STEP ADD GAME WIZARD                       */}
      {/* ========================================================= */}
      {showAddGameModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 space-y-4 animate-scaleUp">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  + Add Game to Stall
                </h3>
                <p className="text-xs text-slate-500">Step {wizardStep} of 4</p>
              </div>
              <button
                onClick={() => setShowAddGameModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {gameError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{gameError}</span>
              </div>
            )}

            {/* Wizard Steps */}
            <form onSubmit={handleSaveGame} className="space-y-4">
              {/* STEP 1: Basic Info */}
              {wizardStep === 1 && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Game Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ring Toss Challenge"
                      value={gameFormData.name}
                      onChange={e => setGameFormData({ ...gameFormData, name: e.target.value })}
                      className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Description & Rules (Optional)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. 3 rings for ₹30. Ring any bottle to win a canvas pouch!"
                      value={gameFormData.description}
                      onChange={e => setGameFormData({ ...gameFormData, description: e.target.value })}
                      className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      disabled={!gameFormData.name.trim()}
                      onClick={() => setWizardStep(2)}
                      className="px-4 py-2 bg-slate-900 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer"
                    >
                      Next: Entry Fee →
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Entry Fee */}
              {wizardStep === 2 && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Entry Fee per Play (₹) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      required
                      value={gameFormData.entryFee}
                      onChange={e => setGameFormData({ ...gameFormData, entryFee: e.target.value })}
                      className="w-full text-lg p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 font-black text-slate-900"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setWizardStep(3)}
                      className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
                    >
                      Next: Win Reward →
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Win Reward */}
              {wizardStep === 3 && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      🏆 Win Reward Product *
                    </label>
                    <select
                      value={gameFormData.winRewardProductId}
                      onChange={e => setGameFormData({ ...gameFormData, winRewardProductId: e.target.value })}
                      className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-white focus:ring-1 focus:ring-slate-900 font-semibold"
                    >
                      {products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.id}) &bull; Stock: {p.inventory?.quantityOnHand ?? 0}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Quantity Awarded per Win
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={gameFormData.winRewardQuantity}
                      onChange={e => setGameFormData({ ...gameFormData, winRewardQuantity: e.target.value })}
                      className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 font-bold"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setWizardStep(4)}
                      className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
                    >
                      Next: Consolation Reward →
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 4: Consolation Reward & Save */}
              {wizardStep === 4 && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      ❌ Consolation / Loss Reward (Optional)
                    </label>
                    <select
                      value={gameFormData.loseRewardProductId}
                      onChange={e => setGameFormData({ ...gameFormData, loseRewardProductId: e.target.value })}
                      className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-white focus:ring-1 focus:ring-slate-900 font-semibold"
                    >
                      <option value="">None (No physical reward on loss)</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.id}) &bull; Stock: {p.inventory?.quantityOnHand ?? 0}
                        </option>
                      ))}
                    </select>
                  </div>

                  {gameFormData.loseRewardProductId && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Quantity Awarded per Loss
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={gameFormData.loseRewardQuantity}
                        onChange={e => setGameFormData({ ...gameFormData, loseRewardQuantity: e.target.value })}
                        className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 font-bold"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setWizardStep(3)}
                      className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      ← Back
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingGame}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      {isSubmittingGame ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Saving Game...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 stroke-[3]" />
                          <span>Confirm & Create Game</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
