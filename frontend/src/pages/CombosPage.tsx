import React, { useState, useEffect, useMemo } from 'react';
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
    color: 'text-blue-700 dark:text-blue-300',
    badgeBg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  },
  MULTI_PRODUCT: {
    label: 'Multi-Product',
    desc: 'Pre-set pack containing multiple distinct products (e.g. 1 bookmark + 1 plant)',
    color: 'text-purple-700 dark:text-purple-300',
    badgeBg: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
  },
  PICK_ANY: {
    label: 'Pick Any N',
    desc: 'Customer selects any combination of eligible products up to target count (e.g. pick any 3 for ₹100)',
    color: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  },
  BUY_X_GET_Y: {
    label: 'Buy X Get Y',
    desc: 'Buy specified quantity and get bonus item(s) free (e.g. Buy 2, Get 1 Free)',
    color: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
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

  const canManage = isDeveloper || isAdmin || isHead;
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
    <div className="space-y-6">
      {/* Header & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 rounded-xl">
              <Gift className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
                Event Combos & Special Offers
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Dynamic product bundles, promotional pricing rules & live atomic inventory deduction
              </p>
            </div>
          </div>
        </div>

        {canManage && (
          <button
            onClick={handleOpenCreateModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-medium rounded-xl shadow-sm shadow-pink-500/20 transition-all active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            Create Combo Offer
          </button>
        )}
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-3 text-emerald-800 dark:text-emerald-300 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-sm font-medium">{successMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-3 text-rose-800 dark:text-rose-300">
          <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          <p className="text-sm font-medium">{errorMessage}</p>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Active Offers
            </span>
            <Sparkles className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
            {metrics.activeCount} <span className="text-xs text-gray-400 font-normal">/ {metrics.totalCombos}</span>
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Combos Sold
            </span>
            <Layers className="w-4 h-4 text-purple-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
            {metrics.totalSold} <span className="text-xs text-gray-400 font-normal">bundles</span>
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Combo Revenue
            </span>
            <TrendingUp className="w-4 h-4 text-pink-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
            {canViewRevenue ? `₹${metrics.totalRevenue.toFixed(0)}` : 'Confidential'}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Available Types
            </span>
            <Tag className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
            4 <span className="text-xs text-gray-400 font-normal">deal models</span>
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search combos by name, product or description..."
              className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-pink-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700/50 p-1 rounded-lg">
            {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  statusFilter === s
                    ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
              >
                {s === 'ALL' ? 'All' : s === 'ACTIVE' ? 'Active' : 'Inactive'}
              </button>
            ))}
          </div>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as any)}
            className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-pink-500"
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
            className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-pink-500"
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
        <div className="py-20 flex flex-col items-center justify-center text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin text-pink-600 mb-3" />
          <p className="text-sm">Loading dynamic combos & real-time inventory...</p>
        </div>
      ) : filteredCombos.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-12 text-center border border-gray-200 dark:border-gray-700">
          <div className="w-16 h-16 bg-pink-50 dark:bg-pink-900/20 text-pink-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Gift className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">No Combos Found</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
            {searchQuery || statusFilter !== 'ALL' || typeFilter !== 'ALL' || eventFilter !== 'ALL'
              ? 'No combo offers match your active filter criteria. Try clearing search or filters.'
              : 'Create special event bundles and multi-buy promotions that automatically deduct physical components from event stalls.'}
          </p>
          {canManage && (
            <button
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white font-medium rounded-xl text-sm transition-all"
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
                className={`bg-white dark:bg-gray-800 rounded-2xl border transition-all hover:shadow-md flex flex-col justify-between overflow-hidden ${
                  combo.status === 'INACTIVE'
                    ? 'opacity-60 border-gray-200 dark:border-gray-700'
                    : 'border-gray-200 dark:border-gray-700 hover:border-pink-300 dark:hover:border-pink-700'
                }`}
              >
                {/* Card Top */}
                <div className="p-5 space-y-4">
                  {/* Status & Type Bar */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${typeMeta.badgeBg}`}>
                      {typeMeta.label}
                    </span>

                    <div className="flex items-center gap-2">
                      {combo.eventName ? (
                        <span className="text-[11px] font-medium text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-md">
                          {combo.eventName}
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-purple-700 bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800">
                          All Stalls
                        </span>
                      )}

                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          combo.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${combo.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                        {combo.status}
                      </span>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-snug">
                      {combo.name}
                    </h3>
                    {combo.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                        {combo.description}
                      </p>
                    )}
                  </div>

                  {/* Pricing & Savings Banner */}
                  <div className="p-3.5 bg-gradient-to-br from-pink-50 to-rose-50/50 dark:from-pink-950/20 dark:to-rose-950/10 rounded-xl border border-pink-100 dark:border-pink-900/40">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Deal Price</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-extrabold text-pink-700 dark:text-pink-400">
                            ₹{combo.price}
                          </span>
                          {combo.normalValue !== undefined && combo.normalValue > combo.price && (
                            <span className="text-xs text-gray-400 line-through">
                              ₹{combo.normalValue}
                            </span>
                          )}
                        </div>
                      </div>

                      {combo.savings !== undefined && combo.savings > 0 && (
                        <div className="text-right">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-xs font-bold rounded-md">
                            <Percent className="w-3 h-3" />
                            Save ₹{combo.savings} ({combo.savingsPercent}%)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Component Items List */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400">
                      <span>Includes ({combo.items?.length || 0} products)</span>
                      {combo.comboType === 'PICK_ANY' && (
                        <span className="text-emerald-600 font-bold">Pick Any {combo.minItems || 3}</span>
                      )}
                    </div>

                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {combo.items?.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs p-2 bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-100 dark:border-gray-800"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-gray-900 dark:text-white flex-shrink-0">
                              {item.quantity}×
                            </span>
                            <span className="truncate text-gray-700 dark:text-gray-300">
                              {item.productName}
                            </span>
                            <span className="text-[10px] text-gray-400 uppercase">
                              ({item.projectName})
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {item.availableStock !== undefined && (
                              <span
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                  item.availableStock <= 0
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                                    : item.availableStock < 5
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
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
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800 text-xs">
                    <span className="text-gray-500">Live Availability:</span>
                    {isOutOfStock ? (
                      <span className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5" /> Out of stock
                      </span>
                    ) : isLowStock ? (
                      <span className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Low stock ({combo.availableStock} bundles)
                      </span>
                    ) : (
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {combo.availableStock ?? 'Available'} bundles
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                {canManage && (
                  <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/60 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleToggleStatus(combo)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        combo.status === 'ACTIVE'
                          ? 'text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800'
                          : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {combo.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleOpenEditModal(combo)}
                        className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                        title="Edit combo"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setArchiveTarget(combo)}
                        className="p-1.5 text-rose-500 hover:text-rose-700 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-pink-100 dark:bg-pink-900/30 text-pink-600 rounded-xl">
                  <Gift className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    {editingCombo ? 'Edit Combo Offer' : 'Create Special Combo Offer'}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Define bundling rules, component quantities, and promotional bundle price
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmitCombo} className="p-6 space-y-5">
              {errorMessage && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-rose-800 dark:text-rose-300 text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Basic Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Combo Offer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g. Combo: 3 Zipper Scrunchies"
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-pink-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Combo Type *
                  </label>
                  <select
                    value={formComboType}
                    onChange={e => setFormComboType(e.target.value as ComboType)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-pink-500"
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
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Description / Marketing Tagline
                </label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="e.g. Best seller bundle for stall visitors — Save ₹30!"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-pink-500"
                />
              </div>

              {/* Event & Project Scope */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Event Stall Scope
                  </label>
                  <select
                    value={formEventId}
                    onChange={e => setFormEventId(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-pink-500"
                  >
                    <option value="">Available across all stalls (Global)</option>
                    {events.map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} ({ev.status})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-400 mt-1">Leave blank to make available in every event</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Primary Project Attribution
                  </label>
                  <select
                    value={formProjectId}
                    onChange={e => setFormProjectId(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-pink-500"
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
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                  <label className="block text-xs font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
                    Number of items customer must pick (minItems)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={formMinItems}
                    onChange={e => setFormMinItems(e.target.value)}
                    className="w-24 px-3 py-1.5 bg-white dark:bg-gray-900 border border-emerald-300 rounded-lg text-sm font-bold text-emerald-900 dark:text-emerald-100"
                  />
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                    The customer can pick any combination of the products added below totaling this quantity.
                  </p>
                </div>
              )}

              {/* Dynamic Components Picker */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Physical Product Components *
                  </label>
                  <button
                    type="button"
                    onClick={handleAddFormItem}
                    className="inline-flex items-center gap-1 text-xs font-bold text-pink-600 hover:text-pink-700 dark:text-pink-400"
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
                        className="flex items-center gap-2 p-2.5 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl"
                      >
                        {/* Product Selector */}
                        <div className="flex-1">
                          <select
                            required
                            value={item.productId}
                            onChange={e => handleUpdateFormItem(idx, { productId: e.target.value })}
                            className="w-full px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
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
                            className="w-full px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-center font-bold text-gray-900 dark:text-white"
                          />
                        </div>

                        {/* Price Preview */}
                        <div className="w-20 text-right text-xs font-semibold text-gray-600 dark:text-gray-300">
                          ₹{((selectedProd?.basePrice || 0) * item.quantity).toFixed(0)}
                        </div>

                        {/* Remove */}
                        {formItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveFormItem(idx)}
                            className="p-1.5 text-gray-400 hover:text-rose-600 rounded-md"
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
              <div className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
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
                      className="w-36 px-3 py-2 bg-white dark:bg-gray-800 border border-pink-400 rounded-lg text-base font-extrabold text-pink-700 dark:text-pink-400 focus:outline-hidden focus:ring-2 focus:ring-pink-500"
                    />
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-gray-500">Normal Standalone Value</div>
                    <div className="text-lg font-bold text-gray-600 dark:text-gray-300">
                      ₹{liveFormCalculation.normalValue.toFixed(0)}
                    </div>
                  </div>
                </div>

                {liveFormCalculation.savings > 0 ? (
                  <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800">
                    <span>Customer Discount:</span>
                    <span>Save ₹{liveFormCalculation.savings.toFixed(0)} ({liveFormCalculation.savingsPercent}% OFF)</span>
                  </div>
                ) : (
                  <div className="p-2 bg-amber-50 dark:bg-amber-950/40 rounded-lg text-xs text-amber-800 dark:text-amber-300 font-medium">
                    Note: Deal price is equal to or higher than normal individual prices.
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-all shadow-sm shadow-pink-500/20"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700 shadow-xl space-y-4">
            <div className="w-12 h-12 bg-rose-100 dark:bg-rose-900/30 text-rose-600 rounded-xl flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Archive Combo "{archiveTarget.name}"?
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                This will safely deactivate the combo and hide it from member sales stalls. All historical receipts and transaction records remain permanently intact.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setArchiveTarget(null)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmArchive}
                className="px-4 py-2 text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-all"
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
