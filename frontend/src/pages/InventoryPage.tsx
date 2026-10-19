import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { InventoryItem, Product } from '../types';
import {
  Boxes,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  X,
  Edit2,
  Radio,
  Search,
  RotateCcw,
  Store,
  Warehouse,
  Info,
  Package,
} from 'lucide-react';

interface BulkIntakeRow {
  productId: string;
  quantity: string;
  notes: string;
}

export const InventoryPage: React.FC = () => {
  const { isDeveloper, isAdmin, hasPermission } = useAuth();
  const { socket, isConnected } = useSocket();

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>('ALL');
  const [stockLevelFilter, setStockLevelFilter] = useState<'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'DEPLOYED' | 'OUT_OF_STOCK'>('ALL');
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);

  // Bulk Intake Modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkIntakeRow[]>([
    { productId: '', quantity: '', notes: '' },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Single Adjustment Modal
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [adjustQtyInput, setAdjustQtyInput] = useState('');
  const [adjustNotesInput, setAdjustNotesInput] = useState('');

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const canEditInventory = isDeveloper || isAdmin || hasPermission('edit_inventory');

  const fetchInventory = async () => {
    try {
      const [invRes, prodRes] = await Promise.all([
        api.get('/inventory'),
        api.get('/products'),
      ]);
      if (invRes?.inventory) setInventory(invRes.inventory);
      if (prodRes?.products) setProducts(prodRes.products.filter((p: Product) => !p.isArchived));
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to fetch inventory' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  // Listen to WebSocket inventory updates
  useEffect(() => {
    if (!socket) return;

    const handleInventoryUpdated = (data: any) => {
      fetchInventory();
      if (data?.productId) {
        setRecentlyUpdatedId(data.productId);
        setTimeout(() => setRecentlyUpdatedId(null), 3000);
      }
    };

    socket.on('inventory:updated', handleInventoryUpdated);
    socket.on('sale:created', handleInventoryUpdated);

    return () => {
      socket.off('inventory:updated', handleInventoryUpdated);
      socket.off('sale:created', handleInventoryUpdated);
    };
  }, [socket]);

  // Bulk Intake Handlers
  const handleAddBulkRow = () => {
    setBulkRows([...bulkRows, { productId: '', quantity: '', notes: '' }]);
  };

  const handleRemoveBulkRow = (index: number) => {
    if (bulkRows.length > 1) {
      setBulkRows(bulkRows.filter((_, i) => i !== index));
    }
  };

  const handleBulkChange = (index: number, field: keyof BulkIntakeRow, value: string) => {
    const updated = [...bulkRows];
    updated[index][field] = value;
    setBulkRows(updated);
  };

  const handleSubmitBulkIntake = async (e: React.FormEvent) => {
    e.preventDefault();

    const validItems = bulkRows.filter(
      r => r.productId && parseInt(r.quantity, 10) > 0
    );

    if (validItems.length === 0) {
      setStatusMessage({ type: 'error', text: 'Please fill in at least one product with a valid quantity (>0)' });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await api.post('/inventory/bulk-intake', { items: validItems });
      setStatusMessage({
        type: 'success',
        text: `✓ ${res.message || 'Bulk intake submitted successfully'}`,
      });
      setShowBulkModal(false);
      setBulkRows([{ productId: '', quantity: '', notes: '' }]);
      fetchInventory();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to process bulk intake' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Single Adjustment Handler
  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItem) return;

    const qty = parseInt(adjustQtyInput, 10);
    if (isNaN(qty) || qty < 0) {
      setStatusMessage({ type: 'error', text: 'Quantity must be a valid non-negative number' });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      await api.put(`/inventory/${adjustItem.productId}`, {
        quantityOnHand: qty,
        notes: adjustNotesInput,
      });

      setStatusMessage({
        type: 'success',
        text: `Inventory for ${adjustItem.productName} adjusted to ${qty} units.`,
      });

      setAdjustItem(null);
      fetchInventory();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to adjust inventory' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Unique projects derived from inventory
  const uniqueProjects = useMemo(() => {
    const map = new Map<string, string>();
    inventory.forEach(i => {
      if (i.projectName) {
        map.set(i.projectName, i.projectName);
      }
    });
    return Array.from(map.values()).sort();
  }, [inventory]);

  const filteredInventory = useMemo(() => {
    return inventory.filter(i => {
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesName = i.productName.toLowerCase().includes(query);
        const matchesId = i.productId.toLowerCase().includes(query);
        const matchesProject = i.projectName.toLowerCase().includes(query);
        if (!matchesName && !matchesId && !matchesProject) return false;
      }

      // Project filter
      if (selectedProject !== 'ALL' && i.projectName !== selectedProject) {
        return false;
      }

      // Stock level filter based on total organization inventory
      const totalAvailable = i.totalAvailable !== undefined ? i.totalAvailable : (i.quantityOnHand + (i.activeAllocatedQty || 0));

      if (stockLevelFilter === 'OUT_OF_STOCK' && totalAvailable > 0) return false;
      if (stockLevelFilter === 'LOW_STOCK' && (totalAvailable <= 0 || totalAvailable > 5)) return false;
      if (stockLevelFilter === 'IN_STOCK' && totalAvailable <= 5) return false;
      if (stockLevelFilter === 'DEPLOYED' && i.activeAllocatedQty <= 0) return false;

      return true;
    });
  }, [inventory, searchQuery, selectedProject, stockLevelFilter]);

  const totalMainStock = useMemo(() => inventory.reduce((sum, i) => sum + i.quantityOnHand, 0), [inventory]);
  const totalAllocated = useMemo(() => inventory.reduce((sum, i) => sum + i.activeAllocatedQty, 0), [inventory]);
  const totalOrgStock = useMemo(() => totalMainStock + totalAllocated, [totalMainStock, totalAllocated]);

  const hasActiveFilters = searchQuery.trim() !== '' || selectedProject !== 'ALL' || stockLevelFilter !== 'ALL';

  return (
    <div className="space-y-5 w-full max-w-[1600px] mx-auto pb-12">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/70 flex items-center justify-center font-black shadow-xs shrink-0">
            <Boxes className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Inventory
              </h1>
              <div
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  isConnected
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-500 border border-slate-200'
                }`}
                title={isConnected ? 'Live WebSocket connected' : 'Connecting WebSocket...'}
              >
                <Radio className={`w-3 h-3 ${isConnected ? 'animate-pulse text-emerald-500' : 'text-slate-400'}`} />
                <span>{isConnected ? 'Live Sync Active' : 'Connecting...'}</span>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time warehouse stock decremented automatically on stall sales and returned upon event conclusion.
            </p>
          </div>
        </div>

        {canEditInventory && (
          <button
            onClick={() => setShowBulkModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Bulk Stock Intake</span>
          </button>
        )}
      </div>

      {/* Metric Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Central Warehouse Stock
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 tracking-tight">
              {totalMainStock}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Available for stall allocation
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 border border-slate-200/60">
            <Warehouse className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Active Stall Stock
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-700 mt-1 tracking-tight">
              {totalAllocated}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Units deployed across live stalls
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200/60">
            <Store className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Total Organization Inventory
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 tracking-tight">
              {totalOrgStock}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Combined stock ({inventory.length} SKUs)
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 border border-slate-200/60">
            <Package className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Stock Distinction Note */}
      <div className="p-3.5 bg-slate-100/70 border border-slate-200/80 rounded-2xl flex items-start gap-2.5 text-xs text-slate-600">
        <Info className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-slate-900">Warehouse Stock vs. Stall Stock:</strong> Warehouse stock represents physical units located in central inventory available for deployment. Active Stall Stock represents units currently assigned to live event cashiers. When an event is marked concluded, all unsold stall units are automatically reconciled back into Warehouse Stock.
        </p>
      </div>

      {/* Notifications */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by product name, auto ID (e.g. TAH-001), or project..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Dropdown Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Project Filter */}
            <select
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              className="text-xs font-semibold bg-white border border-slate-300 rounded-xl py-2 px-3 text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
            >
              <option value="ALL">All Projects</option>
              {uniqueProjects.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            {/* Stock Level Filter */}
            <select
              value={stockLevelFilter}
              onChange={e => setStockLevelFilter(e.target.value as any)}
              className="text-xs font-semibold bg-white border border-slate-300 rounded-xl py-2 px-3 text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
            >
              <option value="ALL">All Stock Levels</option>
              <option value="IN_STOCK">In Stock (&gt;5)</option>
              <option value="LOW_STOCK">Low Stock (1–5)</option>
              <option value="DEPLOYED">Deployed at Stalls</option>
              <option value="OUT_OF_STOCK">Out of Stock (0)</option>
            </select>

            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedProject('ALL');
                  setStockLevelFilter('ALL');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors cursor-pointer"
                title="Reset search and filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div>
            Showing <strong className="text-slate-900">{filteredInventory.length}</strong> of{' '}
            <strong className="text-slate-900">{inventory.length}</strong> inventory products
          </div>
          {stockLevelFilter !== 'ALL' && (
            <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              Filtered by: {stockLevelFilter.replace('_', ' ')}
            </div>
          )}
        </div>
      </div>

      {/* Inventory Table Container */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[1150px] border-collapse">
            <thead className="bg-slate-50/90 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th scope="col" className="px-4 py-3.5 whitespace-nowrap w-[110px]">Auto ID</th>
                <th scope="col" className="px-4 py-3.5 min-w-[200px] max-w-[280px]">Product Name</th>
                <th scope="col" className="px-4 py-3.5 whitespace-nowrap w-[130px]">Project</th>
                <th scope="col" className="px-4 py-3.5 text-right whitespace-nowrap w-[140px]">Warehouse Stock</th>
                <th scope="col" className="px-4 py-3.5 text-right whitespace-nowrap w-[140px]">Active Stall Stock</th>
                <th scope="col" className="px-4 py-3.5 text-right whitespace-nowrap w-[140px]">Total Available</th>
                <th scope="col" className="px-4 py-3.5 text-right whitespace-nowrap w-[110px]">Ref Price (₹)</th>
                <th scope="col" className="px-4 py-3.5 min-w-[140px] max-w-[220px]">Batch Notes</th>
                <th scope="col" className="px-4 py-3.5 whitespace-nowrap w-[130px]">Last Updated</th>
                {canEditInventory && <th scope="col" className="px-4 py-3.5 text-center whitespace-nowrap w-[70px]">Adjust</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={canEditInventory ? 10 : 9} className="px-4 py-14 text-center text-slate-400">
                    <Boxes className="w-6 h-6 mx-auto mb-2 animate-bounce text-slate-400" />
                    <p className="font-medium text-slate-600">Loading live inventory...</p>
                  </td>
                </tr>
              ) : filteredInventory.length === 0 ? (
                <tr>
                  <td colSpan={canEditInventory ? 10 : 9} className="px-4 py-12 text-center">
                    <div className="max-w-sm mx-auto space-y-2">
                      <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-1">
                        <Search className="w-5 h-5" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">No matching inventory items</h3>
                      <p className="text-xs text-slate-500">
                        No products match your current search, project, or stock level criteria.
                      </p>
                      {hasActiveFilters && (
                        <div className="pt-2">
                          <button
                            onClick={() => {
                              setSearchQuery('');
                              setSelectedProject('ALL');
                              setStockLevelFilter('ALL');
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Reset Filters</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredInventory.map(item => {
                  const isRecent = item.productId === recentlyUpdatedId;

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors hover:bg-slate-50/70 ${
                        isRecent ? 'bg-amber-50/70' : ''
                      }`}
                    >
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200/80 text-xs inline-block tracking-tight whitespace-nowrap shadow-2xs">
                          {item.productId}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate-900 min-w-[200px] max-w-[280px]">
                        <div className="line-clamp-2 leading-snug" title={item.productName}>
                          {item.productName}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 whitespace-nowrap">
                        <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200/80 inline-block whitespace-nowrap">
                          {item.projectName}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap font-mono font-medium">
                        {item.quantityOnHand === 0 ? (
                          <span className="text-slate-400 font-semibold text-xs">0</span>
                        ) : (
                          <span className="font-bold text-slate-800 text-xs">
                            {item.quantityOnHand}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap font-mono font-medium">
                        {item.activeAllocatedQty > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 whitespace-nowrap font-mono">
                            {item.activeAllocatedQty}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-semibold text-xs">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap font-mono font-medium">
                        {item.totalAvailable === 0 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold text-red-700 bg-red-50 border border-red-200 whitespace-nowrap font-mono">
                            0 Out
                          </span>
                        ) : item.quantityOnHand === 0 && item.activeAllocatedQty > 0 ? (
                          <span
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 whitespace-nowrap font-mono"
                            title={`${item.activeAllocatedQty} units currently active at event stalls`}
                          >
                            {item.totalAvailable} Deployed
                          </span>
                        ) : item.totalAvailable <= 5 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 whitespace-nowrap font-mono">
                            {item.totalAvailable} Low
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold text-slate-800 bg-slate-100 border border-slate-200 whitespace-nowrap font-mono">
                            {item.totalAvailable}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap font-mono font-medium text-slate-900">
                        {item.basePrice !== null && item.basePrice !== undefined
                          ? `₹${Number(item.basePrice).toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3.5 text-slate-500 min-w-[140px] max-w-[220px]" title={item.notes || ''}>
                        <div className="truncate text-xs">
                          {item.notes || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-500 text-xs whitespace-nowrap">
                        <div className="font-medium text-slate-700 leading-tight">
                          {new Date(item.lastUpdated).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(item.lastUpdated).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </td>
                      {canEditInventory && (
                        <td className="px-4 py-3.5 text-center whitespace-nowrap">
                          <button
                            onClick={() => {
                              setAdjustItem(item);
                              setAdjustQtyInput(item.quantityOnHand.toString());
                              setAdjustNotesInput(item.notes || '');
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center"
                            title="Adjust stock count"
                            aria-label={`Adjust stock for ${item.productName}`}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Bulk Intake Form */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-3xl w-full p-6 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">Bulk Stock Intake</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Submit multiple products' initial/replenishment stock in one batch.
                </p>
              </div>
              <button
                onClick={() => setShowBulkModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitBulkIntake} className="flex-1 overflow-y-auto py-4 space-y-3">
              <div className="space-y-2">
                {bulkRows.map((row, index) => (
                  <div
                    key={index}
                    className="p-3 bg-slate-50/80 border border-slate-200/80 rounded-xl grid grid-cols-12 gap-2 items-center"
                  >
                    <div className="col-span-12 sm:col-span-5">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
                        Product
                      </label>
                      <select
                        required
                        value={row.productId}
                        onChange={e => handleBulkChange(index, 'productId', e.target.value)}
                        className="w-full text-xs p-2 border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                      >
                        <option value="">Select product...</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            [{p.id}] {p.name} ({p.project?.name})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-span-6 sm:col-span-3">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
                        Quantity To Add
                      </label>
                      <input
                        type="number"
                        min={1}
                        required
                        placeholder="e.g. 50"
                        value={row.quantity}
                        onChange={e => handleBulkChange(index, 'quantity', e.target.value)}
                        className="w-full text-xs p-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                      />
                    </div>

                    <div className="col-span-5 sm:col-span-3">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
                        Notes / Batch
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Fresh batch"
                        value={row.notes}
                        onChange={e => handleBulkChange(index, 'notes', e.target.value)}
                        className="w-full text-xs p-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                      />
                    </div>

                    <div className="col-span-1 pt-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveBulkRow(index)}
                        disabled={bulkRows.length <= 1}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg disabled:opacity-30 cursor-pointer transition-colors"
                        title="Remove row"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handleAddBulkRow}
                className="w-full py-2.5 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Another Product Row</span>
              </button>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Processing...' : 'Submit Bulk Intake'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Single Inventory Adjustment */}
      {adjustItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Adjust Stock Count</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {adjustItem.productName} ({adjustItem.productId})
                </p>
              </div>
              <button
                onClick={() => setAdjustItem(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAdjustment} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  New Quantity On Hand
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  value={adjustQtyInput}
                  onChange={e => setAdjustQtyInput(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Reason / Adjustment Notes
                </label>
                <textarea
                  rows={2}
                  value={adjustNotesInput}
                  onChange={e => setAdjustNotesInput(e.target.value)}
                  placeholder="e.g. Audit reconciliation, damaged unit correction"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAdjustItem(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Stock Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
