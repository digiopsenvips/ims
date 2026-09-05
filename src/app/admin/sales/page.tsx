import Link from 'next/link';
import { redirect } from 'next/navigation';

import { cancelSaleAction, getSalesForManagement } from '@/actions/sales';
import { requireRole } from '@/lib/authz';

export default async function AdminSalesPage() {
  const user = await requireRole(['DEVELOPER', 'ADMIN', 'HEAD']);

  if (!user) {
    redirect('/login');
  }

  const sales = await getSalesForManagement();

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Sales</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sales management</h1>
            </div>
            <Link
              href="/admin"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Back to admin
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Recent sales</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{sales.length} records</span>
          </div>

          {sales.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
              No sales have been recorded yet.
            </div>
          ) : (
            <div className="space-y-4">
              {sales.map((sale) => (
                <div key={sale.id} className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{sale.transactionCode}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            sale.status === 'CANCELLED'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {sale.status}
                        </span>
                      </div>

                      <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-3">
                        <p>
                          <span className="font-medium text-slate-900">Member:</span> {sale.member.name} ({sale.member.username})
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Event:</span> {sale.event?.name ?? 'No event'}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Payment:</span> {sale.paymentMethod}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Customer:</span> {sale.customerName ?? 'N/A'}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Phone:</span> {sale.customerPhone ?? 'N/A'}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Time:</span> {new Date(sale.saleTime).toLocaleString()}
                        </p>
                      </div>

                      <div className="mt-3 space-y-2">
                        {sale.saleItems.map((item) => (
                          <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                            <div>
                              <span className="font-medium text-slate-800">{item.product.name}</span>
                              <span className="ml-2 text-slate-500">({item.product.productCode})</span>
                            </div>
                            <div className="text-right text-slate-600">
                              <div>{item.quantity} × ₹{item.unitPrice}</div>
                              <div className="font-medium text-slate-900">₹{item.lineTotal}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="min-w-[150px] text-left lg:text-right">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-900">₹{sale.totalAmount}</p>

                      {sale.status !== 'CANCELLED' && (
                        <form action={cancelSaleAction} className="mt-4">
                          <input type="hidden" name="saleId" value={sale.id} />
                          <button
                            type="submit"
                            className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
                          >
                            Cancel sale
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
