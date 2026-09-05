import Link from 'next/link';
import { PlusIcon } from 'lucide-react';

import { getAllEvents } from '@/actions/events';
import { Button } from '@/components/ui/button';
import { requireRole } from '@/lib/authz';

export default async function EventsPage() {
  await requireRole(['DEVELOPER', 'ADMIN']);

  const events = await getAllEvents();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Events</h1>
          <p className="mt-1 text-sm text-slate-600">{events.length} events in the system</p>
        </div>
        <Link href="/admin/events/new">
          <Button className="gap-2">
            <PlusIcon className="h-4 w-4" />
            New Event
          </Button>
        </Link>
      </div>

      <div className="space-y-3">
        {events.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-12 text-center">
            <p className="text-slate-600">No events yet. Create your first event to get started.</p>
          </div>
        ) : (
          events.map((event) => (
            <Link key={event.id} href={`/admin/events/${event.id}`}>
              <div className="cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
                <div className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-lg font-semibold">{event.name}</h2>
                      <span className="inline-block rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-medium text-slate-700">
                        {event.eventCode}
                      </span>
                      <span className="inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                        {event.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{event.location}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(event.startDate).toLocaleDateString()} {event.startTime ? `• ${event.startTime}` : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-semibold">{event.products.length}</div>
                    <div className="text-xs text-slate-500">product allocations</div>
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
