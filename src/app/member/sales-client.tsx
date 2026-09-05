'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { createMemberSale } from '@/actions/sales';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listOfflineSales, queueOfflineSale, syncQueuedSales } from '@/lib/offline-sales';

interface ActiveProduct {
  id: string;
  name: string;
  productCode: string;
  projectName: string;
  allocatedQuantity: number;
  eventPrice: number;
}

interface ActiveEvent {
  id: string;
  name: string;
  eventCode: string;
  location: string;
  status: string;
  startDate: string;
  endDate: string | null;
}

interface SaleItem {
  id: string;
  product: {
    name: string;
    productCode: string;
  };
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface SaleRecord {
  id: string;
  transactionCode: string;
  totalAmount: number;
  paymentMethod: 'CASH' | 'UPI';
  saleTime: string;
  event?: {
    name: string;
  } | null;
  saleItems: SaleItem[];
}

interface Props {
  user: {
    id: string;
    name: string;
    role: string;
  };
  context: {
    event: ActiveEvent | null;
    products: ActiveProduct[];
  };
  initialSales: SaleRecord[];
}

export default function MemberSalesClient({ user, context, initialSales }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sales, setSales] = useState(initialSales);
  const [queuedCount, setQueuedCount] = useState(0);
  const [isOffline, setIsOffline] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(context.products[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI'>('UPI');

  const selectedProduct = context.products.find((product) => product.id === selectedProductId) ?? null;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateConnectionState = () => {
      const offline = !navigator.onLine;
      setIsOffline(offline);
      if (!offline) {
        void syncQueuedSales(async (payload) => {
          await createMemberSale(payload);
        }).then(async () => {
          const nextQueue = await listOfflineSales();
          setQueuedCount(nextQueue.length);
        });
      }
    };

    updateConnectionState();
    window.addEventListener('online', updateConnectionState);
    window.addEventListener('offline', updateConnectionState);

    void listOfflineSales().then((items) => setQueuedCount(items.length));

    return () => {
      window.removeEventListener('online', updateConnectionState);
      window.removeEventListener('offline', updateConnectionState);
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (!selectedProduct) {
      setError('Select a valid product before making a sale.');
      setLoading(false);
      return;
    }

    const payload = {
      eventId: context.event?.id ?? null,
      productId: selectedProduct.id,
      quantity,
      customerName,
      customerPhone,
      paymentMethod,
    };

    try {
      if (!navigator.onLine) {
        await queueOfflineSale(payload);
        setQueuedCount((prev) => prev + 1);
        setCustomerName('');
        setCustomerPhone('');
        setQuantity(1);
        setSuccess('Offline mode enabled. The sale has been queued and will sync when the connection is restored.');
        return;
      }

      const createdSale = await createMemberSale(payload);

      setSales((prev) => [
        {
          id: createdSale.id,
          transactionCode: createdSale.transactionCode,
          totalAmount: createdSale.totalAmount,
          paymentMethod: createdSale.paymentMethod,
          saleTime: createdSale.saleTime,
          event: context.event ? { name: context.event.name } : undefined,
          saleItems: createdSale.saleItems.map((item) => ({
            id: item.id,
            product: {
              name: item.product.name,
              productCode: item.product.productCode,
            },
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          })),
        },
        ...prev,
      ]);

      setCustomerName('');
      setCustomerPhone('');
      setQuantity(1);
      setSuccess(`Sale ${createdSale.transactionCode} recorded successfully.`);
      router.refresh();
    } catch (err) {
      try {
        await queueOfflineSale(payload);
        setQueuedCount((prev) => prev + 1);
        setCustomerName('');
        setCustomerPhone('');
        setQuantity(1);
        setSuccess('The network is unavailable. This sale was saved locally and will sync automatically when you are back online.');
      } catch {
        setError(err instanceof Error ? err.message : 'Unable to record sale.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Member Portal</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sales workspace</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isOffline ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {isOffline ? 'Offline mode' : 'Online'}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {queuedCount} queued
            </span>
          </div>
        </div>
        <p className="mt-3 text-slate-600">Welcome, {user.name}. Record real sales against the active event inventory.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-semibold">New sale</h2>
            {context.event ? (
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">{context.event.name}</span>
            ) : (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">No active event</span>
            )}
          </div>

          {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {success && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{success}</div>}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">Customer name</label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Jane Doe" className="mt-1" required disabled={loading || !context.event} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Customer phone</label>
                <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="9988776655" className="mt-1" required disabled={loading || !context.event} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">Product</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  disabled={loading || !context.event || context.products.length === 0}
                >
                  {context.products.length === 0 ? (
                    <option value="">No active products</option>
                  ) : (
                    context.products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} ({product.productCode}) — ₹{product.eventPrice}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Quantity</label>
                <Input
                  type="number"
                  min="1"
                  max={selectedProduct?.allocatedQuantity ?? 1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1"
                  required
                  disabled={loading || !context.event || !selectedProduct}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">Payment method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'UPI')}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  disabled={loading || !context.event}
                >
                  <option value="UPI">UPI</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Line total</p>
                <p className="mt-3 text-2xl font-semibold text-slate-900">
                  ₹{selectedProduct ? (selectedProduct.eventPrice * quantity).toFixed(2) : '0.00'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={loading || !context.event || !selectedProduct} className="gap-2">
                {loading ? 'Recording...' : 'Record sale'}
              </Button>
              {selectedProduct && (
                <p className="text-sm text-slate-500">
                  {selectedProduct.allocatedQuantity} units allocated for this event.
                </p>
              )}
            </div>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Active event</h2>
          {context.event ? (
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <p><span className="font-medium text-slate-800">Event:</span> {context.event.name}</p>
              <p><span className="font-medium text-slate-800">Code:</span> {context.event.eventCode}</p>
              <p><span className="font-medium text-slate-800">Location:</span> {context.event.location}</p>
              <p><span className="font-medium text-slate-800">Date:</span> {new Date(context.event.startDate).toLocaleDateString()}</p>
              <p><span className="font-medium text-slate-800">Products:</span> {context.products.length}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600">No active event is currently open for sales.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-xl font-semibold">Recent sales</h2>
        </div>

        {sales.length === 0 ? (
          <div className="p-6 text-sm text-slate-600">No sales recorded yet for this member.</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {sales.map((sale) => (
              <div key={sale.id} className="flex flex-col gap-3 p-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{sale.transactionCode}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-700">
                      {sale.paymentMethod}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{sale.event?.name ?? 'Event'} • {new Date(sale.saleTime).toLocaleString()}</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
                    {sale.saleItems.map((item) => (
                      <span key={`${sale.id}-${item.product.productCode}`}>
                        {item.product.name} × {item.quantity}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-lg font-semibold text-slate-900">₹{sale.totalAmount.toFixed(2)}</p>
                  <p className="text-xs text-slate-500">{sale.saleItems.length} item(s)</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
