'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronLeftIcon } from 'lucide-react';

import { createEvent } from '@/actions/events';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function NewEventPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    eventCode: '',
    location: '',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const newEvent = await createEvent({
        ...form,
        startDate: form.startDate || new Date().toISOString(),
        endDate: form.endDate || null,
        startTime: form.startTime || null,
        endTime: form.endTime || null,
        notes: form.notes || null,
        status: 'DRAFT',
      });

      router.push(`/admin/events/${newEvent.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/events" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to Events
      </Link>

      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Create Event</h1>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-slate-700">Event Name *</label>
          <Input value={form.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="e.g., DU Fest" required disabled={loading} className="mt-1" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Event Code *</label>
          <Input value={form.eventCode} onChange={(e) => handleChange('eventCode', e.target.value.toUpperCase())} placeholder="e.g., DU-FEST-001" required disabled={loading} className="mt-1 font-mono uppercase" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Location *</label>
          <Input value={form.location} onChange={(e) => handleChange('location', e.target.value)} placeholder="e.g., VIPS Campus" required disabled={loading} className="mt-1" />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700">Start Date *</label>
            <Input type="date" value={form.startDate} onChange={(e) => handleChange('startDate', e.target.value)} required disabled={loading} className="mt-1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">End Date</label>
            <Input type="date" value={form.endDate} onChange={(e) => handleChange('endDate', e.target.value)} disabled={loading} className="mt-1" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700">Start Time</label>
            <Input type="time" value={form.startTime} onChange={(e) => handleChange('startTime', e.target.value)} disabled={loading} className="mt-1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">End Time</label>
            <Input type="time" value={form.endTime} onChange={(e) => handleChange('endTime', e.target.value)} disabled={loading} className="mt-1" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            rows={4}
            disabled={loading}
            placeholder="Optional event notes"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400"
          />
        </div>

        <div className="flex gap-3 pt-4">
          <Link href="/admin/events" className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50">
            Cancel
          </Link>
          <Button type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create Event'}</Button>
        </div>
      </form>
    </div>
  );
}
