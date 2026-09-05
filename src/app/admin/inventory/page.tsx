import Link from 'next/link';

import { adjustInventory, getInventoryOverview } from '@/actions/inventory';
import { requireRole } from '@/lib/authz';
import { Button } from '@/components/ui/button';

export default async function InventoryPage() {
  await requireRole(['DEVELOPER', 'ADMIN']);

  const inventory = await getInventoryOverview();

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Inventory</h1>
            <p className="mt-1 text-sm text-slate-600">Live stock levels and movement history from PostgreSQL.</p>
          </div>
          <Link href="/admin">
            <Button variant="outline">Back to admin</Button>
          </Link>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Inventory adjustment</h2>
          <p className="mt-1 text-sm text-slate-600">Add or remove stock for any product. Every update is stored as a real inventory transaction.</p>

          <form action={adjustInventory} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2 xl:col-span-2">
              <label htmlFor="productId" className="text-sm font-medium text-slate-700">Product</label>
              <select
                id="productId"
                name="productId"
                required
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-400"
              >
                <option value="">Select a product</option>
                {inventory.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.project.name} - {item.name} ({item.productCode})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="mode" className="text-sm font-medium text-slate-700">Action</label>
              <select
                id="mode"
                name="mode"
                defaultValue="ADD"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-400"
              >
                <option value="ADD">Add stock</option>
                <option value="REMOVE">Remove stock</option>
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="quantity" className="text-sm font-medium text-slate-700">Quantity</label>
              <input
                id="quantity"
                name="quantity"
                type="number"
                min="1"
                step="1"
                required
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              />
            </div>

            <div className="flex items-end xl:col-span-1">
              <Button type="submit" className="w-full">Apply</Button>
            </div>

            <div className="space-y-2 xl:col-span-5">
              <label htmlFor="notes" className="text-sm font-medium text-slate-700">Notes</label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                placeholder="Optional notes for this stock movement"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              />
            </div>
          </form>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold">Current stock</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Product</th>
                  <th className="px-6 py-3 font-medium">Project</th>
                  <th className="px-6 py-3 font-medium">Code</th>
                  <th className="px-6 py-3 font-medium">Current stock</th>
                  <th className="px-6 py-3 font-medium">Latest movement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {inventory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-600">
                      No products available to track yet.
                    </td>
                  </tr>
                ) : (
                  inventory.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900">{item.name}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">{item.project.name}</td>
                      <td className="px-6 py-4 text-sm font-mono text-slate-700">{item.productCode}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-sm font-semibold ${
                            item.currentStock <= 10 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {item.currentStock}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {item.latestMovement ? (
                          <>
                            <div className="font-medium text-slate-800">{item.latestMovement.transactionType}</div>
                            <div>{new Date(item.latestMovement.createdAt).toLocaleString()}</div>
                          </>
                        ) : (
                          'No movement recorded'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
