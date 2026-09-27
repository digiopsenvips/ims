import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { Combo, ComboType, ComboStatus, Product, AppEvent, Project } from '../types';
import {
  Gift,
  Plus,
  Search,
  Filter,
  Layers,
  Sparkles,
  Tag,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  Power,
  X,
  Loader2,
  TrendingUp,
  Package,
  ArrowRight,
  Info,
  Percent,
} from 'lucide-react';

const COMBO_TYPE_LABELS: Record<ComboType, { label: string; desc: string; color: string; badgeBg: string }> = {
  FIXED_QUANTITY: {
    label: 'Fixed Quantity',
    desc: 'Multiple units of a single product at special bundle price (e.g. 3 scrunchies for ₹150)',
    color: 'text-slate-700',
    badgeBg: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  MULTI_PRODUCT: {
    label: 'Multi-Product',
    desc: 'Pre-set pack containing multiple distinct products (e.g. 1 bookmark + 1 plant)',
    color: 'text-slate-700',
    badgeBg: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  PICK_ANY: {
    label: 'Pick Any N',
    desc: 'Customer selects any combination of eligible products up to target count (e.g. pick any 3 for ₹100)',
    color: 'text-emerald-700',
    badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  BUY_X_GET_Y: {
    label: 'Buy X Get Y',
    desc: 'Buy specified quantity and get bonus item(s) free (e.g. Buy 2, Get 1 Free)',
    color: 'text-amber-700',
    badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
  },
};

export const CombosPage: React.FC = () => {
  const { user, isDeveloper, isAdmin, isHead } = useAuth();
  const { socket } = useSocket();

  const [combos, setCombos] = useState<Combo[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ComboType>('ALL');
  const [eventFilter, setEventFilter] = useState<string>('ALL');

  const [searchParams, setSearchParams] = useSearchParams();

  // Modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [editingCombo, setEditingCombo] = useState<Combo | null>(null);
  const [viewingCombo, setViewingCombo] = useState<Combo | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Combo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formComboType, setFormComboType] = useState<ComboType>('FIXED_QUANTITY');
  const [formPrice, setFormPrice] = useState<string>('150');
  const [formEventId, setFormEventId] = useState<string>('');
  const [formProjectId, setFormProjectId] = useState<string>('');
  const [formMinItems, setFormMinItems] = useState<string>('3');
  const [formFreeItemsCount, setFormFreeItemsCount] = useState<string>('1');
  const [formStatus, setFormStatus] = useState<ComboStatus>('ACTIVE');
  const [formItems, setFormItems] = useState<Array<{ productId: string; quantity: number; isFree?: boolean }>>([
    { productId: '', quantity: 1, isFree: false },
  ]);

  // Ensure option to create combos is accessible to all users
  const canManage = isDeveloper || isAdmin || isHead || Boolean(user);
  const canViewRevenue = isDeveloper || isAdmin || Boolean(user?.permissions?.['view_revenue']);

  // Fetch all initial data
  const fetchData = async () => {
    try {
      setIsLoading(true);
      const [combosRes, productsRes, eventsRes, projectsRes] = await Promise.all([
        api.get('/combos'),
        api.get('/products'),
        api.get('/events'),
        api.get('/projects'),
      ]);

      if (combosRes && Array.isArray(combosRes.combos)) {
        setCombos(combosRes.combos);
      }
      if (productsRes && Array.isArray(productsRes.products)) {
        // Exclude archived legacy combo products so user only binds real physical items
        setProducts(productsRes.products.filter((p: Product) => !p.isArchived && !p.isDeleted));
      }
      if (eventsRes && Array.isArray(eventsRes.events)) {
        setEvents(eventsRes.events);
      }
      if (projectsRes && Array.isArray(projectsRes.projects)) {
        setProjects(projectsRes.projects);
      }
    } catch (err: any) {
      console.error('Failed to load combos:', err);
      setErrorMessage(err?.error || 'Failed to load combo deals');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Handle URL direct action trigger (e.g. /combos?action=create or /combos?action=create&eventId=...)
  useEffect(() => {
    if (searchParams.get('action') === 'create' && products.length > 0) {
      const targetEvent = searchParams.get('eventId') || '';
      setEditingCombo(null);
      setFormName('');
      setFormDescription('');
      setFormComboType('FIXED_QUANTITY');
      setFormPrice('150');
      setFormEventId(targetEvent);
      setFormProjectId('');
      setFormMinItems('3');
      setFormFreeItemsCount('1');
      setFormStatus('ACTIVE');
      setFormItems([{ productId: products[0]?.id || '', quantity: 3, isFree: false }]);
      setShowCreateModal(true);
    }
  }, [searchParams, products]);

  // Real-time socket listeners
  useEffect(() => {
    if (!socket) return;
    const handleUpdate = () => {
      fetchData();
    };
    socket.on('combo:created', handleUpdate);
    socket.on('combo:updated', handleUpdate);
    socket.on('combo:sold', handleUpdate);
    socket.on('inventory:updated', handleUpdate);

    return () => {
      socket.off('combo:created', handleUpdate);
      socket.off('combo:updated', handleUpdate);
      socket.off('combo:sold', handleUpdate);
      socket.off('inventory:updated', handleUpdate);
    };
  }, [socket]);

  // Filtered Combos
  const filteredCombos = useMemo(() => {
    return combos.filter(c => {
      if (c.isArchived) return false;
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && c.comboType !== typeFilter) return false;
      if (eventFilter !== 'ALL') {
        if (eventFilter === 'GLOBAL' && c.eventId !== null) return false;
        if (eventFilter !== 'GLOBAL' && c.eventId !== eventFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = c.name.toLowerCase().includes(q);
        const matchDesc = (c.description || '').toLowerCase().includes(q);
        const matchItem = (c.items || []).some(
          i => i.productName.toLowerCase().includes(q) || i.productId.toLowerCase().includes(q)
        );
        if (!matchName && !matchDesc && !matchItem) return false;
      }
      return true;
    });
  }, [combos, statusFilter, typeFilter, eventFilter, searchQuery]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const active = combos.filter(c => !c.isArchived && c.status === 'ACTIVE');
    const totalSold = combos.reduce((sum, c) => sum + (c.salesCount || 0), 0);
    const totalRev = combos.reduce((sum, c) => sum + (c.revenue || 0), 0);
    return {
      activeCount: active.length,
      totalCombos: combos.filter(c => !c.isArchived).length,
      totalSold,
      totalRevenue: totalRev,
    };
  }, [combos]);

  // Live calculation of Normal Value and Savings for modal form
  const liveFormCalculation = useMemo(() => {
    let normalValue = 0;
    formItems.forEach(item => {
      const prod = products.find(p => p.id === item.productId);
      if (prod && item.quantity > 0) {
        const unitPrice = Number(prod.basePrice || 0);
        normalValue += unitPrice * item.quantity;
      }
    });

    const dealPrice = parseFloat(formPrice) || 0;
    const savings = Math.max(0, normalValue - dealPrice);
    const savingsPercent = normalValue > 0 ? Math.round((savings / normalValue) * 100) : 0;

    return {
      normalValue,
      dealPrice,
      savings,
      savingsPercent,
    };
  }, [formItems, formPrice, products]);

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setEditingCombo(null);
    setFormName('');
    setFormDescription('');
    setFormComboType('FIXED_QUANTITY');
    setFormPrice('150');
    setFormEventId('');
    setFormProjectId('');
    setFormMinItems('3');
    setFormFreeItemsCount('1');
    setFormStatus('ACTIVE');
    setFormItems([{ productId: products[0]?.id || '', quantity: 3, isFree: false }]);
    setErrorMessage(null);
    setShowCreateModal(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (combo: Combo) => {
    setEditingCombo(combo);
    setFormName(combo.name);
    setFormDescription(combo.description || '');
    setFormComboType(combo.comboType);
    setFormPrice(String(combo.price));
    setFormEventId(combo.eventId || '');
    setFormProjectId(combo.projectId || '');
    setFormMinItems(String(combo.minItems || 3));
    setFormFreeItemsCount(String(combo.freeItemsCount || 1));
    setFormStatus(combo.status);
    setFormItems(
      combo.items && combo.items.length > 0
        ? combo.items.map(i => ({
            productId: i.productId,
            quantity: i.quantity,
            isFree: Boolean(i.isFree),
          }))
        : [{ productId: products[0]?.id || '', quantity: 1, isFree: false }]
    );
    setErrorMessage(null);
    setShowCreateModal(true);
  };

  // Add Item to Form
  const handleAddFormItem = () => {
    setFormItems(prev => [...prev, { productId: products[0]?.id || '', quantity: 1, isFree: false }]);
  };

  // Remove Item from Form
  const handleRemoveFormItem = (idx: number) => {
    setFormItems(prev => prev.filter((_, i) => i !== idx));
  };

  // Update Form Item
  const handleUpdateFormItem = (idx: number, updates: Partial<{ productId: string; quantity: number; isFree: boolean }>) => {
    setFormItems(prev =>
      prev.map((item, i) => (i === idx ? { ...item, ...updates } : item))
    );
  };

  // Submit Create / Edit Combo
  const handleSubmitCombo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setErrorMessage('Combo offer name is required');
      return;
    }
    const priceNum = parseFloat(formPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setErrorMessage('Please enter a valid deal price');
      return;
    }

    const validItems = formItems.filter(i => i.productId && i.quantity > 0);
    if (validItems.length === 0) {
      setErrorMessage('Please specify at least one product component');
      return;
    }

    // Auto-detect project if products belong to the same project and project is not explicitly selected
    let effectiveProjectId = formProjectId || undefined;
    if (!effectiveProjectId) {
      const pIds = Array.from(new Set(validItems.map(i => products.find(p => p.id === i.productId)?.projectId).filter(Boolean)));
      if (pIds.length === 1) {
        effectiveProjectId = pIds[0];
      }
    }

    const payload = {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      comboType: formComboType,
      price: priceNum,
      eventId: formEventId || null,
      projectId: effectiveProjectId || null,
      minItems: formComboType === 'PICK_ANY' ? parseInt(formMinItems, 10) || 3 : undefined,
      freeItemsCount: formComboType === 'BUY_X_GET_Y' ? parseInt(formFreeItemsCount, 10) || 1 : undefined,
      status: formStatus,
      items: validItems,
    };

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (editingCombo) {
        await api.put(`/combos/${editingCombo.id}`, payload);
        setSuccessMessage(`Combo "${formName}" updated successfully`);
      } else {
        await api.post('/combos', payload);
        setSuccessMessage(`New combo "${formName}" created successfully`);
      }
      setShowCreateModal(false);
      fetchData();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      console.error('Save combo error:', err);
      setErrorMessage(err?.error || 'Failed to save combo offer');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle Combo Active/Inactive Status
  const handleToggleStatus = async (combo: Combo) => {
    try {
      await api.patch(`/combos/${combo.id}/toggle-status`, {});
      setCombos(prev =>
        prev.map(c =>
          c.id === combo.id
            ? { ...c, status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }
            : c
        )
      );
    } catch (err: any) {
      alert(err?.error || 'Failed to update combo status');
    }
  };

  // Archive Combo (Safe Soft-Delete)
  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    try {
      await api.delete(`/combos/${archiveTarget.id}`);
      setCombos(prev => prev.filter(c => c.id !== archiveTarget.id));
      setArchiveTarget(null);
      setSuccessMessage(`Combo "${archiveTarget.name}" archived successfully`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      alert(err?.error || 'Failed to archive combo');
    }
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-emerald-600" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Event Combos & Special Offers
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Create and manage dynamic product bundles and promotional offers.
          </p>
        </div>

        {canManage && (
          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Create Combo</span>
          </button>
        )}
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-emerald-800 text-xs font-semibold shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <p>{successMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-800 text-xs font-semibold shadow-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <p>{errorMessage}</p>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Active Offers
            </span>
            <Sparkles className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1.5">
            {metrics.activeCount}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {metrics.activeCount} active of {metrics.totalCombos} total
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Combos Sold
            </span>
            <Layers className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1.5">
            {metrics.totalSold}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Total bundles purchased
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Combo Revenue
            </span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-1.5">
            {canViewRevenue ? `₹${metrics.totalRevenue.toLocaleString('en-IN')}` : 'Confidential'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Promotional gross sales
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Available Types
            </span>
            <Tag className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1.5">
            4
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Deal models supported
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search combos by name, product, or description..."
              className="w-full pl-9 pr-8 py-2 bg-slate-50/70 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs self-start md:self-auto shrink-0">
            {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  statusFilter === s
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {s === 'ALL' ? 'All' : s === 'ACTIVE' ? 'Active' : 'Paused'}
              </button>
            ))}
          </div>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as any)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
          >
            <option value="ALL">All Deal Types</option>
            <option value="FIXED_QUANTITY">Fixed Quantity</option>
            <option value="MULTI_PRODUCT">Multi-Product Pack</option>
            <option value="PICK_ANY">Pick Any N</option>
            <option value="BUY_X_GET_Y">Buy X Get Y Free</option>
          </select>

          {/* Event Filter */}
          <select
            value={eventFilter}
            onChange={e => setEventFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
          >
            <option value="ALL">All Events / Global</option>
            <option value="GLOBAL">Global Offers Only</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.name} ({ev.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Combos Grid */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mb-3" />
          <p className="text-sm font-medium text-slate-500">Loading dynamic combos & real-time inventory...</p>
        </div>
      ) : filteredCombos.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/80 shadow-xs">
          <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-100">
            <Gift className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">No Combos Found</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
            {searchQuery || statusFilter !== 'ALL' || typeFilter !== 'ALL' || eventFilter !== 'ALL'
              ? 'No combo offers match your active filter criteria. Try clearing search or filters.'
              : 'Create special event bundles and multi-buy promotions that automatically deduct physical components from event stalls.'}
          </p>
          {canManage && (
            <button
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm transition-all shadow-xs"
            >
              <Plus className="w-4 h-4" />
              Create First Combo Offer
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredCombos.map(combo => {
            const typeMeta = COMBO_TYPE_LABELS[combo.comboType] || COMBO_TYPE_LABELS.FIXED_QUANTITY;
            const isOutOfStock = combo.isOutOfStock || (combo.availableStock !== undefined && combo.availableStock <= 0);
            const isLowStock = combo.isLowStock;

            return (
              <div
                key={combo.id}
                className={`bg-white rounded-2xl border transition-all hover:shadow-md flex flex-col justify-between overflow-hidden ${
                  combo.status === 'INACTIVE'
                    ? 'opacity-70 border-slate-200 bg-slate-50/50'
                    : 'border-slate-200/90 hover:border-slate-300'
                }`}
              >
                {/* Card Top */}
                <div className="p-5 space-y-4">
                  {/* Status & Type Bar */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border ${typeMeta.badgeBg}`}>
                      {typeMeta.label}
                    </span>

                    <div className="flex items-center gap-2">
                      {combo.eventName ? (
                        <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                          {combo.eventName}
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-slate-600 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200">
                          All Events
                        </span>
                      )}

                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                          combo.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${combo.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        {combo.status}
                      </span>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3 className="text-base font-bold text-slate-900 leading-snug line-clamp-1">
                      {combo.name}
                    </h3>
                    {combo.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                        {combo.description}
                      </p>
                    )}
                  </div>

                  {/* Pricing & Savings Banner */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Combo Price</span>
                        <div className="flex items-baseline gap-2 mt-0.5">
                          <span className="text-2xl font-black text-slate-900 tracking-tight">
                            ₹{combo.price}
                          </span>
                          {combo.normalValue !== undefined && combo.normalValue > combo.price && (
                            <span className="text-xs text-slate-400 line-through font-medium">
                              ₹{combo.normalValue}
                            </span>
                          )}
                        </div>
                      </div>

                      {combo.savings !== undefined && combo.savings > 0 && (
                        <div className="text-right">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/70 text-xs font-bold rounded-lg">
                            <Percent className="w-3 h-3" />
                            Save ₹{combo.savings} ({combo.savingsPercent}%)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Component Items List */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                      <span>INCLUDES ({combo.items?.length || 0})</span>
                      {combo.comboType === 'PICK_ANY' && (
                        <span className="text-emerald-700 font-bold">Pick Any {combo.minItems || 3}</span>
                      )}
                    </div>

                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {combo.items?.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs p-2 bg-slate-50/80 rounded-lg border border-slate-100"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-slate-900 flex-shrink-0">
                              {item.quantity}×
                            </span>
                            <span className="truncate font-medium text-slate-700">
                              {item.productName}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium uppercase">
                              ({item.projectName})
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {item.availableStock !== undefined && (
                              <span
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                  item.availableStock <= 0
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : item.availableStock < 5
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                                }`}
                              >
                                {item.availableStock} in stall
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Stock Status Bar */}
                  <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 text-xs font-medium">
                    <span className="text-slate-400">Live Availability:</span>
                    {isOutOfStock ? (
                      <span className="font-semibold text-rose-600 flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5" /> Out of stock
                      </span>
                    ) : isLowStock ? (
                      <span className="font-semibold text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Low stock ({combo.availableStock} bundles)
                      </span>
                    ) : (
                      <span className="font-semibold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {combo.availableStock ?? 'Available'} bundles available
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                {canManage && (
                  <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleToggleStatus(combo)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow-2xs ${
                        combo.status === 'ACTIVE'
                          ? 'text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50'
                          : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {combo.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleOpenEditModal(combo)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors shadow-2xs"
                        title="Edit combo"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>

                      <button
                        onClick={() => setArchiveTarget(combo)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                        title="Archive combo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE / EDIT COMBO MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
                  <Gift className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {editingCombo ? 'Edit Combo Offer' : 'Create Special Combo Offer'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Define bundling rules, component quantities, and promotional bundle price
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmitCombo} className="p-6 space-y-5">
              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-800 text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Basic Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Combo Offer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g. Combo: 3 Zipper Scrunchies"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Combo Type *
                  </label>
                  <select
                    value={formComboType}
                    onChange={e => setFormComboType(e.target.value as ComboType)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors cursor-pointer"
                  >
                    <option value="FIXED_QUANTITY">Fixed Quantity (Multiples of same product)</option>
                    <option value="MULTI_PRODUCT">Multi-Product (Bundle of different items)</option>
                    <option value="PICK_ANY">Pick Any N (Customer choice)</option>
                    <option value="BUY_X_GET_Y">Buy X Get Y Free</option>
                  </select>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description / Marketing Tagline
                </label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="e.g. Best seller bundle for stall visitors — Save ₹30!"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                />
              </div>

              {/* Event & Project Scope */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Event Stall Scope
                  </label>
                  <select
                    value={formEventId}
                    onChange={e => setFormEventId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors cursor-pointer"
                  >
                    <option value="">Available across all stalls (Global)</option>
                    {events.map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} ({ev.status})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">Leave blank to make available in every event</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Primary Project Attribution
                  </label>
                  <select
                    value={formProjectId}
                    onChange={e => setFormProjectId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors cursor-pointer"
                  >
                    <option value="">Auto-detect from component products</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Conditional Options: Pick Any or Buy X Get Y */}
              {formComboType === 'PICK_ANY' && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200/80 rounded-xl">
                  <label className="block text-xs font-semibold text-emerald-900 mb-1">
                    Number of items customer must pick (minItems)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={formMinItems}
                    onChange={e => setFormMinItems(e.target.value)}
                    className="w-24 px-3 py-1.5 bg-white border border-emerald-300 rounded-lg text-sm font-bold text-emerald-950 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-emerald-700 mt-1">
                    The customer can pick any combination of the products added below totaling this quantity.
                  </p>
                </div>
              )}

              {/* Dynamic Components Picker */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">
                    Physical Product Components *
                  </label>
                  <button
                    type="button"
                    onClick={handleAddFormItem}
                    className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Component
                  </button>
                </div>

                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {formItems.map((item, idx) => {
                    const selectedProd = products.find(p => p.id === item.productId);
                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                      >
                        {/* Product Selector */}
                        <div className="flex-1">
                          <select
                            required
                            value={item.productId}
                            onChange={e => handleUpdateFormItem(idx, { productId: e.target.value })}
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                          >
                            <option value="" disabled>Select physical product...</option>
                            {products.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.id}) — ₹{p.basePrice || 0}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Quantity */}
                        <div className="w-24">
                          <input
                            type="number"
                            min="1"
                            max="50"
                            required
                            value={item.quantity}
                            onChange={e => handleUpdateFormItem(idx, { quantity: parseInt(e.target.value, 10) || 1 })}
                            placeholder="Qty"
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-center font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                          />
                        </div>

                        {/* Price Preview */}
                        <div className="w-20 text-right text-xs font-bold text-slate-700">
                          ₹{((selectedProd?.basePrice || 0) * item.quantity).toFixed(0)}
                        </div>

                        {/* Remove */}
                        {formItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveFormItem(idx)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Pricing & Savings Real-Time Calculator */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Promotional Deal Price (₹) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      value={formPrice}
                      onChange={e => setFormPrice(e.target.value)}
                      placeholder="e.g. 150"
                      className="w-36 px-3 py-2 bg-white border border-slate-300 rounded-xl text-lg font-black text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-500">Normal Standalone Value</div>
                    <div className="text-lg font-bold text-slate-800">
                      ₹{liveFormCalculation.normalValue.toFixed(0)}
                    </div>
                  </div>
                </div>

                {liveFormCalculation.savings > 0 ? (
                  <div className="p-2.5 bg-emerald-50 rounded-xl flex items-center justify-between text-xs text-emerald-800 font-bold border border-emerald-200">
                    <span>Customer Discount:</span>
                    <span>Save ₹{liveFormCalculation.savings.toFixed(0)} ({liveFormCalculation.savingsPercent}% OFF)</span>
                  </div>
                ) : (
                  <div className="p-2.5 bg-amber-50 rounded-xl text-xs text-amber-800 font-medium border border-amber-200">
                    Note: Deal price is equal to or higher than normal individual prices.
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-all shadow-xs"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingCombo ? 'Save Changes' : 'Publish Combo Offer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ARCHIVE CONFIRMATION MODAL */}
      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 border border-slate-200 shadow-xl space-y-4">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center border border-rose-100">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Archive Combo "{archiveTarget.name}"?
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                This will safely deactivate the combo and hide it from member sales stalls. All historical receipts and transaction records remain permanently intact.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setArchiveTarget(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmArchive}
                className="px-4 py-2 text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-all shadow-xs"
              >
                Yes, Archive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default CombosPage;
