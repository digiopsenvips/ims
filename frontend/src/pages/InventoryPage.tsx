import React, { useState, useEffect } from 'react';
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
  RefreshCw,
  X,
  Edit2,
  Radio,
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
      if (prodRes?.products) setProducts(prodRes.products);
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

  const filteredInventory = inventory.filter(
    i =>
      i.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.productId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.projectName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalMainStock = inventory.reduce((sum, i) => sum + i.quantityOnHand, 0);
  const totalAllocated = inventory.reduce((sum, i) => sum + i.activeAllocatedQty, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Boxes className="w-5 h-5 text-amber-600" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Inventory Management
            </h1>
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                isConnected
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-slate-100 text-slate-500'
              }`}
              title={isConnected ? 'Live WebSocket connected' : 'Connecting WebSocket...'}
            >
              <Radio className={`w-3 h-3 ${isConnected ? 'animate-pulse' : ''}`} />
              <span>{isConnected ? 'Live Sync Active' : 'Connecting'}</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time stock on hand decremented automatically on sales and returned when events end.
          </p>
        </div>

        {canEditInventory && (
          <button
            onClick={() => setShowBulkModal(true)}
            className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Bulk Stock Intake</span>
          </button>
        )}
      </div>

      {/* Metric Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Total Main Stock (Live)
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1">{totalMainStock}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Units ready for allocation</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Active Event Allocations
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1">{totalAllocated}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Units deployed at live stalls</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Catalogued SKUs
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1">{inventory.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Across all active projects</div>
        </div>
      </div>

      {/* Notifications */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-md text-xs flex items-center justify-between border ${
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

      {/* Search Filter */}
      <div className="flex items-center justify-between gap-4">
        <input
          type="text"
          placeholder="Filter by product name, auto ID (e.g. TAH-001), or project..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="max-w-md w-full text-xs p-2.5 border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
        />
        <div className="text-xs text-slate-500 font-medium">
          Showing {filteredInventory.length} of {inventory.length} products
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Auto ID</th>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3 text-right">Live Stock On Hand</th>
                <th className="px-4 py-3 text-right">Active Stall Stock</th>
                <th className="px-4 py-3 text-right">Ref Price (₹)</th>
                <th className="px-4 py-3">Batch Notes</th>
                <th className="px-4 py-3">Last Updated</th>
                {canEditInventory && <th className="px-4 py-3 text-center">Adjust</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInventory.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    No matching inventory items found.
                  </td>
                </tr>
              ) : (
                filteredInventory.map(item => {
                  const isRecent = item.productId === recentlyUpdatedId;

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isRecent ? 'bg-amber-50/70' : 'hover:bg-slate-50/50'
                      }`}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-slate-900">
                        {item.productId}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {item.productName}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 border border-slate-200">
                          {item.projectName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-black text-sm px-2 py-0.5 rounded ${
                            item.quantityOnHand <= 5
                              ? 'text-red-700 bg-red-50 border border-red-200'
                              : 'text-slate-900'
                          }`}
                        >
                          {item.quantityOnHand}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-600">
                        {item.activeAllocatedQty}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {item.basePrice !== null && item.basePrice !== undefined
                          ? `₹${Number(item.basePrice).toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                        {item.notes || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-[11px] whitespace-nowrap">
                        {new Date(item.lastUpdated).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        {new Date(item.lastUpdated).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      {canEditInventory && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => {
                              setAdjustItem(item);
                              setAdjustQtyInput(item.quantityOnHand.toString());
                              setAdjustNotesInput(item.notes || '');
                            }}
                            className="p-1 text-slate-500 hover:text-slate-900 rounded transition-colors cursor-pointer"
                            title="Adjust stock count"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-lg max-w-3xl w-full p-6 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">Bulk Stock Intake</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Submit multiple products' initial/replenishment stock in one batch.
                </p>
              </div>
              <button
                onClick={() => setShowBulkModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitBulkIntake} className="flex-1 overflow-y-auto py-4 space-y-3">
              <div className="space-y-2">
                {bulkRows.map((row, index) => (
                  <div
                    key={index}
                    className="p-3 bg-slate-50 border border-slate-200 rounded-md grid grid-cols-12 gap-2 items-center"
                  >
                    <div className="col-span-5">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
                        Product
                      </label>
                      <select
                        required
                        value={row.productId}
                        onChange={e => handleBulkChange(index, 'productId', e.target.value)}
                        className="w-full text-xs p-2 border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                      >
                        <option value="">Select product...</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            [{p.id}] {p.name} ({p.project?.name})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-span-3">
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
                        className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                      />
                    </div>

                    <div className="col-span-3">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
                        Notes / Batch
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Fresh production batch"
                        value={row.notes}
                        onChange={e => handleBulkChange(index, 'notes', e.target.value)}
                        className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                      />
                    </div>

                    <div className="col-span-1 pt-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveBulkRow(index)}
                        disabled={bulkRows.length <= 1}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded disabled:opacity-30 cursor-pointer"
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
                className="w-full py-2.5 border border-dashed border-slate-300 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Another Product Row</span>
              </button>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer shadow-sm"
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Adjust Stock Count</h3>
                <p className="text-xs text-slate-500 mt-0.5">{adjustItem.productName} ({adjustItem.productId})</p>
              </div>
              <button
                onClick={() => setAdjustItem(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
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
                  className="w-full text-xs p-2.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
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
                  className="w-full text-xs p-2.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAdjustItem(null)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer shadow-sm"
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
