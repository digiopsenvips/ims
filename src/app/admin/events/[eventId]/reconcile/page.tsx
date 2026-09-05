import Link from 'next/link';
import { ArrowLeftIcon } from 'lucide-react';

import { getEventById, getEventReconciliationSnapshot, saveEventReconciliationAction } from '@/actions/events';

interface Props {
  params: {
    eventId: string;
  };
}

export default async function EventReconciliationPage({ params }: Props) {
  const event = await getEventById(params.eventId);
  const rows = await getEventReconciliationSnapshot(params.eventId);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Link href={`/admin/events/${event.id}`} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeftIcon className="h-4 w-4" />
            Back to event
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Event reconciliation</h1>
          <p className="mt-1 text-sm text-slate-600">{event.name} • {event.eventCode}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          No products are allocated to this event yet. Add stock allocation before reconciling.
        </div>
      ) : (
        <div className="space-y-6">
          {rows.map((row) => {
            const varianceLabel = row.difference === 0 ? 'Balanced' : row.difference > 0 ? 'Surplus' : 'Shortfall';

            return (
              <form
                key={row.productId}
                action={saveEventReconciliationAction}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{row.productCode}</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-900">{row.productName}</h2>
                  </div>
                  <div
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                      row.difference === 0
                        ? 'bg-emerald-100 text-emerald-700'
                        : row.difference > 0
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {varianceLabel}: {row.difference} units
                  </div>
                </div>

                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="productId" value={row.productId} />

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <label className="space-y-2 text-sm text-slate-700">
                    <span>Allocated</span>
                    <input name="allocatedQuantity" type="number" min="0" defaultValue={row.allocatedQuantity} className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none focus:border-slate-400" />
                  </label>
                  <label className="space-y-2 text-sm text-slate-700">
                    <span>Sold</span>
                    <input name="soldQuantity" type="number" min="0" defaultValue={row.soldQuantity} className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none focus:border-slate-400" />
                  </label>
                  <label className="space-y-2 text-sm text-slate-700">
                    <span>Returned</span>
                    <input name="returnedQuantity" type="number" min="0" defaultValue={row.returnedQuantity} className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none focus:border-slate-400" />
                  </label>
                  <label className="space-y-2 text-sm text-slate-700">
                    <span>Damaged</span>
                    <input name="damagedQuantity" type="number" min="0" defaultValue={row.damagedQuantity} className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none focus:border-slate-400" />
                  </label>
                  <label className="space-y-2 text-sm text-slate-700">
                    <span>Lost</span>
                    <input name="lostQuantity" type="number" min="0" defaultValue={row.lostQuantity} className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none focus:border-slate-400" />
                  </label>
                </div>

                <div className="mt-4 space-y-2">
                  <label className="block text-sm text-slate-700">
                    <span>Notes</span>
                    <textarea name="notes" defaultValue={row.notes ?? ''} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none focus:border-slate-400" placeholder="Add reconciliation notes" />
                  </label>
                </div>

                <div className="mt-5 flex justify-end">
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                  >
                    Save reconciliation
                  </button>
                </div>
              </form>
            );
          })}
        </div>
      )}
    </main>
  );
}
