import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { AppEvent, Product, EventStatus } from '../types';
import {
  Calendar,
  Plus,
  Edit,
  PowerOff,
  AlertCircle,
  CheckCircle2,
  Clock,
  MapPin,
  Package,
  X,
  ArrowDownLeft,
} from 'lucide-react';

interface AllocationInput {
  productId: string;
  productName: string;
  projectName: string;
  availableStock: number;
  allocatedQty: number;
  priceAtEvent: number;
}

export const EventsPage: React.FC = () => {
  const { isDeveloper, isAdmin, hasPermission } = useAuth();
  const { socket } = useSocket();

  const [events, setEvents] = useState<AppEvent[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create / Edit Modal State
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [startDateInput, setStartDateInput] = useState('');
  const [startTimeInput, setStartTimeInput] = useState('09:00');
  const [endDateInput, setEndDateInput] = useState('');
  const [endTimeInput, setEndTimeInput] = useState('18:00');
  const [eventStatusInput, setEventStatusInput] = useState<EventStatus>('ACTIVE');
  const [allocationsGrid, setAllocationsGrid] = useState<AllocationInput[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // End Event Modal State
  const [endEventTarget, setEndEventTarget] = useState<AppEvent | null>(null);
  const [isEndingEvent, setIsEndingEvent] = useState(false);

  const canEditEvents = isDeveloper || isAdmin || hasPermission('edit_events');

  const fetchEventsAndProducts = async () => {
    try {
      const [evRes, prodRes] = await Promise.all([
        api.get('/events'),
        api.get('/products'),
      ]);
      if (evRes?.events) setEvents(evRes.events);
      if (prodRes?.products) setProducts(prodRes.products);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to load events data' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEventsAndProducts();
  }, []);

  // WebSocket event listeners
  useEffect(() => {
    if (!socket) return;
    socket.on('event:updated', fetchEventsAndProducts);
    socket.on('sale:created', fetchEventsAndProducts);

    return () => {
      socket.off('event:updated', fetchEventsAndProducts);
      socket.off('sale:created', fetchEventsAndProducts);
    };
  }, [socket]);

  // Open Create Event Modal
  const handleOpenCreateModal = () => {
    setEditingEventId(null);
    setNameInput('');
    setLocationInput('');

    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    setStartDateInput(todayStr);
    setStartTimeInput('10:00');
    setEndDateInput(tomorrowStr);
    setEndTimeInput('20:00');
    setEventStatusInput('ACTIVE');

    // Build allocations grid with all products
    const initialGrid: AllocationInput[] = products.map(p => ({
      productId: p.id,
      productName: p.name,
      projectName: p.project?.name || '—',
      availableStock: p.inventory ? p.inventory.quantityOnHand : 0,
      allocatedQty: 0,
      priceAtEvent: p.basePrice ? Number(p.basePrice) : 0,
    }));

    setAllocationsGrid(initialGrid);
    setShowEventModal(true);
  };

  // Open Edit Event Modal
  const handleOpenEditModal = (event: AppEvent) => {
    setEditingEventId(event.id);
    setNameInput(event.name);
    setLocationInput(event.location);

    const start = new Date(event.startDatetime);
    const end = new Date(event.endDatetime);

    setStartDateInput(start.toISOString().split('T')[0]);
    setStartTimeInput(start.toTimeString().slice(0, 5));
    setEndDateInput(end.toISOString().split('T')[0]);
    setEndTimeInput(end.toTimeString().slice(0, 5));
    setEventStatusInput(event.status);

    // Map existing allocations
    const grid: AllocationInput[] = products.map(p => {
      const existingAlloc = event.allocations.find(a => a.productId === p.id);
      return {
        productId: p.id,
        productName: p.name,
        projectName: p.project?.name || '—',
        availableStock: (p.inventory ? p.inventory.quantityOnHand : 0) + (existingAlloc ? existingAlloc.allocatedQty : 0),
        allocatedQty: existingAlloc ? existingAlloc.allocatedQty : 0,
        priceAtEvent: existingAlloc ? Number(existingAlloc.priceAtEvent) : p.basePrice ? Number(p.basePrice) : 0,
      };
    });

    setAllocationsGrid(grid);
    setShowEventModal(true);
  };

  const handleAllocationChange = (
    productId: string,
    field: 'allocatedQty' | 'priceAtEvent',
    val: number
  ) => {
    setAllocationsGrid(prev =>
      prev.map(row => {
        if (row.productId !== productId) return row;
        return {
          ...row,
          [field]: val,
        };
      })
    );
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim() || !locationInput.trim() || !startDateInput || !endDateInput) {
      setStatusMessage({ type: 'error', text: 'Please fill in all event details' });
      return;
    }

    const startDatetime = new Date(`${startDateInput}T${startTimeInput || '00:00'}:00`).toISOString();
    const endDatetime = new Date(`${endDateInput}T${endTimeInput || '23:59'}:00`).toISOString();

    // Check allocations against available stock
    for (const row of allocationsGrid) {
      if (row.allocatedQty > row.availableStock) {
        setStatusMessage({
          type: 'error',
          text: `Allocation for ${row.productName} (${row.allocatedQty}) exceeds available main stock (${row.availableStock}).`,
        });
        return;
      }
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const payload = {
        name: nameInput,
        location: locationInput,
        startDatetime,
        endDatetime,
        status: eventStatusInput,
        allocations: allocationsGrid.map(a => ({
          productId: a.productId,
          allocatedQty: a.allocatedQty,
          priceAtEvent: a.priceAtEvent,
        })),
      };

      if (editingEventId) {
        await api.put(`/events/${editingEventId}`, payload);
        setStatusMessage({ type: 'success', text: `Event '${nameInput}' updated successfully.` });
      } else {
        await api.post('/events', payload);
        setStatusMessage({ type: 'success', text: `Event '${nameInput}' created with stock allocations!` });
      }

      setShowEventModal(false);
      fetchEventsAndProducts();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to save event' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirm End Event
  const handleConfirmEndEvent = async () => {
    if (!endEventTarget) return;

    setIsEndingEvent(true);
    setStatusMessage(null);

    try {
      const res = await api.post(`/events/${endEventTarget.id}/end`);
      setStatusMessage({
        type: 'success',
        text: `✓ ${res.message || 'Event ended and unsold stock returned to main inventory'}`,
      });
      setEndEventTarget(null);
      fetchEventsAndProducts();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to end event' });
    } finally {
      setIsEndingEvent(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Events & Stock Allocations
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure pop-up stalls, per-event allocations and pricing, and finalize events with auto stock returns.
          </p>
        </div>

        {canEditEvents && (
          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Event</span>
          </button>
        )}
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

      {/* Events List */}
      <div className="space-y-4">
        {events.length === 0 ? (
          <div className="bg-white p-8 rounded-lg border border-slate-200 text-center text-xs text-slate-500">
            No events found. Click "Create New Event" to schedule a stall.
          </div>
        ) : (
          events.map(event => {
            const isEnded = event.status === 'ENDED';
            const isActive = event.status === 'ACTIVE';

            return (
              <div
                key={event.id}
                className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden"
              >
                {/* Event Summary Bar */}
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : isEnded
                            ? 'bg-slate-100 text-slate-600 border border-slate-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}
                      >
                        {event.status}
                      </span>
                      <h2 className="text-base font-bold text-slate-900">{event.name}</h2>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-0.5">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span>{event.location}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {new Date(event.startDatetime).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}{' '}
                          to{' '}
                          {new Date(event.endDatetime).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Actions & Metrics */}
                  <div className="flex items-center gap-4">
                    <div className="text-right hidden sm:block">
                      <div className="text-[10px] uppercase font-semibold text-slate-400">
                        Units (Sold / Alloc)
                      </div>
                      <div className="text-sm font-bold text-slate-800">
                        {event.totalSold} / {event.totalAllocated}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {canEditEvents && !isEnded && (
                        <>
                          <button
                            onClick={() => handleOpenEditModal(event)}
                            className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <Edit className="w-3.5 h-3.5" />
                            <span>Edit / Price</span>
                          </button>

                          <button
                            onClick={() => setEndEventTarget(event)}
                            className="px-3 py-1.5 text-xs font-semibold rounded bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition-colors flex items-center gap-1 cursor-pointer"
                            title="Close event and return unsold stock"
                          >
                            <PowerOff className="w-3.5 h-3.5" />
                            <span>End Event</span>
                          </button>
                        </>
                      )}

                      {isEnded && (
                        <span className="text-xs font-semibold text-slate-400 px-3 py-1 bg-slate-50 border border-slate-200 rounded">
                          Finalized
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Inline Product Allocations Sub-table */}
                <div className="bg-slate-50/50 p-4">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Event Inventory Breakdown & Pricing
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs bg-white border border-slate-200 rounded">
                      <thead className="bg-slate-100 text-slate-500 font-semibold uppercase text-[10px]">
                        <tr>
                          <th className="px-3 py-2">ID</th>
                          <th className="px-3 py-2">Product</th>
                          <th className="px-3 py-2">Project</th>
                          <th className="px-3 py-2 text-right">Event Price (₹)</th>
                          <th className="px-3 py-2 text-right">Allocated</th>
                          <th className="px-3 py-2 text-right">Sold</th>
                          <th className="px-3 py-2 text-right">Remaining</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {event.allocations.map(alloc => (
                          <tr key={alloc.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono font-medium text-slate-700">
                              {alloc.productId}
                            </td>
                            <td className="px-3 py-2 font-semibold text-slate-900">
                              {alloc.productName}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {alloc.projectName}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900">
                              ₹{Number(alloc.priceAtEvent).toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700 font-medium">
                              {alloc.allocatedQty}
                            </td>
                            <td className="px-3 py-2 text-right text-emerald-700 font-bold">
                              {alloc.soldQty}
                            </td>
                            <td className="px-3 py-2 text-right font-black text-slate-900">
                              {alloc.remainingQty}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Create / Edit Event with Inline Allocations & Pricing */}
      {showEventModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-4xl w-full p-6 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {editingEventId ? 'Edit Event & Adjust Pricing' : 'Create Event & Allocate Inventory'}
              </h3>
              <button
                onClick={() => setShowEventModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEvent} className="flex-1 overflow-y-auto py-4 space-y-4">
              {/* Event Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Event / Stall Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. VIPS Annual Cultural Fest 2026"
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Location / Venue
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Main Auditorium Lawn"
                    value={locationInput}
                    onChange={e => setLocationInput(e.target.value)}
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      required
                      value={startDateInput}
                      onChange={e => setStartDateInput(e.target.value)}
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={startTimeInput}
                      onChange={e => setStartTimeInput(e.target.value)}
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      required
                      value={endDateInput}
                      onChange={e => setEndDateInput(e.target.value)}
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      End Time
                    </label>
                    <input
                      type="time"
                      value={endTimeInput}
                      onChange={e => setEndTimeInput(e.target.value)}
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Inline Product Allocation & Pricing Table */}
              <div className="pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Product Allocations & Event-Specific Pricing
                  </h4>
                  <span className="text-[11px] text-slate-500">
                    Allocations deduct from main inventory; returned when ended.
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-md">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-[10px]">
                      <tr>
                        <th className="px-3 py-2.5">Auto ID</th>
                        <th className="px-3 py-2.5">Product Name</th>
                        <th className="px-3 py-2.5">Project</th>
                        <th className="px-3 py-2.5 text-right">Available Stock</th>
                        <th className="px-3 py-2.5 w-36 text-right">Quantity Allocated</th>
                        <th className="px-3 py-2.5 w-36 text-right">Price at Event (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allocationsGrid.map(row => (
                        <tr key={row.productId} className="hover:bg-slate-50/70">
                          <td className="px-3 py-2 font-mono font-semibold text-slate-800">
                            {row.productId}
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-900">
                            {row.productName}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{row.projectName}</td>
                          <td className="px-3 py-2 text-right font-medium text-slate-700">
                            {row.availableStock}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              max={row.availableStock}
                              value={row.allocatedQty}
                              onChange={e =>
                                handleAllocationChange(
                                  row.productId,
                                  'allocatedQty',
                                  parseInt(e.target.value, 10) || 0
                                )
                              }
                              className="w-24 text-right p-1.5 border border-slate-300 rounded font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              value={row.priceAtEvent}
                              onChange={e =>
                                handleAllocationChange(
                                  row.productId,
                                  'priceAtEvent',
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-24 text-right p-1.5 border border-slate-300 rounded font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEventModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer shadow-sm"
                >
                  {isSubmitting ? 'Saving Event...' : 'Save & Allocate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm End Event (Returns Unsold Stock) */}
      {endEventTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                <PowerOff className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">End Event: {endEventTarget.name}</h3>
                <p className="text-xs text-slate-500">Unsold stock will be restored to main inventory</p>
              </div>
            </div>

            <div className="py-4 space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Closing this event will finalize its status as <span className="font-semibold text-slate-800">ENDED</span>. All remaining allocated stock listed below will be automatically returned to main inventory:
              </p>

              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded p-2 bg-slate-50">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] text-slate-400 uppercase font-semibold">
                    <tr>
                      <th className="pb-1">Product</th>
                      <th className="pb-1 text-right">Allocated</th>
                      <th className="pb-1 text-right">Sold</th>
                      <th className="pb-1 text-right text-emerald-700 font-bold">Unsold (To Return)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {endEventTarget.allocations.map(a => (
                      <tr key={a.id}>
                        <td className="py-1 font-medium text-slate-800">{a.productName}</td>
                        <td className="py-1 text-right text-slate-500">{a.allocatedQty}</td>
                        <td className="py-1 text-right text-slate-500">{a.soldQty}</td>
                        <td className="py-1 text-right font-black text-emerald-700">
                          +{a.remainingQty}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEndEventTarget(null)}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isEndingEvent}
                onClick={handleConfirmEndEvent}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-md cursor-pointer shadow-sm"
              >
                {isEndingEvent ? 'Finalizing...' : 'Confirm & Return Stock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
