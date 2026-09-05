import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { syncManager } from '../lib/sync';
import { cacheEvents, getCachedEvents } from '../lib/db';
import { AppEvent, EventAllocation, PaymentMethod, CartItem } from '../types';
import {
  Receipt,
  CheckCircle2,
  AlertCircle,
  Plus,
  Minus,
  Trash2,
  RefreshCw,
  ShoppingBag,
  CreditCard,
  Banknote,
  Check,
  User as UserIcon,
  Phone,
  Copy,
  X,
  ArrowRight,
} from 'lucide-react';

const generateBillNumber = () =>
  `BILL-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

export const MemberSalePortalPage: React.FC = () => {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [events, setEvents] = useState<AppEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [billNumber, setBillNumber] = useState<string>(generateBillNumber());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Completed bill receipt modal state
  const [lastCompletedBill, setLastCompletedBill] = useState<{
    billNo: string;
    customerName: string;
    customerPhone: string;
    items: CartItem[];
    totalAmount: number;
    totalUnits: number;
    paymentMethod: PaymentMethod;
    time: string;
    syncedImmediately: boolean;
  } | null>(null);
  const [copiedReceipt, setCopiedReceipt] = useState<boolean>(false);

  // Purge any outdated SW cache on mount to guarantee fresh POS UI
  useEffect(() => {
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(k => {
          if (k === 'enactus-ims-cache-v1') {
            caches.delete(k);
          }
        });
      });
    }
  }, []);

  // Load events (from network or offline cache)
  const fetchEvents = async () => {
    try {
      const data = await api.get('/events');
      if (data && Array.isArray(data.events)) {
        setEvents(data.events);
        await cacheEvents(data.events);

        // Auto-select active event if available
        if (!selectedEventId && data.events.length > 0) {
          const active = data.events.find((e: AppEvent) => e.status === 'ACTIVE') || data.events[0];
          setSelectedEventId(active.id);
        }
      }
    } catch (err) {
      console.warn('Network error loading events, checking offline cache:', err);
      const cached = await getCachedEvents();
      if (cached && cached.length > 0) {
        setEvents(cached);
        if (!selectedEventId) {
          setSelectedEventId(cached[0].id);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  // Listen for real-time inventory and event updates
  useEffect(() => {
    if (!socket) return;

    const handleInventoryUpdate = () => {
      fetchEvents();
    };

    const handleEventUpdate = () => {
      fetchEvents();
    };

    socket.on('inventory:updated', handleInventoryUpdate);
    socket.on('event:updated', handleEventUpdate);

    return () => {
      socket.off('inventory:updated', handleInventoryUpdate);
      socket.off('event:updated', handleEventUpdate);
    };
  }, [socket]);

  // Current selected event object
  const currentEvent = events.find(e => e.id === selectedEventId);

  // Allocations for current event
  const allocations: EventAllocation[] = currentEvent?.allocations || [];

  // Synchronize cart remaining stocks if allocations change
  useEffect(() => {
    if (cart.length === 0 || !currentEvent) return;
    setCart(prevCart =>
      prevCart
        .map(item => {
          const alloc = allocations.find(a => a.productId === item.productId);
          if (!alloc) return item;
          const newStock = alloc.remainingQty;
          return {
            ...item,
            remainingStock: newStock,
            quantity: Math.min(item.quantity, Math.max(1, newStock)),
          };
        })
        .filter(item => item.remainingStock > 0)
    );
  }, [events]);

  // Calculations for this person's bill
  const totalUnits = cart.reduce((acc, item) => acc + item.quantity, 0);
  const totalAmount = cart.reduce((acc, item) => acc + item.priceAtEvent * item.quantity, 0);

  // Add item or increment quantity in this customer's bill
  const handleAddToCart = (alloc: EventAllocation) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (alloc.remainingQty <= 0) {
      setErrorMessage(`${alloc.productName} is currently out of stock.`);
      return;
    }

    setCart(prevCart => {
      const existing = prevCart.find(item => item.productId === alloc.productId);
      if (existing) {
        if (existing.quantity >= alloc.remainingQty) {
          setErrorMessage(`Cannot add more. Only ${alloc.remainingQty} unit(s) available for ${alloc.productName}.`);
          return prevCart;
        }
        return prevCart.map(item =>
          item.productId === alloc.productId
            ? { ...item, quantity: item.quantity + 1, remainingStock: alloc.remainingQty }
            : item
        );
      }
      return [
        ...prevCart,
        {
          productId: alloc.productId,
          productName: alloc.productName,
          projectName: alloc.projectName,
          priceAtEvent: Number(alloc.priceAtEvent),
          quantity: 1,
          remainingStock: alloc.remainingQty,
        },
      ];
    });
  };

  // Adjust quantity (+1 or -1) in bill
  const handleUpdateQuantity = (productId: string, delta: number) => {
    setErrorMessage(null);
    setCart(prevCart =>
      prevCart
        .map(item => {
          if (item.productId !== productId) return item;
          const nextQty = item.quantity + delta;
          if (nextQty <= 0) return null; // Decrementing below 1 removes from bill
          if (nextQty > item.remainingStock) {
            setErrorMessage(`Stock limit reached for ${item.productName} (${item.remainingStock} available).`);
            return item;
          }
          return { ...item, quantity: nextQty };
        })
        .filter((item): item is CartItem => item !== null)
    );
  };

  // Remove single product from bill
  const handleRemoveFromCart = (productId: string) => {
    setCart(prevCart => prevCart.filter(item => item.productId !== productId));
  };

  // Clear bill
  const handleClearCart = () => {
    setCart([]);
    setErrorMessage(null);
  };

  // Start next customer's bill
  const handleStartNextBill = () => {
    setLastCompletedBill(null);
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setBillNumber(generateBillNumber());
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Copy receipt text to clipboard for WhatsApp
  const handleCopyReceipt = () => {
    if (!lastCompletedBill) return;
    const lines = [
      `🧾 *Enactus VIPS-TC Receipt*`,
      `*Bill No:* ${lastCompletedBill.billNo}`,
      `*Stall / Event:* ${currentEvent?.name || 'College Stall'}`,
      `*Customer:* ${lastCompletedBill.customerName}`,
      `*Payment:* ${lastCompletedBill.paymentMethod}`,
      `*Date/Time:* ${lastCompletedBill.time}`,
      `---------------------------------`,
      ...lastCompletedBill.items.map(
        i => `• ${i.quantity}x ${i.productName} @ ₹${i.priceAtEvent} = ₹${(i.priceAtEvent * i.quantity).toFixed(2)}`
      ),
      `---------------------------------`,
      `*Grand Total: ₹${lastCompletedBill.totalAmount.toFixed(2)}*`,
      `\nThank you for supporting student social entrepreneurship! 💚`,
    ].join('\n');

    navigator.clipboard.writeText(lines);
    setCopiedReceipt(true);
    setTimeout(() => setCopiedReceipt(false), 3000);
  };

  // Submit complete person-wise bill
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) {
      setErrorMessage('Please select an active stall / event');
      return;
    }

    if (cart.length === 0) {
      setErrorMessage('This customer bill is empty. Please add at least one product.');
      return;
    }

    // Validate quantities against current stock
    for (const item of cart) {
      if (item.quantity <= 0) {
        setErrorMessage(`Invalid quantity for ${item.productName}`);
        return;
      }
      if (item.quantity > item.remainingStock) {
        setErrorMessage(
          `Insufficient stock for ${item.productName}. Only ${item.remainingStock} unit(s) remaining.`
        );
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const saleTime = new Date().toISOString();
      const orderPayload = {
        eventId: selectedEventId,
        eventName: currentEvent?.name,
        paymentMethod,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        saleTime,
        items: cart.map(item => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.priceAtEvent,
          totalAmount: item.priceAtEvent * item.quantity,
        })),
      };

      // Record through SyncManager (writes all items to IndexedDB and triggers batch sync)
      const { syncedImmediately } = await syncManager.recordOrder(orderPayload);

      // Optimistically decrement local remaining count in events
      if (currentEvent) {
        setEvents(prevEvents =>
          prevEvents.map(evt => {
            if (evt.id !== selectedEventId) return evt;
            return {
              ...evt,
              allocations: evt.allocations.map(alloc => {
                const cartItem = cart.find(c => c.productId === alloc.productId);
                if (!cartItem) return alloc;
                return {
                  ...alloc,
                  remainingQty: Math.max(0, alloc.remainingQty - cartItem.quantity),
                  soldQty: alloc.soldQty + cartItem.quantity,
                };
              }),
            };
          })
        );
      }

      // Open receipt modal with the completed bill
      setLastCompletedBill({
        billNo: billNumber,
        customerName: customerName.trim() || 'Walk-in Customer',
        customerPhone: customerPhone.trim() || '',
        items: [...cart],
        totalAmount,
        totalUnits,
        paymentMethod,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        syncedImmediately,
      });

      // Clear the current form for the next customer
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setBillNumber(generateBillNumber());
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to record bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-24">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-emerald-600" />
              <h1 className="text-lg sm:text-xl font-bold text-slate-900">
                Stall POS & Customer Billing
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              One bill per person &bull; Sales attributed to:{' '}
              <span className="font-semibold text-slate-800">{user?.name}</span> &bull; Enactus VIPS-TC
            </p>
          </div>

          {/* Event Selector */}
          <div className="w-full sm:w-72">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Active Stall / Event
            </label>
            <select
              value={selectedEventId}
              onChange={e => {
                setSelectedEventId(e.target.value);
                setCart([]); // Clear bill when switching events
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className="w-full text-xs font-semibold bg-slate-50 border border-slate-300 rounded-md p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              {events.length === 0 && <option value="">No events found</option>}
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} ({ev.status})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-slate-400 mx-auto mb-2" />
          <p className="text-xs text-slate-500 font-medium">Loading stall inventory...</p>
        </div>
      ) : !currentEvent ? (
        <div className="bg-white p-8 rounded-lg border border-slate-200 text-center">
          <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800">No active event selected.</p>
          <p className="text-xs text-slate-500 mt-1">
            Please ask an Admin or Developer to schedule/activate an event with allocated inventory.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Available Products Catalog */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Available Stall Products
                </h2>
                <p className="text-[11px] text-slate-500">
                  Click "+ Add to Bill" on each item the person is buying
                </p>
              </div>
              <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                {allocations.length} products available
              </span>
            </div>

            {allocations.length === 0 ? (
              <div className="bg-white p-8 rounded-lg border border-slate-200 text-center text-xs text-slate-500">
                No products allocated to this event yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {allocations.map(item => {
                  const inCartItem = cart.find(c => c.productId === item.productId);
                  const inCartQty = inCartItem ? inCartItem.quantity : 0;
                  const isOutOfStock = item.remainingQty <= 0;
                  const isMaxAdded = inCartQty >= item.remainingQty && item.remainingQty > 0;

                  return (
                    <div
                      key={item.productId}
                      className={`p-3.5 rounded-lg border transition-all relative flex flex-col justify-between select-none ${
                        isOutOfStock
                          ? 'border-slate-200 bg-slate-100 opacity-60'
                          : inCartQty > 0
                          ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/30 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300 shadow-2xs'
                      }`}
                    >
                      <div>
                        {/* Top line: Code & Price */}
                        <div className="flex items-start justify-between gap-1">
                          <span className="text-[10px] font-mono font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            {item.productId}
                          </span>
                          <span className="text-sm font-black text-slate-900">
                            ₹{Number(item.priceAtEvent).toFixed(2)}
                          </span>
                        </div>

                        {/* Product Name */}
                        <div className="text-xs font-bold text-slate-900 mt-1.5 line-clamp-1">
                          {item.productName}
                        </div>

                        {/* Project Tag */}
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Project: <span className="font-medium text-slate-700">{item.projectName}</span>
                        </div>
                      </div>

                      {/* Bottom line: Remaining Stock & In-Bill Controls */}
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                        <div className="text-[11px]">
                          <span className="text-slate-400">Stock: </span>
                          <span
                            className={`font-bold ${
                              item.remainingQty <= 3
                                ? 'text-red-600'
                                : item.remainingQty <= 10
                                ? 'text-amber-600'
                                : 'text-emerald-700'
                            }`}
                          >
                            {item.remainingQty} left
                          </span>
                        </div>

                        {/* Action: Add or Stepper */}
                        {isOutOfStock ? (
                          <span className="text-[10px] font-semibold text-slate-400 px-2 py-0.5 bg-slate-200 rounded">
                            Out of Stock
                          </span>
                        ) : inCartQty > 0 ? (
                          <div className="flex items-center gap-1 bg-white border border-emerald-400 rounded px-1 py-0.5 shadow-2xs">
                            <button
                              type="button"
                              onClick={() => handleUpdateQuantity(item.productId, -1)}
                              className="w-5 h-5 flex items-center justify-center text-slate-600 hover:text-red-600 hover:bg-slate-100 rounded transition-colors"
                              title={inCartQty === 1 ? 'Remove from bill' : 'Decrease'}
                            >
                              {inCartQty === 1 ? (
                                <Trash2 className="w-3 h-3 text-red-500" />
                              ) : (
                                <Minus className="w-3 h-3" />
                              )}
                            </button>
                            <span className="text-xs font-bold text-emerald-800 px-1 min-w-[20px] text-center">
                              {inCartQty} in bill
                            </span>
                            <button
                              type="button"
                              disabled={isMaxAdded}
                              onClick={() => handleUpdateQuantity(item.productId, 1)}
                              className="w-5 h-5 flex items-center justify-center text-slate-600 hover:text-emerald-600 hover:bg-slate-100 rounded disabled:opacity-30 transition-colors"
                              title={isMaxAdded ? 'Max available stock reached' : 'Add another'}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAddToCart(item)}
                            className="text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add to Bill</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Customer Bill & Checkout Panel */}
          <div className="lg:col-span-5">
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm sticky top-20">
              {/* Bill Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-emerald-600" />
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Customer Bill</h2>
                    <span className="text-[10px] font-mono text-slate-400 block">{billNumber}</span>
                  </div>
                </div>

                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearCart}
                    className="text-[11px] text-slate-400 hover:text-red-600 transition-colors flex items-center gap-1 cursor-pointer"
                    title="Clear this bill"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear Bill</span>
                  </button>
                )}
              </div>

              {/* Error Message */}
              {errorMessage && (
                <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <form onSubmit={handleSubmitOrder} className="space-y-4">
                {/* 1. Customer Details (Person) */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Customer Information (Person)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative">
                      <UserIcon className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder="Buyer name (optional)"
                        value={customerName}
                        onChange={e => setCustomerName(e.target.value)}
                        className="w-full text-xs pl-8 pr-2.5 py-2 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
                      />
                    </div>
                    <div className="relative">
                      <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="tel"
                        placeholder="Phone / WhatsApp"
                        value={customerPhone}
                        onChange={e => setCustomerPhone(e.target.value)}
                        className="w-full text-xs pl-8 pr-2.5 py-2 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Items in this Bill */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Items in this Bill
                    </label>
                    {cart.length > 0 && (
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                        {cart.length} product(s) &bull; {totalUnits} unit(s)
                      </span>
                    )}
                  </div>

                  {cart.length === 0 ? (
                    <div className="py-8 px-4 text-center border-2 border-dashed border-slate-200 rounded-lg bg-slate-50/50">
                      <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-slate-700">No items added to this bill</p>
                      <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                        Tap "+ Add to Bill" on any products on the left (e.g. Tote Bag, Candles, Scrunchies) to bill this customer.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {cart.map(item => {
                        const itemTotal = item.priceAtEvent * item.quantity;
                        const isMaxStock = item.quantity >= item.remainingStock;

                        return (
                          <div
                            key={item.productId}
                            className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-2"
                          >
                            {/* Product info */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-slate-900 truncate">
                                  {item.productName}
                                </span>
                                <span className="text-[9px] font-semibold px-1.5 py-0.2 bg-slate-200 text-slate-600 rounded shrink-0">
                                  {item.projectName}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                ₹{item.priceAtEvent.toFixed(2)} each &bull; Max: {item.remainingStock}
                              </div>
                            </div>

                            {/* Stepper */}
                            <div className="flex items-center border border-slate-300 rounded bg-white overflow-hidden shrink-0">
                              <button
                                type="button"
                                onClick={() => handleUpdateQuantity(item.productId, -1)}
                                className="w-7 h-7 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                                title={item.quantity === 1 ? 'Remove' : 'Decrease'}
                              >
                                {item.quantity === 1 ? (
                                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                ) : (
                                  <Minus className="w-3 h-3" />
                                )}
                              </button>
                              <span className="w-7 text-center text-xs font-bold text-slate-900 select-none">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleUpdateQuantity(item.productId, 1)}
                                disabled={isMaxStock}
                                className="w-7 h-7 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white transition-colors cursor-pointer"
                                title={isMaxStock ? 'Max available stock reached' : 'Increase'}
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>

                            {/* Line Total & Remove */}
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-right w-16">
                                <span className="text-xs font-bold text-slate-900">
                                  ₹{itemTotal.toFixed(2)}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveFromCart(item.productId)}
                                className="text-slate-400 hover:text-red-500 p-1 transition-colors cursor-pointer"
                                title="Remove item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 3. Payment Method */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Payment Method for this Bill
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('UPI')}
                      className={`py-2 px-3 text-xs font-semibold rounded-md border flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        paymentMethod === 'UPI'
                          ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>UPI / QR</span>
                      {paymentMethod === 'UPI' && <Check className="w-3.5 h-3.5 text-emerald-400 ml-auto" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('CASH')}
                      className={`py-2 px-3 text-xs font-semibold rounded-md border flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        paymentMethod === 'CASH'
                          ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <Banknote className="w-3.5 h-3.5" />
                      <span>Cash</span>
                      {paymentMethod === 'CASH' && <Check className="w-3.5 h-3.5 text-emerald-400 ml-auto" />}
                    </button>
                  </div>
                </div>

                {/* 4. Grand Total Summary */}
                <div className="p-3.5 bg-slate-900 text-white rounded-lg flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-slate-400 block">Total Bill Amount:</span>
                    <span className="text-[11px] text-slate-300 font-medium">
                      {totalUnits} {totalUnits === 1 ? 'unit' : 'units'} across {cart.length} product(s)
                    </span>
                  </div>
                  <span className="text-xl font-black tracking-tight">
                    ₹{totalAmount.toFixed(2)}
                  </span>
                </div>

                {/* 5. Complete Sale Button */}
                <button
                  type="submit"
                  disabled={cart.length === 0 || isSubmitting}
                  className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-md shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <Receipt className="w-4 h-4" />
                  <span>
                    {isSubmitting
                      ? 'Recording Bill...'
                      : cart.length === 0
                      ? 'Add Products to Generate Bill'
                      : `Record Bill & Complete Sale • ₹${totalAmount.toFixed(2)}`}
                  </span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Completed Bill Receipt Modal */}
      {lastCompletedBill && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 animate-fadeIn">
            {/* Header */}
            <div className="text-center pb-4 border-b border-slate-100">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Sale & Bill Recorded!</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lastCompletedBill.syncedImmediately ? '✓ Synced online to database' : '✓ Saved locally (Offline Queue)'}
              </p>
            </div>

            {/* Bill Receipt Card */}
            <div className="my-4 p-4 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-3">
              <div className="flex items-center justify-between text-[11px] text-slate-500 pb-2 border-b border-slate-200">
                <span className="font-mono font-bold text-slate-800">{lastCompletedBill.billNo}</span>
                <span>{lastCompletedBill.time}</span>
              </div>

              <div className="text-[11px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer:</span>
                  <span className="font-bold text-slate-800">{lastCompletedBill.customerName}</span>
                </div>
                {lastCompletedBill.customerPhone && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Phone:</span>
                    <span className="font-mono text-slate-700">{lastCompletedBill.customerPhone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Payment:</span>
                  <span className="font-bold text-slate-800">{lastCompletedBill.paymentMethod}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="pt-2 border-t border-slate-200 space-y-1.5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Purchased Items
                </div>
                {lastCompletedBill.items.map(i => (
                  <div key={i.productId} className="flex items-center justify-between">
                    <span className="text-slate-700 truncate mr-2">
                      {i.quantity}x {i.productName}
                    </span>
                    <span className="font-bold text-slate-900 shrink-0">
                      ₹{(i.priceAtEvent * i.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="pt-2 border-t border-slate-300 flex items-center justify-between font-bold text-sm text-slate-900">
                <span>Total Amount Paid:</span>
                <span className="text-base text-emerald-700">₹{lastCompletedBill.totalAmount.toFixed(2)}</span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleCopyReceipt}
                className="flex-1 py-2.5 px-3 border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedReceipt ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700">Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy WhatsApp Receipt</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleStartNextBill}
                className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-md shadow-sm transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Next Customer Bill</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
