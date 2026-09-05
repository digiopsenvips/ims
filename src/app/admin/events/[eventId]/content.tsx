'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeftIcon, PlusIcon } from 'lucide-react';
import type { Event, EventProduct, Product, Tenure, User } from '@prisma/client';

import { setEventStatus, updateEvent, upsertEventProduct } from '@/actions/events';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  event: Event & {
    products: (EventProduct & { product: Product })[];
    tenure: Tenure | null;
    creator: User;
  };
  products: (Product & { project: { id: string; name: string; code: string } })[];
}

export default function EventDetailContent({ event: initialEvent, products }: Props) {
  const [event, setEvent] = useState(initialEvent);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: initialEvent.name,
    eventCode: initialEvent.eventCode,
    location: initialEvent.location,
    startDate: initialEvent.startDate.toISOString().slice(0, 10),
    endDate: initialEvent.endDate ? initialEvent.endDate.toISOString().slice(0, 10) : '',
    startTime: initialEvent.startTime ?? '',
    endTime: initialEvent.endTime ?? '',
    notes: initialEvent.notes ?? '',
  });
  const [allocationForm, setAllocationForm] = useState({
    productId: products[0]?.id ?? '',
    allocatedQuantity: 0,
    eventPrice: 0,
  });

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await updateEvent({
        id: event.id,
        name: form.name.trim(),
        eventCode: form.eventCode.trim(),
        location: form.location.trim(),
        startDate: form.startDate,
        endDate: form.endDate || null,
        startTime: form.startTime || null,
        endTime: form.endTime || null,
        notes: form.notes.trim() || null,
      });

      setEvent({ ...event, ...updated });
      setEditMode(false);
      setSuccess('Event updated successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED') => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await setEventStatus(event.id, status);
      setEvent({ ...event, status: updated.status });
      setSuccess(`Event status updated to ${status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event status');
    } finally {
      setLoading(false);
    }
  };

  const handleAllocation = async () => {
    if (!allocationForm.productId) {
      setError('Select a product before assigning inventory.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await upsertEventProduct({
        eventId: event.id,
        productId: allocationForm.productId,
        allocatedQuantity: Number(allocationForm.allocatedQuantity),
        eventPrice: Number(allocationForm.eventPrice),
      });

      const product = products.find((item) => item.id === allocationForm.productId);
      setEvent({
        ...event,
        products: event.products.some((item) => item.productId === updated.productId)
          ? event.products.map((item) =>
              item.productId === updated.productId ? { ...item, allocatedQuantity: updated.allocatedQuantity, eventPrice: updated.eventPrice } : item,
            )
          : [...event.products, { ...updated, product: product ?? event.products[0]?.product }],
      });
      setSuccess('Event inventory updated successfully.');
      setAllocationForm({ productId: products[0]?.id ?? '', allocatedQuantity: 0, eventPrice: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event inventory');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/admin/events" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ChevronLeftIcon className="h-4 w-4" />
          Back to Events
        </Link>

        <Link
          href={`/admin/events/${event.id}/reconcile`}
          className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Reconcile Stock
        </Link>
      </div>

      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{event.name}</h1>
          <p className="mt-1 text-sm text-slate-600">{event.eventCode} • {event.location}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={event.status}
            onChange={(e) => handleStatusChange(e.target.value as 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED')}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          >
            <option value="DRAFT">DRAFT</option>
            <option value="SCHEDULED">SCHEDULED</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
          {editMode ? (
            <>
              <Button variant="outline" onClick={() => setEditMode(false)} disabled={loading}>Cancel</Button>
              <Button onClick={handleSave} disabled={loading}>{loading ? 'Saving...' : 'Save'}</Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setEditMode(true)} disabled={loading}>Edit</Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {success && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{success}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {editMode ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Event Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Event Code</label>
                <Input value={form.eventCode} onChange={(e) => setForm({ ...form, eventCode: e.target.value.toUpperCase() })} className="mt-1 font-mono uppercase" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Location</label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="mt-1" />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Start Date</label>
                  <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">End Date</label>
                  <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="mt-1" />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Start Time</label>
                  <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">End Time</label>
                  <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="mt-1" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400" />
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-sm text-slate-600">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Event details</p>
                <div className="mt-3 space-y-3">
                  <p><span className="font-medium text-slate-800">Location:</span> {event.location}</p>
                  <p><span className="font-medium text-slate-800">Date:</span> {new Date(event.startDate).toLocaleDateString()} {event.endDate ? `— ${new Date(event.endDate).toLocaleDateString()}` : ''}</p>
                  <p><span className="font-medium text-slate-800">Timing:</span> {event.startTime ?? 'N/A'} {event.endTime ? `to ${event.endTime}` : ''}</p>
                  <p><span className="font-medium text-slate-800">Created by:</span> {event.creator.name}</p>
                  {event.tenure && <p><span className="font-medium text-slate-800">Tenure:</span> {event.tenure.name}</p>}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Notes</p>
                <p className="mt-3 whitespace-pre-wrap text-slate-700">{event.notes || 'No notes provided.'}</p>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Assign inventory</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Product</label>
              <select value={allocationForm.productId} onChange={(e) => setAllocationForm({ ...allocationForm, productId: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400">
                <option value="">Select a product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.project.name} - {product.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">Allocated quantity</label>
                <Input type="number" min="0" value={allocationForm.allocatedQuantity} onChange={(e) => setAllocationForm({ ...allocationForm, allocatedQuantity: Number(e.target.value) })} className="mt-1" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Event price</label>
                <Input type="number" min="0" step="0.01" value={allocationForm.eventPrice} onChange={(e) => setAllocationForm({ ...allocationForm, eventPrice: Number(e.target.value) })} className="mt-1" />
              </div>
            </div>

            <Button className="w-full gap-2" onClick={handleAllocation} disabled={loading}>
              <PlusIcon className="h-4 w-4" />
              {loading ? 'Saving...' : 'Assign to event'}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold">Allocated products</h2>
        </div>

        {event.products.length === 0 ? (
          <div className="p-6 text-sm text-slate-600">No products have been assigned to this event yet.</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {event.products.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-2 p-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium text-slate-900">{entry.product.name}</p>
                  <p className="text-sm text-slate-500 font-mono">{entry.product.productCode}</p>
                </div>
                <div className="flex items-center gap-6 text-sm text-slate-600">
                  <span><span className="font-medium text-slate-800">Qty:</span> {entry.allocatedQuantity}</span>
                  <span><span className="font-medium text-slate-800">Price:</span> ₹{Number(entry.eventPrice).toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
