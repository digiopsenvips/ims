import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { AppEvent, Game, Product, Project, Sale, EventAllocation, Combo } from '../types';
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
  Gift,
  Percent,
} from 'lucide-react';

function toISTDateString(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

function toISTTimeString(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(d);
}

interface AllocationInput {
  productId: string;
  productName: string;
  projectName: string;
  availableStock: number;
  maxAllocatable: number;
  initialAllocatedQty: number;
  allocatedQty: number;
  soldQty: number;
  remainingQty: number;
  initialPriceAtEvent: number;
  priceAtEvent: number;
}

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
  const [eventCombos, setEventCombos] = useState<Combo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Tab State
  const canViewRevenue = isDeveloper || isAdmin || hasPermission('view_revenue');
  const canViewLedger = isDeveloper || isAdmin || hasPermission('view_event_breakdown');
  const validTabs = ['overview', 'combos', 'games', 'products', ...(canViewLedger ? ['sales', 'analytics'] : [])];
  const requestedTab = searchParams.get('tab') || 'overview';
  const activeTab = validTabs.includes(requestedTab) ? requestedTab : 'overview';
  const revenueLabel = (value: number) => canViewRevenue ? `₹${value.toLocaleString('en-IN')}` : 'Restricted';
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
  const [editStartDate, setEditStartDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editAllocations, setEditAllocations] = useState<AllocationInput[]>([]);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEndingEvent, setIsEndingEvent] = useState(false);
  const [isOpeningStall, setIsOpeningStall] = useState(false);

  const canManage = isDeveloper || isAdmin || hasPermission('edit_events');
  const canManageCombos = isDeveloper || isAdmin;

  const handleOpenEditModal = () => {
    if (!event) return;
    setEditName(event.name);
    setEditLocation(event.location);
    setEditStartDate(toISTDateString(event.startDatetime));
    setEditStartTime(toISTTimeString(event.startDatetime));
    setEditEndDate(toISTDateString(event.endDatetime));
    setEditEndTime(toISTTimeString(event.endDatetime));
    setEditError(null);

    const grid: AllocationInput[] = products.map(p => {
      const existingAlloc = event.allocations?.find(a => a.productId === p.id);
      const allocatedQty = existingAlloc ? existingAlloc.allocatedQty : 0;
      const soldQty = existingAlloc ? (existingAlloc.soldQty || 0) : 0;
      const priceAtEvent = existingAlloc
        ? Number(existingAlloc.priceAtEvent)
        : p.basePrice
        ? Number(p.basePrice)
        : 0;
      const mainInventoryStock = p.inventory ? p.inventory.quantityOnHand : 0;
      const remainingInEvent = Math.max(0, allocatedQty - soldQty);
      const maxAllocatable = mainInventoryStock + remainingInEvent;

      return {
        productId: p.id,
        productName: p.name,
        projectName: p.project?.name || '—',
        availableStock: maxAllocatable,
        maxAllocatable,
        initialAllocatedQty: allocatedQty,
        allocatedQty,
        soldQty,
        remainingQty: remainingInEvent,
        initialPriceAtEvent: priceAtEvent,
        priceAtEvent,
      };
    });

    setEditAllocations(grid);
    setShowEditEventModal(true);
  };

  const handleSetMaxAllocation = (productId: string) => {
    setEditAllocations(prev =>
      prev.map(row => {
        if (row.productId !== productId) return row;
        const newAlloc = row.maxAllocatable;
        return {
          ...row,
          allocatedQty: newAlloc,
          remainingQty: Math.max(0, newAlloc - row.soldQty),
        };
      })
    );
  };

  const handleAllocationChange = (
    productId: string,
    field: 'allocatedQty' | 'priceAtEvent',
    val: number
  ) => {
    setEditAllocations(prev =>
      prev.map(row => {
        if (row.productId !== productId) return row;
        if (field === 'allocatedQty') {
          return {
            ...row,
            allocatedQty: val,
            remainingQty: Math.max(0, val - row.soldQty),
          };
        }
        return {
          ...row,
          [field]: val,
        };
      })
    );
  };

  const handleSaveEditEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;
    if (!editName.trim() || !editLocation.trim() || !editStartDate || !editEndDate) {
      setEditError('Please fill in all stall details.');
      return;
    }

    const startDatetime = new Date(`${editStartDate}T${editStartTime || '00:00'}:00+05:30`).toISOString();
    const endDatetime = new Date(`${editEndDate}T${editEndTime || '23:59'}:00+05:30`).toISOString();

    if (new Date(endDatetime).getTime() <= new Date(startDatetime).getTime()) {
      setEditError('End date and time must be after the start date and time.');
      return;
    }

    for (const row of editAllocations) {
      if (row.allocatedQty < row.soldQty) {
        setEditError(`Allocation cannot be lower than sold units. ${row.productName} has already sold ${row.soldQty} unit(s).`);
        return;
      }
      if (row.allocatedQty > row.maxAllocatable) {
        setEditError(`Maximum available quantity for ${row.productName} is ${row.maxAllocatable}.`);
        return;
      }
    }

    setIsSubmittingEdit(true);
    setEditError(null);

    try {
      const payload = {
        name: editName.trim(),
        location: editLocation.trim(),
        startDatetime,
        endDatetime,
        status: event.status,
        allocations: editAllocations.map(a => ({
          productId: a.productId,
          allocatedQty: a.allocatedQty,
          priceAtEvent: a.priceAtEvent,
        })),
      };

      await api.put(`/events/${event.id}`, payload);
      setStatusMessage({ type: 'success', text: `Stall '${editName}' and allocations saved successfully!` });
      setShowEditEventModal(false);
      await fetchEventData();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update event stall');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const fetchEventData = async () => {
    if (!eventId) return;
    try {
      const [evData, prodRes, projRes, combosRes] = await Promise.all([
        api.get<any>(`/events/${eventId}`),
        api.get('/products'),
        api.get('/projects'),
        api.get<any>(`/combos?eventId=${eventId}`),
      ]);

      const loadedEvent = evData?.event || evData;
      if (loadedEvent && loadedEvent.id) {
        setEvent(loadedEvent);
      }
      if (prodRes?.products) setProducts(prodRes.products.filter((p: Product) => !p.isArchived));
      else if (Array.isArray(prodRes)) setProducts(prodRes.filter((p: Product) => !p.isArchived));

      if (projRes?.projects) setProjects(projRes.projects);
      else if (Array.isArray(projRes)) setProjects(projRes);

      if (combosRes?.combos && Array.isArray(combosRes.combos)) {
        setEventCombos(combosRes.combos);
      }
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

  // Handle Close Stall / End Event
  const handleEndEvent = async () => {
    if (!event || !confirm(`Are you sure you want to close "${event.name}"? Unsold inventory will be returned to main warehouse.`)) return;
    setIsEndingEvent(true);
    try {
      const res = await api.post(`/events/${event.id}/close`);
      setStatusMessage({ type: 'success', text: res?.message || 'Stall closed and stock reconciled successfully!' });
      await fetchEventData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to close stall' });
    } finally {
      setIsEndingEvent(false);
    }
  };

  // Handle Open Stall
  const handleOpenStall = async () => {
    if (!event || !confirm(`Open stall "${event.name}" for live sales now?`)) return;
    setIsOpeningStall(true);
    try {
      const res = await api.post(`/events/${event.id}/open`);
      setStatusMessage({ type: 'success', text: res?.message || 'Stall is now live and accepting sales!' });
      await fetchEventData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to open stall' });
    } finally {
      setIsOpeningStall(false);
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

  // Defensively calculate all summary metrics to prevent any undefined/null runtime exceptions
  const productRevenue = Number(
    (event as any).summary?.productRevenue ??
    (event as any).summary?.totalSalesRevenue ??
    (event as any).totalRevenue ??
    0
  );
  const gameRevenue = Number(
    (event as any).summary?.gameRevenue ??
    (event as any).gameRevenue ??
    0
  );
  const totalRevenue = Number(
    (event as any).summary?.totalRevenue ??
    (productRevenue + gameRevenue)
  );
  const totalAllocatedUnits = Number(
    (event as any).summary?.totalAllocatedUnits ??
    (event as any).summary?.totalAllocated ??
    (event as any).totalAllocated ??
    0
  );
  const totalSoldUnits = Number(
    (event as any).summary?.totalSoldUnits ??
    (event as any).summary?.totalSold ??
    (event as any).totalSold ??
    0
  );
  const totalRemainingUnits = Number(
    (event as any).summary?.totalRemainingUnits ??
    (event as any).summary?.totalRemaining ??
    (event as any).totalRemaining ??
    Math.max(0, totalAllocatedUnits - totalSoldUnits)
  );
  const totalTransactions = Number(
    (event as any).summary?.totalTransactions ??
    (event.sales?.length || 0)
  );
  const totalSalesCount = Number(
    (event as any).summary?.totalSalesCount ??
    (event.sales?.filter((s: any) => s.transactionType !== 'GAME').length || 0)
  );
  const totalGamesPlayed = Number(
    (event as any).summary?.totalGamesPlayed ??
    (event as any).summary?.gamesPlayed ??
    (event as any).gamesPlayed ??
    0
  );

  const summary = {
    totalRevenue,
    productRevenue,
    gameRevenue,
    totalAllocatedUnits,
    totalSoldUnits,
    totalRemainingUnits,
    totalTransactions,
    totalSalesCount,
    totalGamesPlayed,
  };

  const soldPct = summary.totalAllocatedUnits > 0
    ? Math.min(100, Math.round((summary.totalSoldUnits / summary.totalAllocatedUnits) * 100))
    : 0;

  // Filtered Products for Products Tab
  const filteredAllocations = (event.allocations || []).filter(alloc => {
    const pName = alloc.productName || (alloc as any).product?.name || '';
    const pId = alloc.productId || '';
    const pProject = alloc.projectName || (alloc as any).product?.project?.name || '';
    const remQty = alloc.remainingQty ?? 0;

    const matchesSearch =
      pName.toLowerCase().includes(productSearch.toLowerCase()) ||
      pId.toLowerCase().includes(productSearch.toLowerCase());
    const matchesProject = projectFilter === 'ALL' || pProject === projectFilter;
    const matchesLowStock = !lowStockOnly || remQty <= 5;
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
            {canManage && (
              <button
                type="button"
                onClick={handleOpenEditModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                title="Edit stall metadata, inventory allocations, and custom pricing"
              >
                <Edit className="w-4 h-4 text-blue-600" />
                <span>Edit Stall & Pricing</span>
              </button>
            )}

            {canManageCombos && (
              <Link
                to={`/combos?action=create&eventId=${event.id}`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-semibold shadow-2xs transition-colors"
              >
                <Gift className="w-4 h-4 text-emerald-600" />
                <span>+ Create Combo</span>
              </Link>
            )}

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

            {canManage && !isEnded && !isActive && (
              <button
                onClick={handleOpenStall}
                disabled={isOpeningStall}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                title="Open stall for live sales now"
              >
                <Store className="w-3.5 h-3.5" />
                <span>{isOpeningStall ? 'Opening...' : 'Open Stall'}</span>
              </button>
            )}

            {canManage && !isEnded && isActive && (
              <button
                onClick={handleEndEvent}
                disabled={isEndingEvent}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                title="Close stall and return unsold inventory to main warehouse"
              >
                <PowerOff className="w-3.5 h-3.5 text-rose-600" />
                <span>{isEndingEvent ? 'Closing...' : 'Close Stall'}</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. Modern Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-100 pt-3 overflow-x-auto no-scrollbar">
          {[
            { id: 'overview', label: 'Overview', icon: Store },
            { id: 'combos', label: `Combos (${eventCombos.length})`, icon: Gift },
            { id: 'games', label: `Games (${event.games?.length || 0})`, icon: Dices },
            { id: 'products', label: `Products (${event.allocations?.length || 0})`, icon: Package },
            { id: 'sales', label: `Sales (${eventSales.length})`, icon: ReceiptText },
            { id: 'analytics', label: 'Analytics', icon: BarChart3 },
          ].filter(tab => validTabs.includes(tab.id)).map(tab => (
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
                {revenueLabel(summary.totalRevenue)}
              </div>
              <div className="text-xs text-slate-500 mt-1.5 space-y-0.5">
                <div>🛍️ Products: <strong>{revenueLabel(summary.productRevenue)}</strong></div>
                <div>🎮 Games: <strong>{revenueLabel(summary.gameRevenue)}</strong></div>
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
                  {canViewLedger ? 'No transactions recorded at this stall yet.' : 'Transaction history is restricted for this role.'}
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
                          {revenueLabel(Number(s.totalAmount))}
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
      {/* TAB: COMBOS & SPECIAL OFFERS                              */}
      {/* ========================================================= */}
      {activeTab === 'combos' && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight">Combos & Special Offers</h2>
              <p className="text-xs text-slate-500">
                Bundles and promotional deals configured for {event.name}. Component stock is atomically deducted from this stall.
              </p>
            </div>

            {canManageCombos && (
              <div className="flex items-center gap-2">
                <Link
                  to={`/combos?action=create&eventId=${event.id}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Create Combo Offer</span>
                </Link>
              </div>
            )}
          </div>

          {eventCombos.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-emerald-100">
                <Gift className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-1">No Combos Configured for this Stall</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-5">
                Create bundle promotions (e.g. 3 scrunchies for ₹150 or Buy 2 Get 1 Free) that automatically deduct products from this event's allocated inventory.
              </p>
              {canManageCombos && (
                <Link
                  to={`/combos?action=create&eventId=${event.id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs transition-colors shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create First Combo Offer</span>
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {eventCombos.map(combo => {
                const isOutOfStock = combo.isOutOfStock || (combo.availableStock !== undefined && combo.availableStock <= 0);
                return (
                  <div
                    key={combo.id}
                    className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-all"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200">
                          {combo.comboType ? combo.comboType.replace(/_/g, ' ') : 'COMBO'}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          combo.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {combo.status}
                        </span>
                      </div>

                      <div>
                        <h3 className="text-sm font-bold text-slate-900">{combo.name}</h3>
                        {combo.description && (
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{combo.description}</p>
                        )}
                      </div>

                      {/* Pricing */}
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-baseline justify-between">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Deal Price</span>
                          <div className="text-xl font-black text-slate-900 mt-0.5">₹{combo.price}</div>
                        </div>
                        {combo.savings !== undefined && combo.savings > 0 && (
                          <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                            Save ₹{combo.savings}
                          </span>
                        )}
                      </div>

                      {/* Items */}
                      <div className="space-y-1">
                        <div className="text-[11px] font-bold text-slate-400 uppercase">Includes:</div>
                        {(combo.items || []).map((ci, idx) => (
                          <div key={idx} className="text-xs flex items-center justify-between text-slate-700 py-0.5">
                            <span>{ci.quantity}× {ci.productName || 'Product'}</span>
                            {ci.availableStock !== undefined && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                ({ci.availableStock} in stall)
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className={`font-semibold ${isOutOfStock ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {isOutOfStock ? '⚠️ Out of stock' : `✓ ${combo.availableStock ?? 'Ready'} bundles left`}
                      </span>
                      <Link
                        to={`/sales-entry?eventId=${event.id}`}
                        className="text-emerald-700 hover:text-emerald-800 font-bold hover:underline"
                      >
                        Sell at POS →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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

            <div className="flex items-center gap-2 shrink-0">
              <div className="text-xs font-bold text-slate-500">
                Showing {filteredAllocations.length} of {event.allocations?.length || 0} product allocations
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={handleOpenEditModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  title="Adjust event stock allocations and custom prices"
                >
                  <Edit className="w-3.5 h-3.5" />
                  <span>Adjust Allocations & Pricing</span>
                </button>
              )}
            </div>
          </div>

          {/* Clean Modern Products Table */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[750px] border-collapse">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-100">
                  <tr>
                    <th scope="col" className="px-4 py-3 w-28 whitespace-nowrap">Product SKU</th>
                    <th scope="col" className="px-4 py-3 min-w-[180px]">Product Name</th>
                    <th scope="col" className="px-4 py-3 w-32 whitespace-nowrap">Project</th>
                    <th scope="col" className="px-4 py-3 text-right w-28 whitespace-nowrap">Event Price (₹)</th>
                    <th scope="col" className="px-4 py-3 text-right w-20 whitespace-nowrap">Allocated</th>
                    <th scope="col" className="px-4 py-3 text-right w-20 whitespace-nowrap">Sold</th>
                    <th scope="col" className="px-4 py-3 text-right w-20 whitespace-nowrap">Remaining</th>
                    <th scope="col" className="px-4 py-3 text-center w-24 whitespace-nowrap">Status</th>
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
                      const isDepleted = (alloc.remainingQty ?? 0) <= 0;
                      const isLow = (alloc.remainingQty ?? 0) > 0 && (alloc.remainingQty ?? 0) <= 5;

                      return (
                        <tr key={alloc.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold text-slate-600 whitespace-nowrap">
                            {alloc.productId || '—'}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-900 min-w-[180px]">
                            {alloc.productName || (alloc as any).product?.name || 'Product'}
                          </td>
                          <td className="px-4 py-3 text-slate-600 font-medium whitespace-nowrap">
                            {alloc.projectName || (alloc as any).product?.project?.name || '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-900 whitespace-nowrap">
                            ₹{Number(alloc.priceAtEvent || 0).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600 font-semibold whitespace-nowrap">
                            {alloc.allocatedQty ?? 0}
                          </td>
                          <td className="px-4 py-3 text-right text-emerald-700 font-bold whitespace-nowrap">
                            {alloc.soldQty ?? 0}
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-900 text-sm whitespace-nowrap">
                            {alloc.remainingQty ?? 0}
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            {isDepleted ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-red-100 text-red-800 whitespace-nowrap">
                                Depleted
                              </span>
                            ) : isLow ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-100 text-amber-800 whitespace-nowrap">
                                Low Stock
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 whitespace-nowrap">
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
              <table className="w-full text-left text-xs min-w-[850px] border-collapse">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-100">
                  <tr>
                    <th scope="col" className="px-4 py-3 w-24 whitespace-nowrap">Receipt #</th>
                    <th scope="col" className="px-4 py-3 w-28 whitespace-nowrap">Type</th>
                    <th scope="col" className="px-4 py-3 min-w-[180px]">Details / Items</th>
                    <th scope="col" className="px-4 py-3 w-28 whitespace-nowrap">Payment</th>
                    <th scope="col" className="px-4 py-3 text-right w-28 whitespace-nowrap">Amount (₹)</th>
                    <th scope="col" className="px-4 py-3 w-36 whitespace-nowrap">Cashier</th>
                    <th scope="col" className="px-4 py-3 w-40 whitespace-nowrap">Date / Time (IST)</th>
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
                          <td className="px-4 py-3 font-mono font-black text-slate-900 whitespace-nowrap">
                            #{sale.receiptNumber}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase whitespace-nowrap ${
                                isGame
                                  ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              {isGame ? '🎮 GAME' : 'SALE'}
                            </span>
                          </td>
                          <td className="px-4 py-3 min-w-[180px]">
                            <div className="font-semibold text-slate-900">
                              {sale.gameName || sale.description || 'Stall Transaction'}
                            </div>
                            {sale.rewardDescription && (
                              <div className="text-[10px] text-purple-700 font-medium">
                                Issued: {sale.rewardDescription}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">
                            {sale.paymentMethod}
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-900 text-sm whitespace-nowrap">
                            ₹{Number(sale.totalAmount).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-slate-600 font-medium whitespace-nowrap">
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
                    <span>{revenueLabel(summary.productRevenue)}</span>
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
                    <span>{revenueLabel(summary.gameRevenue)}</span>
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
      {/* Edit Stall & Pricing Modal */}
      {showEditEventModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl my-8 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Edit className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Edit Stall & Allocations
                  </h3>
                  <p className="text-xs text-slate-500">
                    Modify stall details, product allocations, and event-specific prices
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditEventModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editError && (
              <div className="mx-5 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl flex items-center gap-2 shrink-0">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEditEvent} className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Event Metadata */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Event / Stall Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 font-medium"
                    placeholder="e.g. Diya Stall 2026"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Location / Venue *
                  </label>
                  <input
                    type="text"
                    required
                    value={editLocation}
                    onChange={e => setEditLocation(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 font-medium"
                    placeholder="e.g. VIPS Campus Gate 1"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Start Date & Time (IST) *
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      required
                      value={editStartDate}
                      onChange={e => setEditStartDate(e.target.value)}
                      className="w-2/3 text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                    />
                    <input
                      type="time"
                      required
                      value={editStartTime}
                      onChange={e => setEditStartTime(e.target.value)}
                      className="w-1/3 text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    End Date & Time (IST) *
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      required
                      value={editEndDate}
                      onChange={e => setEditEndDate(e.target.value)}
                      className="w-2/3 text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                    />
                    <input
                      type="time"
                      required
                      value={editEndTime}
                      onChange={e => setEditEndTime(e.target.value)}
                      className="w-1/3 text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Allocations & Pricing Table */}
              <div className="space-y-2">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Product Allocations & Event Pricing
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Allocate units from warehouse and set stall-specific prices (historical sales remain protected)
                  </p>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">Product</th>
                        <th className="py-2.5 px-3 text-center">Available Max</th>
                        <th className="py-2.5 px-3 text-center">Sold So Far</th>
                        <th className="py-2.5 px-3 text-center w-36">Allocated Qty</th>
                        <th className="py-2.5 px-3 text-right w-32">Event Price (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editAllocations.map(row => (
                        <tr key={row.productId} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-900">{row.productName}</div>
                            <div className="text-[10px] text-slate-400">{row.productId} • {row.projectName}</div>
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium text-slate-600">
                            {row.maxAllocatable}
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold text-slate-700">
                            {row.soldQty}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center gap-1 justify-center">
                              <input
                                type="number"
                                min={row.soldQty}
                                max={row.maxAllocatable}
                                value={row.allocatedQty}
                                onChange={e =>
                                  handleAllocationChange(
                                    row.productId,
                                    'allocatedQty',
                                    parseInt(e.target.value, 10) || 0
                                  )
                                }
                                className="w-20 p-1.5 text-center text-xs border border-slate-300 rounded-lg font-bold focus:ring-1 focus:ring-slate-900"
                              />
                              <button
                                type="button"
                                onClick={() => handleSetMaxAllocation(row.productId)}
                                className="px-1.5 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors cursor-pointer"
                                title="Set to maximum available warehouse stock"
                              >
                                Max
                              </button>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-slate-400 font-bold">₹</span>
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={row.priceAtEvent}
                                onChange={e =>
                                  handleAllocationChange(
                                    row.productId,
                                    'priceAtEvent',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                className="w-20 p-1.5 text-right text-xs border border-slate-300 rounded-lg font-bold focus:ring-1 focus:ring-slate-900"
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowEditEventModal(false)}
                  disabled={isSubmittingEdit}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2"
                >
                  {isSubmittingEdit ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 stroke-[3]" />
                      <span>Save Stall & Allocations</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
