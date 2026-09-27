import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { syncManager } from '../lib/sync';
import { cacheEvents, getCachedEvents } from '../lib/db';
import { AppEvent, EventAllocation, PaymentMethod, CartItem, Combo, ComboType } from '../types';
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
  Search,
  ChevronDown,
  Zap,
  Gamepad2,
  Gift,
  Tag,
  Percent,
} from 'lucide-react';

export const MemberSalePortalPage: React.FC = () => {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [events, setEvents] = useState<AppEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [combos, setCombos] = useState<Combo[]>([]);
  const [portalTab, setPortalTab] = useState<'PRODUCTS' | 'COMBOS'>('PRODUCTS');
  const [pickingCombo, setPickingCombo] = useState<Combo | null>(null);
  const [pickSelectedMap, setPickSelectedMap] = useState<Record<string, number>>({});
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [splitCash, setSplitCash] = useState<string>('');
  const [splitUpi, setSplitUpi] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [showCustomerDetails, setShowCustomerDetails] = useState<boolean>(false);

  // Product catalog discovery: Project filter & search
  const [selectedProject, setSelectedProject] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Completed bill receipt notification & modal state
  const [lastCompletedBill, setLastCompletedBill] = useState<{
    billNo: string;
    receiptNumber?: number;
    customerName: string;
    customerPhone: string;
    items: CartItem[];
    totalAmount: number;
    totalUnits: number;
    paymentMethod: PaymentMethod;
    cashAmount?: number | null;
    upiAmount?: number | null;
    time: string;
    syncedImmediately: boolean;
  } | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState<boolean>(false);
  const [copiedReceipt, setCopiedReceipt] = useState<boolean>(false);

  // Purge any outdated SW cache on mount to guarantee fresh POS UI
  useEffect(() => {
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(k => {
          if (k !== 'enactus-ims-cache-v3') {
            caches.delete(k);
          }
        });
      });
    }
  }, []);

  // Keyboard navigation shortcuts: '/' to search, 'Escape' to clear, 'u'/'c'/'s' for payment modes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('');
        }
        searchInputRef.current?.blur();
      } else if (!isInput && (e.key === 'u' || e.key === 'U')) {
        setPaymentMethod('UPI');
      } else if (!isInput && (e.key === 'c' || e.key === 'C')) {
        setPaymentMethod('CASH');
      } else if (!isInput && (e.key === 's' || e.key === 'S')) {
        setPaymentMethod('CASH_UPI');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery]);

  // Load events (from network or offline cache)
  const fetchEvents = async () => {
    try {
      const data = await api.get('/events');
      if (data && Array.isArray(data.events)) {
        setEvents(data.events);
        await cacheEvents(data.events);

        // Auto-select active non-expired event if available
        if (!selectedEventId && data.events.length > 0) {
          const now = Date.now();
          const active =
            data.events.find(
              (e: AppEvent) =>
                e.status === 'ACTIVE' && now < new Date(e.endDatetime).getTime()
            ) ||
            data.events.find(
              (e: AppEvent) =>
                e.status !== 'ENDED' && now < new Date(e.endDatetime).getTime()
            ) ||
            data.events[0];
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

  const fetchCombos = async () => {
    try {
      const url = selectedEventId
        ? `/combos?eventId=${selectedEventId}&status=ACTIVE`
        : '/combos?status=ACTIVE';
      const data = await api.get(url);
      if (data && Array.isArray(data.combos)) {
        setCombos(data.combos);
      }
    } catch (err) {
      console.warn('Failed to load combos:', err);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  useEffect(() => {
    fetchCombos();
  }, [selectedEventId]);

  // Listen for real-time inventory and event updates
  useEffect(() => {
    if (!socket) return;

    const handleInventoryUpdate = () => {
      fetchEvents();
      fetchCombos();
    };

    const handleEventUpdate = () => {
      fetchEvents();
      fetchCombos();
    };

    const handleComboUpdate = () => {
      fetchCombos();
      fetchEvents();
    };

    socket.on('inventory:updated', handleInventoryUpdate);
    socket.on('event:updated', handleEventUpdate);
    socket.on('combo:created', handleComboUpdate);
    socket.on('combo:updated', handleComboUpdate);
    socket.on('combo:sold', handleComboUpdate);

    return () => {
      socket.off('inventory:updated', handleInventoryUpdate);
      socket.off('event:updated', handleEventUpdate);
      socket.off('combo:created', handleComboUpdate);
      socket.off('combo:updated', handleComboUpdate);
      socket.off('combo:sold', handleComboUpdate);
    };
  }, [socket]);

  // Current selected event object
  const currentEvent = events.find(e => e.id === selectedEventId);

  // Periodic ticker to automatically update event status if end time passes while portal is open
  useEffect(() => {
    const interval = setInterval(() => {
      if (currentEvent && currentEvent.status !== 'ENDED') {
        const now = Date.now();
        if (now >= new Date(currentEvent.endDatetime).getTime()) {
          fetchEvents();
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [currentEvent]);

  const isEventEnded =
    !currentEvent ||
    currentEvent.status === 'ENDED' ||
    new Date().getTime() >= new Date(currentEvent.endDatetime).getTime();

  const isEventUpcoming =
    !!currentEvent &&
    currentEvent.status === 'UPCOMING' &&
    new Date().getTime() < new Date(currentEvent.startDatetime).getTime();

  // Allocations for current event
  const allocations: EventAllocation[] = currentEvent?.allocations || [];

  // Dynamic list of projects available in current event's allocations
  const availableProjects = useMemo(() => {
    const set = new Set<string>();
    allocations.forEach(a => {
      if (a.projectName && a.projectName.trim()) {
        set.add(a.projectName.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allocations]);

  // Clean formatting for project labels (e.g. TAHSIN -> Tahsin, UPCYCLE -> Upcycle)
  const formatProjectLabel = (name: string) => {
    if (!name) return name;
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  };

  // Quick Sell: top 4-6 most frequently allocated or sold products in this event (excluding legacy combo items)
  const quickSellProducts = useMemo(() => {
    if (!allocations || allocations.length === 0) return [];
    return [...allocations]
      .filter(a => a.remainingQty > 0 && !['TAH-010', 'TAH-011', 'TAH-012'].includes(a.productId))
      .sort((a, b) => (b.soldQty || 0) - (a.soldQty || 0) || (b.remainingQty || 0) - (a.remainingQty || 0))
      .slice(0, 6);
  }, [allocations]);

  // Filter allocations combining project selector and search query (excluding legacy combo items)
  const filteredAllocations = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();

    return allocations.filter(item => {
      // Exclude legacy combo products from normal products view
      if (['TAH-010', 'TAH-011', 'TAH-012'].includes(item.productId)) {
        return false;
      }

      // 1. Project filter
      if (selectedProject !== 'ALL') {
        if ((item.projectName || '').toUpperCase() !== selectedProject.toUpperCase()) {
          return false;
        }
      }

      // 2. Search filter across Product Name, Product ID, and Project Name
      if (term) {
        const matchName = item.productName.toLowerCase().includes(term);
        const matchId = item.productId.toLowerCase().includes(term);
        const matchProject = (item.projectName || '').toLowerCase().includes(term);
        if (!matchName && !matchId && !matchProject) {
          return false;
        }
      }

      return true;
    });
  }, [allocations, selectedProject, searchQuery]);

  // Live calculation of stall stock for combos based on event stall allocations
  const combosWithStallStock = useMemo(() => {
    return combos
      .map(combo => {
        if (combo.isArchived || combo.status !== 'ACTIVE') return null;
        if (combo.eventId && combo.eventId !== selectedEventId) return null;

        let normalValue = 0;
        let maxBundles = 999999;
        let hasMissingComponent = false;

        if (combo.comboType === 'PICK_ANY') {
          const allowed = combo.items && combo.items.length > 0
            ? combo.items.map(i => i.productId)
            : allocations.map(a => a.productId);

          let totalEligibleUnits = 0;
          allowed.forEach(pId => {
            const alloc = allocations.find(a => a.productId === pId);
            if (alloc) {
              totalEligibleUnits += alloc.remainingQty;
              normalValue = Math.max(normalValue, Number(alloc.priceAtEvent) * (combo.minItems || 3));
            }
          });
          const minItems = combo.minItems || 3;
          maxBundles = Math.floor(totalEligibleUnits / minItems);
        } else {
          for (const item of combo.items) {
            const alloc = allocations.find(a => a.productId === item.productId);
            if (!alloc) {
              hasMissingComponent = true;
              maxBundles = 0;
            } else {
              normalValue += Number(alloc.priceAtEvent) * item.quantity;
              const bundlesForComp = Math.floor(alloc.remainingQty / item.quantity);
              if (bundlesForComp < maxBundles) {
                maxBundles = bundlesForComp;
              }
            }
          }
        }

        if (maxBundles === 999999) maxBundles = 0;

        const dealPrice = Number(combo.price);
        const savings = Math.max(0, normalValue - dealPrice);
        const savingsPercent = normalValue > 0 ? Math.round((savings / normalValue) * 100) : 0;

        return {
          ...combo,
          normalValue: normalValue > 0 ? normalValue : combo.normalValue,
          savings,
          savingsPercent,
          availableStock: maxBundles,
          isOutOfStock: maxBundles <= 0 || hasMissingComponent,
          isLowStock: maxBundles > 0 && maxBundles < 4,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  }, [combos, allocations, selectedEventId]);

  // Predictable sorting: Project ascending -> Product ID ascending (numeric-aware: TAH-001, TAH-002, UPC-001)
  const sortedAllocations = useMemo(() => {
    return [...filteredAllocations].sort((a, b) => {
      const projA = (a.projectName || '').toUpperCase();
      const projB = (b.projectName || '').toUpperCase();
      if (projA !== projB) {
        return projA.localeCompare(projB);
      }
      return a.productId.localeCompare(b.productId, undefined, { numeric: true });
    });
  }, [filteredAllocations]);

  // Reset all filters back to default (All Projects, empty search)
  const handleClearFilters = () => {
    setSelectedProject('ALL');
    setSearchQuery('');
  };

  const isFilterActive = selectedProject !== 'ALL' || searchQuery.trim() !== '';

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

  // Split payment calculations
  const cashNum = parseFloat(splitCash) || 0;
  const upiNum = parseFloat(splitUpi) || 0;
  const splitTotalPaid = Math.round((cashNum + upiNum) * 100) / 100;
  const splitRemaining = Math.round((totalAmount - splitTotalPaid) * 100) / 100;
  const isSplitValid =
    paymentMethod === 'CASH_UPI'
      ? Math.abs(splitRemaining) < 0.01 &&
        cashNum >= 0 &&
        upiNum >= 0 &&
        (splitCash.trim() !== '' || splitUpi.trim() !== '') &&
        totalAmount > 0
      : true;

  // Add item or increment quantity in this customer's bill
  const handleAddToCart = (alloc: EventAllocation) => {
    setErrorMessage(null);

    if (isEventEnded) {
      setErrorMessage('This event has ended and is no longer accepting sales.');
      return;
    }

    if (isEventUpcoming) {
      setErrorMessage('This event has not started yet.');
      return;
    }

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

  // Add combo offer to customer bill
  const handleAddComboToCart = (
    combo: Combo,
    customComponents?: Array<{ productId: string; productName: string; quantity: number }>
  ) => {
    setErrorMessage(null);

    if (isEventEnded) {
      setErrorMessage('This event has ended and is no longer accepting sales.');
      return;
    }
    if (isEventUpcoming) {
      setErrorMessage('This event has not started yet.');
      return;
    }

    const components =
      customComponents ||
      combo.items.map(i => ({
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
      }));

    // Stock check against current event allocations
    for (const comp of components) {
      const alloc = allocations.find(a => a.productId === comp.productId);
      const remaining = alloc ? alloc.remainingQty : 0;
      let alreadyInCart = 0;
      cart.forEach(c => {
        if (c.isCombo && c.components) {
          const match = c.components.find(ci => ci.productId === comp.productId);
          if (match) alreadyInCart += match.quantity * c.quantity;
        } else if (c.productId === comp.productId) {
          alreadyInCart += c.quantity;
        }
      });

      if (comp.quantity + alreadyInCart > remaining) {
        setErrorMessage(
          `Cannot add combo. Insufficient stall stock for ${comp.productName} (${remaining} remaining in stall).`
        );
        return;
      }
    }

    const cartKey = `combo-${combo.id}${
      customComponents ? '-' + customComponents.map(c => `${c.productId}x${c.quantity}`).join('_') : ''
    }`;

    setCart(prevCart => {
      const existing = prevCart.find(item => item.productId === cartKey);
      if (existing) {
        return prevCart.map(item =>
          item.productId === cartKey ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prevCart,
        {
          productId: cartKey,
          productName: combo.name,
          projectName: combo.projectName || 'Special Combo',
          priceAtEvent: Number(combo.price),
          quantity: 1,
          remainingStock: combo.availableStock || 999,
          isCombo: true,
          comboId: combo.id,
          comboName: combo.name,
          comboType: combo.comboType,
          normalValue: combo.normalValue,
          savings: combo.savings,
          components,
        },
      ];
    });
  };

  // Adjust quantity (+1 or -1) in bill. If reduced to 0, item is cleanly removed from bill.
  const handleUpdateQuantity = (productId: string, delta: number) => {
    setErrorMessage(null);
    setCart(prevCart =>
      prevCart
        .map(item => {
          if (item.productId !== productId) return item;
          const nextQty = item.quantity + delta;
          if (nextQty < 1) return null;

          if (item.isCombo && item.components && delta > 0) {
            for (const comp of item.components) {
              const alloc = allocations.find(a => a.productId === comp.productId);
              const remaining = alloc ? alloc.remainingQty : 0;
              let otherInCart = 0;
              prevCart.forEach(c => {
                if (c.productId === productId) return;
                if (c.isCombo && c.components) {
                  const m = c.components.find(ci => ci.productId === comp.productId);
                  if (m) otherInCart += m.quantity * c.quantity;
                } else if (c.productId === comp.productId) {
                  otherInCart += c.quantity;
                }
              });

              if (comp.quantity * nextQty + otherInCart > remaining) {
                setErrorMessage(`Stall stock limit reached for component ${comp.productName} (${remaining} in stall).`);
                return item;
              }
            }
          } else if (!item.isCombo && nextQty > item.remainingStock) {
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
    setSplitCash('');
    setSplitUpi('');
    setErrorMessage(null);
  };

  // Start next customer's bill
  const handleStartNextBill = () => {
    setLastCompletedBill(null);
    setShowReceiptModal(false);
    setCart([]);
    setSplitCash('');
    setSplitUpi('');
    setCustomerName('');
    setCustomerPhone('');
    setErrorMessage(null);
  };

  // Copy receipt text to clipboard for WhatsApp
  const handleCopyReceipt = () => {
    if (!lastCompletedBill) return;
    const paymentDisplay =
      lastCompletedBill.paymentMethod === 'CASH_UPI'
        ? `Cash + UPI (Cash: ₹${(lastCompletedBill.cashAmount ?? 0).toFixed(2)} | UPI: ₹${(lastCompletedBill.upiAmount ?? 0).toFixed(2)})`
        : lastCompletedBill.paymentMethod;

    const lines = [
      `🧾 *Enactus VIPS-TC Receipt*`,
      `*Bill No:* ${lastCompletedBill.billNo}`,
      `*Stall / Event:* ${currentEvent?.name || 'College Stall'}`,
      `*Customer:* ${lastCompletedBill.customerName}`,
      `*Payment:* ${paymentDisplay}`,
      `*Date/Time:* ${lastCompletedBill.time}`,
      `---------------------------------`,
      ...lastCompletedBill.items.map(
        i => `• ${i.quantity}x ${i.isCombo ? '[Combo] ' : ''}${i.productName} @ ₹${i.priceAtEvent} = ₹${(i.priceAtEvent * i.quantity).toFixed(2)}`
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
  const handleSubmitOrder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedEventId) {
      setErrorMessage('Please select an active stall / event');
      return;
    }

    if (isEventEnded) {
      setErrorMessage('This event has ended and is no longer accepting sales.');
      return;
    }

    if (isEventUpcoming) {
      setErrorMessage('This event has not started yet.');
      return;
    }

    if (cart.length === 0) {
      setErrorMessage('This customer bill is empty. Please add at least one product or combo.');
      return;
    }

    // Validate split payment balance
    if (paymentMethod === 'CASH_UPI') {
      if (!isSplitValid) {
        if (splitRemaining > 0) {
          setErrorMessage(`Split payment is incomplete. Remaining unpaid balance: ₹${splitRemaining.toFixed(2)}.`);
        } else if (splitRemaining < 0) {
          setErrorMessage(`Split payment exceeds bill total. Overpaid by ₹${(-splitRemaining).toFixed(2)}.`);
        } else {
          setErrorMessage('Please enter valid Cash and UPI amounts totaling the bill.');
        }
        return;
      }
    }

    // Validate quantities against current stock
    for (const item of cart) {
      if (item.quantity <= 0) {
        setErrorMessage(`Invalid quantity for ${item.productName}`);
        return;
      }
      if (item.isCombo && item.components) {
        for (const comp of item.components) {
          const alloc = allocations.find(a => a.productId === comp.productId);
          const req = comp.quantity * item.quantity;
          if (!alloc || req > alloc.remainingQty) {
            setErrorMessage(`Insufficient stock for component ${comp.productName} in combo ${item.productName}`);
            return;
          }
        }
      } else if (!item.isCombo && item.quantity > item.remainingStock) {
        setErrorMessage(
          `Insufficient stock for ${item.productName}. Only ${item.remainingStock} unit(s) remaining.`
        );
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const saleTime = new Date().toISOString();

      // Explode items for individual component stock deduction while preserving combo metadata
      const orderItems: Array<{
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
        totalAmount: number;
      }> = [];

      const isSingleComboOrder = cart.length === 1 && Boolean(cart[0].isCombo);
      const targetComboId = isSingleComboOrder ? cart[0].comboId : undefined;
      const targetComboName = isSingleComboOrder ? cart[0].comboName : undefined;
      const targetComboQuantity = isSingleComboOrder ? cart[0].quantity : undefined;

      for (const item of cart) {
        if (item.isCombo && item.components && item.components.length > 0) {
          const totalUnitsInCombo = item.components.reduce((sum, c) => sum + c.quantity, 0) || 1;
          const comboTotal = item.priceAtEvent * item.quantity;
          let allocatedCents = 0;
          const totalCents = Math.round(comboTotal * 100);

          item.components.forEach((comp, idx) => {
            const totalQty = comp.quantity * item.quantity;
            let compCents: number;
            if (idx === item.components!.length - 1) {
              compCents = totalCents - allocatedCents;
            } else {
              compCents = Math.round(totalCents * (comp.quantity / totalUnitsInCombo));
              allocatedCents += compCents;
            }
            const compLineTotal = compCents / 100;
            const compUnitPrice = Math.round((compLineTotal / totalQty) * 100) / 100;

            orderItems.push({
              productId: comp.productId,
              productName: comp.productName,
              quantity: totalQty,
              unitPrice: compUnitPrice,
              totalAmount: compLineTotal,
            });
          });
        } else {
          orderItems.push({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.priceAtEvent,
            totalAmount: item.priceAtEvent * item.quantity,
          });
        }
      }

      const orderPayload = {
        eventId: selectedEventId,
        eventName: currentEvent?.name,
        paymentMethod,
        cashAmount: paymentMethod === 'CASH_UPI' ? cashNum : paymentMethod === 'CASH' ? totalAmount : 0,
        upiAmount: paymentMethod === 'CASH_UPI' ? upiNum : paymentMethod === 'UPI' ? totalAmount : 0,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        comboId: targetComboId,
        comboName: targetComboName,
        comboQuantity: targetComboQuantity,
        transactionType: isSingleComboOrder ? 'COMBO' : undefined,
        saleTime,
        items: orderItems,
      };

      // Record through SyncManager (writes all items to IndexedDB and triggers batch sync)
      const { syncedImmediately, receiptNumber, saleId } = await syncManager.recordOrder(orderPayload);

      // Optimistically decrement local remaining count in events for every physical component deducted
      if (currentEvent) {
        setEvents(prevEvents =>
          prevEvents.map(evt => {
            if (evt.id !== selectedEventId) return evt;
            return {
              ...evt,
              allocations: evt.allocations.map(alloc => {
                const totalDeducted = orderItems
                  .filter(oi => oi.productId === alloc.productId)
                  .reduce((sum, oi) => sum + oi.quantity, 0);
                if (totalDeducted === 0) return alloc;
                return {
                  ...alloc,
                  remainingQty: Math.max(0, alloc.remainingQty - totalDeducted),
                  soldQty: alloc.soldQty + totalDeducted,
                };
              }),
            };
          })
        );
      }

      const canonicalReceiptLabel = receiptNumber
        ? `#${receiptNumber}`
        : saleId
        ? `#${saleId}`
        : 'Confirmed';

      // Fast success state: record completed bill with canonical receipt number
      setLastCompletedBill({
        billNo: canonicalReceiptLabel,
        receiptNumber,
        customerName: customerName.trim() || 'Walk-in Customer',
        customerPhone: customerPhone.trim() || '',
        items: [...cart],
        totalAmount,
        totalUnits,
        paymentMethod,
        cashAmount: paymentMethod === 'CASH_UPI' ? cashNum : paymentMethod === 'CASH' ? totalAmount : 0,
        upiAmount: paymentMethod === 'CASH_UPI' ? upiNum : paymentMethod === 'UPI' ? totalAmount : 0,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        syncedImmediately,
      });

      // Clear the current form immediately so the cashier is ready for the NEXT customer
      setCart([]);
      setSplitCash('');
      setSplitUpi('');
      setCustomerName('');
      setCustomerPhone('');
      setShowCustomerDetails(false);
    } catch (err: any) {
      console.error('Order recording error:', err);
      setErrorMessage(err?.error || err?.message || 'Failed to record customer bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-2 sm:py-3 space-y-3 pb-24 lg:pb-12">
      {/* 1. Compact Top Bar: Brand, Active Stall, Cashier */}
      <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-black text-sm tracking-tight shrink-0 shadow-2xs">
            POS
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                Member Sales Terminal
              </h1>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                Live Stall
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Cashier: <strong className="text-slate-700">{user?.name}</strong>
              {user?.department && <span> ({user.department})</span>}
            </p>
          </div>
        </div>

        {/* Play Game Quick Action & Active Event Selector */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Link
            to={`/games/play${selectedEventId ? `?eventId=${selectedEventId}` : ''}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-2xs transition-all shrink-0 cursor-pointer"
            title="Switch to Game Reward terminal"
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>🎮 Play Game</span>
          </Link>

          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 hidden sm:inline">
            Stall:
          </span>
          <div className="relative flex-1 sm:w-64">
            <select
              value={selectedEventId}
              onChange={e => {
                setSelectedEventId(e.target.value);
                setCart([]);
                setSelectedProject('ALL');
                setSearchQuery('');
                setErrorMessage(null);
              }}
              className="w-full text-xs font-semibold bg-slate-50 hover:bg-slate-100/80 border border-slate-300 rounded-lg py-1.5 pl-2.5 pr-7 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 appearance-none cursor-pointer"
            >
              {events.length === 0 && <option value="">No events found</option>}
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} ({ev.status})
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Fast Success State Banner (Non-blocking: POS is immediately ready for next customer) */}
      {lastCompletedBill && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
              <Check className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="text-xs font-bold text-emerald-950 flex items-center gap-2">
                <span>✓ Sale Recorded ({lastCompletedBill.billNo})</span>
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100/60 px-1.5 py-0.2 rounded">
                  {lastCompletedBill.syncedImmediately ? 'Synced Online' : 'Saved to Offline Queue'}
                </span>
              </div>
              <div className="text-xs text-emerald-800 font-medium mt-0.5">
                Total: <strong>₹{lastCompletedBill.totalAmount.toFixed(0)}</strong> &bull; {lastCompletedBill.totalUnits} {lastCompletedBill.totalUnits === 1 ? 'item' : 'items'} &bull; Payment:{' '}
                <strong>
                  {lastCompletedBill.paymentMethod === 'CASH_UPI'
                    ? `Cash (₹${(lastCompletedBill.cashAmount || 0).toFixed(0)}) + UPI (₹${(lastCompletedBill.upiAmount || 0).toFixed(0)})`
                    : lastCompletedBill.paymentMethod}
                </strong>
                {lastCompletedBill.customerName && lastCompletedBill.customerName !== 'Walk-in Customer' && (
                  <span> &bull; Buyer: {lastCompletedBill.customerName}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 self-end sm:self-center">
            <button
              type="button"
              onClick={handleCopyReceipt}
              className="px-2.5 py-1.5 bg-white hover:bg-emerald-100/50 border border-emerald-300 text-emerald-800 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
            >
              {copiedReceipt ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Receipt</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowReceiptModal(true)}
              className="px-2 py-1.5 text-xs text-emerald-800 hover:text-emerald-950 font-semibold hover:underline cursor-pointer"
            >
              View Full
            </button>
            <button
              type="button"
              onClick={() => setLastCompletedBill(null)}
              className="p-1 text-emerald-600 hover:text-emerald-900 rounded cursor-pointer"
              title="Dismiss confirmation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Global Error Banner */}
      {errorMessage && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between gap-2 animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 text-rose-500 hover:text-rose-800 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-xl">
          <RefreshCw className="w-6 h-6 animate-spin text-slate-400 mx-auto mb-2" />
          <p className="text-xs text-slate-500 font-medium">Loading stall POS inventory...</p>
        </div>
      ) : !currentEvent ? (
        <div className="bg-white p-8 rounded-xl border border-slate-200 text-center">
          <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800">No active stall / event selected.</p>
          <p className="text-xs text-slate-500 mt-1">
            Please ask an Admin or Developer to schedule or activate an event.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Event Ended / Upcoming Alerts */}
          {isEventEnded && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-2.5 text-rose-800 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <div>
                <span className="font-bold">This stall/event has ended.</span> Sales are closed and unsold inventory has been reconciled.
              </div>
            </div>
          )}

          {isEventUpcoming && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2.5 text-blue-800 text-xs">
              <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />
              <div>
                <span className="font-bold">This stall/event has not started yet.</span> Sales cannot be recorded until start time.
              </div>
            </div>
          )}

          {/* 2-Column POS Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
            {/* LEFT / MAIN AREA (Product Selection) */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-2.5">
              {/* POS Mode Switcher: Products vs Combos */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-200/70 rounded-xl">
                <button
                  type="button"
                  onClick={() => setPortalTab('PRODUCTS')}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    portalTab === 'PRODUCTS'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ShoppingBag className="w-4 h-4 text-indigo-600" />
                  <span>Normal Products ({sortedAllocations.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPortalTab('COMBOS')}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    portalTab === 'COMBOS'
                      ? 'bg-white text-pink-700 shadow-xs ring-1 ring-pink-500/20'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Gift className="w-4 h-4 text-pink-600" />
                  <span>Special Combos ({combosWithStallStock.length})</span>
                  {combosWithStallStock.length > 0 && (
                    <span className="px-1.5 py-0.2 bg-pink-100 text-pink-700 rounded-full text-[10px] font-black">
                      HOT
                    </span>
                  )}
                </button>
              </div>

              {portalTab === 'COMBOS' ? (
                /* Combos Stall Grid */
                combosWithStallStock.length === 0 ? (
                  <div className="bg-white p-8 rounded-xl border border-slate-200 text-center space-y-3">
                    <div className="w-10 h-10 rounded-full bg-pink-50 text-pink-600 flex items-center justify-center mx-auto">
                      <Gift className="w-5 h-5" />
                    </div>
                    <h3 className="text-xs font-bold text-slate-800">No active combo offers for this stall</h3>
                    <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                      There are currently no active combo deals mapped to this event. You can create combos in the Combos page or sell normal products.
                    </p>
                    <Link
                      to={`/combos?action=create&eventId=${selectedEventId}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Create Combo Offer</span>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-bold text-slate-700">Available Stall Bundles</span>
                      <Link
                        to={`/combos?action=create&eventId=${selectedEventId}`}
                        className="text-xs font-bold text-pink-600 hover:text-pink-700 flex items-center gap-1 hover:underline"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Create Combo Offer</span>
                      </Link>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {combosWithStallStock.map(combo => {
                      const isOutOfStock = combo.isOutOfStock;
                      const inCart = cart.find(c => c.comboId === combo.id);
                      return (
                        <div
                          key={combo.id}
                          className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all select-none relative ${
                            isOutOfStock
                              ? 'border-slate-200 bg-slate-100/70 opacity-60'
                              : inCart
                              ? 'border-pink-500 bg-pink-50/50 shadow-xs ring-1 ring-pink-500'
                              : 'border-slate-200 hover:border-pink-300 bg-white hover:shadow-xs'
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 uppercase tracking-wider">
                                {combo.comboType === 'PICK_ANY' ? `Pick Any ${combo.minItems || 3}` : combo.comboType.replace('_', ' ')}
                              </span>
                              {combo.savings > 0 && (
                                <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                                  Save ₹{combo.savings}
                                </span>
                              )}
                            </div>

                            <div>
                              <h4 className="text-xs font-bold text-slate-900 leading-snug">
                                {combo.name}
                              </h4>
                              {combo.description && (
                                <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">
                                  {combo.description}
                                </p>
                              )}
                            </div>

                            <div className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100 space-y-1">
                              {combo.items.map((ci, idx) => (
                                <div key={idx} className="flex items-center justify-between">
                                  <span className="truncate">
                                    {ci.quantity}× {ci.productName}
                                  </span>
                                  {ci.availableStock !== undefined && (
                                    <span className="text-slate-400 font-mono text-[9px]">
                                      {ci.availableStock} in stall
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="pt-2.5 mt-2 border-t border-slate-100 flex items-end justify-between gap-2">
                            <div>
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-sm font-black text-pink-700">
                                  ₹{combo.price}
                                </span>
                                {combo.normalValue && combo.normalValue > combo.price && (
                                  <span className="text-[10px] text-slate-400 line-through">
                                    ₹{combo.normalValue}
                                  </span>
                                )}
                              </div>
                              <div className="text-[9px] font-medium text-slate-400">
                                {isOutOfStock ? 'Sold out in stall' : `${combo.availableStock} bundle(s) left`}
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={isOutOfStock || isEventEnded || isEventUpcoming}
                              onClick={() => {
                                if (combo.comboType === 'PICK_ANY') {
                                  setPickingCombo(combo);
                                  setPickSelectedMap({});
                                } else {
                                  handleAddComboToCart(combo);
                                }
                              }}
                              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1 active:scale-95 cursor-pointer ${
                                isOutOfStock
                                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white shadow-xs'
                              }`}
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>{combo.comboType === 'PICK_ANY' ? 'Choose & Add' : '+ Add to Bill'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
              ) : (
                <>
                  {/* Product Controls: Project Filter Tabs + Search Input */}
                  <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs space-y-2.5">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      {/* 2. Project Filter Tabs */}
                      <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 shrink-0 overflow-x-auto">
                        <button
                          type="button"
                      onClick={() => setSelectedProject('ALL')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer shrink-0 ${
                        selectedProject === 'ALL'
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                      }`}
                    >
                      ALL ({allocations.length})
                    </button>
                    {availableProjects.map(proj => {
                      const count = allocations.filter(
                        a => (a.projectName || '').toUpperCase() === proj.toUpperCase()
                      ).length;
                      const isSelected = selectedProject.toUpperCase() === proj.toUpperCase();
                      return (
                        <button
                          key={proj}
                          type="button"
                          onClick={() => setSelectedProject(proj)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer uppercase shrink-0 ${
                            isSelected
                              ? 'bg-slate-900 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                          }`}
                        >
                          {proj} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {/* 3. Product Search Bar */}
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search products... (Press / to focus)"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (sortedAllocations.length > 0) {
                            handleAddToCart(sortedAllocations[0]);
                          }
                        }
                      }}
                      className="w-full text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-lg py-2 pl-9 pr-14 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-900 transition-colors min-h-[36px]"
                    />
                    {searchQuery ? (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 absolute right-2.5 top-1/2 -translate-y-1/2 rounded cursor-pointer"
                        title="Clear search (Esc)"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <kbd className="hidden sm:inline-flex items-center justify-center absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white border border-slate-200 rounded">
                        /
                      </kbd>
                    )}
                  </div>
                </div>

                {/* 5. Quick Sell / Frequent Products */}
                {quickSellProducts.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                    <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
                      <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
                      Quick Sell:
                    </span>
                    {quickSellProducts.map(p => {
                      const inCart = cart.find(c => c.productId === p.productId);
                      return (
                        <button
                          key={p.productId}
                          type="button"
                          disabled={isEventEnded || isEventUpcoming || p.remainingQty <= 0}
                          onClick={() => handleAddToCart(p)}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-md border shrink-0 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                            inCart
                              ? 'bg-emerald-50 border-emerald-400 text-emerald-900 font-bold'
                              : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-2xs'
                          }`}
                        >
                          <span>{p.productName}</span>
                          <span className="text-emerald-700 font-bold">₹{Number(p.priceAtEvent).toFixed(0)}</span>
                          {inCart && (
                            <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[9px] flex items-center justify-center font-black">
                              {inCart.quantity}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Status Header: Count & Filter feedback */}
              <div className="flex items-center justify-between px-1 text-[11px] text-slate-500">
                <div>
                  {isFilterActive ? (
                    <span>
                      Showing <strong>{sortedAllocations.length}</strong> of {allocations.length} products
                    </span>
                  ) : (
                    <span>
                      <strong>{allocations.length}</strong> products available
                    </span>
                  )}
                </div>
                {isFilterActive && (
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    <span>Reset filter & search</span>
                  </button>
                )}
              </div>

              {/* 4. Compact POS Product Cards Grid */}
              {sortedAllocations.length === 0 ? (
                <div className="bg-white p-8 rounded-xl border border-slate-200 text-center space-y-2">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                    <Search className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-bold text-slate-800">No products found</h3>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                    Try another search term or clear the project filter.
                  </p>
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    <span>Clear filters</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-2.5">
                  {sortedAllocations.map(item => {
                    const inCartItem = cart.find(c => c.productId === item.productId);
                    const inCartQty = inCartItem ? inCartItem.quantity : 0;
                    const isOutOfStock = item.remainingQty <= 0;

                    return (
                      <div
                        key={item.productId}
                        onClick={() => {
                          if (!isOutOfStock && !isEventEnded && !isEventUpcoming) {
                            handleAddToCart(item);
                          }
                        }}
                        className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all select-none relative ${
                          isOutOfStock
                            ? 'border-slate-200 bg-slate-100/70 opacity-60 cursor-not-allowed'
                            : isEventEnded || isEventUpcoming
                            ? 'border-slate-200 bg-white opacity-80 cursor-not-allowed'
                            : inCartQty > 0
                            ? 'border-emerald-500 bg-emerald-50/40 hover:border-emerald-600 hover:bg-emerald-50/70 shadow-2xs cursor-pointer ring-1 ring-emerald-500/30'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50 shadow-2xs cursor-pointer active:scale-[0.98]'
                        }`}
                      >
                        <div>
                          {/* Code & Project */}
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="font-mono text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                              {item.productId}
                            </span>
                            <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wide truncate max-w-[80px]">
                              {item.projectName}
                            </span>
                          </div>

                          {/* Product Name */}
                          <div className="text-xs font-bold text-slate-900 line-clamp-1 leading-snug" title={item.productName}>
                            {item.productName}
                          </div>
                        </div>

                        {/* Price, Stock & Action */}
                        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-end justify-between gap-1">
                          <div>
                            <div className="text-sm font-black text-slate-900 leading-none">
                              ₹{Number(item.priceAtEvent).toFixed(0)}
                            </div>
                            <div className="text-[10px] mt-0.5">
                              {isOutOfStock ? (
                                <span className="text-rose-600 font-bold">0 left</span>
                              ) : item.remainingQty <= 5 ? (
                                <span className="text-amber-600 font-bold">{item.remainingQty} left</span>
                              ) : (
                                <span className="text-slate-500">{item.remainingQty} left</span>
                              )}
                            </div>
                          </div>

                          {/* Add button / In-Cart indicator */}
                          {isOutOfStock ? (
                            <span className="text-[9px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded">
                              OUT
                            </span>
                          ) : inCartQty > 0 ? (
                            <div
                              className="flex items-center border border-emerald-600 rounded-lg bg-emerald-600 text-white overflow-hidden shadow-2xs"
                              onClick={e => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => handleUpdateQuantity(item.productId, -1)}
                                className="w-5 h-5 flex items-center justify-center hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
                                title="Decrease"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="px-1 text-center text-[11px] font-black min-w-[18px] select-none">
                                {inCartQty}
                              </span>
                              <button
                                type="button"
                                disabled={inCartQty >= item.remainingQty}
                                onClick={() => handleAddToCart(item)}
                                className="w-5 h-5 flex items-center justify-center hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40 transition-colors"
                                title="Increase"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={isEventEnded || isEventUpcoming}
                              onClick={e => {
                                e.stopPropagation();
                                handleAddToCart(item);
                              }}
                              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg flex items-center gap-0.5 shadow-2xs transition-colors cursor-pointer"
                            >
                              <Plus className="w-3 h-3 stroke-[2.5]" />
                              <span>ADD</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

            {/* RIGHT AREA: Current Customer Bill / Cart Panel */}
            <div id="pos-bill-panel" className="lg:col-span-5 xl:col-span-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm sticky top-3 space-y-3">
                {/* 8. Bill Header */}
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-emerald-600" />
                    <h2 className="text-sm font-black tracking-tight text-slate-900 uppercase">
                      Current Bill
                    </h2>
                    <span className="font-mono text-[10px] text-slate-400 font-semibold uppercase">
                      POS Terminal
                    </span>
                  </div>

                  {cart.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearCart}
                      className="text-[11px] font-semibold text-slate-400 hover:text-rose-600 transition-colors cursor-pointer flex items-center gap-1"
                      title="Clear bill"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>

                {/* Bill Line Items */}
                {cart.length === 0 ? (
                  <div className="py-10 px-2 text-center text-slate-400 border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
                    <ShoppingBag className="w-7 h-7 mx-auto mb-1.5 text-slate-300 stroke-1" />
                    <p className="text-xs font-bold text-slate-600">Add products to start a sale</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 max-w-[200px] mx-auto">
                      Click any product on the left to add items to this customer&apos;s bill.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-[280px] overflow-y-auto pr-1">
                    {cart.map(item => (
                      <div key={item.productId} className="py-2 flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate flex items-center gap-1.5">
                            {item.isCombo && (
                              <span className="px-1.5 py-0.2 bg-pink-100 text-pink-700 text-[10px] font-black rounded shrink-0">
                                🎁 COMBO
                              </span>
                            )}
                            <span className="truncate">{item.productName}</span>
                          </div>
                          {item.isCombo && item.components && (
                            <div className="text-[10px] text-pink-700 font-medium truncate mt-0.5">
                              Includes: {item.components.map(c => `${c.quantity}× ${c.productName}`).join(', ')}
                            </div>
                          )}
                          <div className="text-[10px] text-slate-500">
                            ₹{item.priceAtEvent.toFixed(0)} each {item.savings ? `(Save ₹${item.savings})` : ''} &bull; {item.isCombo ? 'Combo bundle' : `Stock: ${item.remainingStock}`}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* 7. Quantity Stepper Controls */}
                          <div className="flex items-center border border-slate-200 rounded bg-slate-50 overflow-hidden">
                            <button
                              type="button"
                              disabled={item.quantity <= 1}
                              onClick={() => handleUpdateQuantity(item.productId, -1)}
                              className="w-6 h-6 flex items-center justify-center text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-slate-50 transition-colors cursor-pointer"
                              title="Decrease quantity"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-6 text-center text-xs font-bold text-slate-900 select-none">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              disabled={item.quantity >= item.remainingStock}
                              onClick={() => handleUpdateQuantity(item.productId, 1)}
                              className="w-6 h-6 flex items-center justify-center text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-slate-50 transition-colors cursor-pointer"
                              title={item.quantity >= item.remainingStock ? 'Max available stock reached' : 'Increase quantity'}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Line total */}
                          <div className="w-12 text-right font-black text-xs text-slate-900">
                            ₹{(item.priceAtEvent * item.quantity).toFixed(0)}
                          </div>

                          {/* Delete icon */}
                          <button
                            type="button"
                            onClick={() => handleRemoveFromCart(item.productId)}
                            className="p-1 text-slate-300 hover:text-rose-600 transition-colors cursor-pointer"
                            title="Remove item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 9. Expandable Customer Details */}
                <div className="pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowCustomerDetails(!showCustomerDetails)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 flex items-center justify-between w-full cursor-pointer py-0.5"
                  >
                    <span>{showCustomerDetails ? '− Hide' : '+ Customer Details (Optional)'}</span>
                    {(customerName || customerPhone) && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded">
                        ✓ Added
                      </span>
                    )}
                  </button>
                  {showCustomerDetails && (
                    <div className="mt-2 space-y-1.5 animate-fadeIn">
                      <div className="relative">
                        <UserIcon className="w-3 h-3 text-slate-400 absolute left-2.5 top-2.5" />
                        <input
                          type="text"
                          placeholder="Customer Name (Optional)"
                          value={customerName}
                          onChange={e => setCustomerName(e.target.value)}
                          className="w-full text-xs pl-7 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                      </div>
                      <div className="relative">
                        <Phone className="w-3 h-3 text-slate-400 absolute left-2.5 top-2.5" />
                        <input
                          type="tel"
                          placeholder="Phone / WhatsApp (Optional)"
                          value={customerPhone}
                          onChange={e => setCustomerPhone(e.target.value)}
                          className="w-full text-xs pl-7 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 10. Payment Flow (Only shown when bill has items) */}
                {cart.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 space-y-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Payment Mode
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('UPI')}
                        className={`py-2 px-1 text-xs font-bold rounded-lg border flex items-center justify-center gap-1 transition-all cursor-pointer ${
                          paymentMethod === 'UPI'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>UPI</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('CASH')}
                        className={`py-2 px-1 text-xs font-bold rounded-lg border flex items-center justify-center gap-1 transition-all cursor-pointer ${
                          paymentMethod === 'CASH'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        <span>CASH</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('CASH_UPI')}
                        className={`py-2 px-1 text-xs font-bold rounded-lg border flex items-center justify-center gap-1 transition-all cursor-pointer ${
                          paymentMethod === 'CASH_UPI'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span>CASH + UPI</span>
                      </button>
                    </div>

                    {/* 11. Cash + UPI Split Section */}
                    {paymentMethod === 'CASH_UPI' && (
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2 animate-fadeIn">
                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                          <span>Split Amounts</span>
                          <span className="text-[10px] text-slate-500 font-normal">Must equal ₹{totalAmount.toFixed(0)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="flex items-center justify-between text-[10px] text-slate-600 mb-0.5">
                              <span>Cash (₹)</span>
                              <button
                                type="button"
                                onClick={() => setSplitCash(Math.max(0, Math.round((totalAmount - upiNum) * 100) / 100).toString())}
                                className="text-indigo-600 hover:underline font-semibold cursor-pointer text-[9px]"
                              >
                                Fill
                              </button>
                            </div>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={splitCash}
                              onChange={e => setSplitCash(e.target.value)}
                              className="w-full px-2 py-1 text-xs font-bold bg-white border border-slate-300 rounded focus:ring-1 focus:ring-slate-900"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between text-[10px] text-slate-600 mb-0.5">
                              <span>UPI (₹)</span>
                              <button
                                type="button"
                                onClick={() => setSplitUpi(Math.max(0, Math.round((totalAmount - cashNum) * 100) / 100).toString())}
                                className="text-indigo-600 hover:underline font-semibold cursor-pointer text-[9px]"
                              >
                                Fill
                              </button>
                            </div>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={splitUpi}
                              onChange={e => setSplitUpi(e.target.value)}
                              className="w-full px-2 py-1 text-xs font-bold bg-white border border-slate-300 rounded focus:ring-1 focus:ring-slate-900"
                            />
                          </div>
                        </div>

                        {/* Real-time Status */}
                        <div className="text-[11px] font-semibold pt-1 border-t border-slate-200">
                          {Math.abs(splitRemaining) < 0.01 && (splitCash.trim() !== '' || splitUpi.trim() !== '') ? (
                            <span className="text-emerald-700 flex items-center gap-1">
                              <Check className="w-3.5 h-3.5 text-emerald-600" /> Payment balanced
                            </span>
                          ) : splitRemaining > 0 ? (
                            <span className="text-amber-700 flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Underpaid by ₹{splitRemaining.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-rose-700 flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5 text-rose-600" /> Overpaid by ₹{(-splitRemaining).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 12. Bill Summary & Complete Sale Button */}
                <div className="pt-2.5 border-t border-slate-200 space-y-2.5">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Total Bill
                      </span>
                      <span className="text-xs text-slate-500 font-medium">
                        {cart.length} {cart.length === 1 ? 'product' : 'products'} &bull; {totalUnits} {totalUnits === 1 ? 'unit' : 'units'}
                      </span>
                    </div>
                    <div className="text-2xl font-black text-slate-900 tracking-tight">
                      ₹{totalAmount.toFixed(0)}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={
                      cart.length === 0 ||
                      isSubmitting ||
                      isEventEnded ||
                      isEventUpcoming ||
                      (paymentMethod === 'CASH_UPI' && !isSplitValid)
                    }
                    onClick={() => handleSubmitOrder()}
                    className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-black text-sm rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-[0.99]"
                  >
                    <Receipt className="w-4 h-4" />
                    <span>
                      {isSubmitting
                        ? 'RECORDING SALE...'
                        : isEventEnded
                        ? 'EVENT ENDED'
                        : isEventUpcoming
                        ? 'NOT STARTED'
                        : cart.length === 0
                        ? 'ADD PRODUCTS TO SELL'
                        : paymentMethod === 'CASH_UPI' && !isSplitValid
                        ? splitRemaining > 0
                          ? `UNDERPAID BY ₹${splitRemaining.toFixed(0)}`
                          : `OVERPAID BY ₹${(-splitRemaining).toFixed(0)}`
                        : `COMPLETE SALE • ₹${totalAmount.toFixed(0)}`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Sticky Bottom Checkout Bar */}
      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 py-2.5 shadow-xl flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] text-slate-500 font-medium">
              {totalUnits} {totalUnits === 1 ? 'item' : 'items'} in bill
            </div>
            <div className="text-lg font-black text-slate-900 leading-tight">
              ₹{totalAmount.toFixed(0)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              document.getElementById('pos-bill-panel')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow-sm flex items-center gap-1.5 active:scale-95"
          >
            <span>Review & Pay</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Detailed Receipt Modal (Accessible via 'View Full' link in fast success banner) */}
      {showReceiptModal && lastCompletedBill && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 border border-slate-200 animate-fadeIn space-y-4">
            <div className="text-center pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">Sale Receipt</h3>
              <p className="text-[11px] text-slate-500">
                {lastCompletedBill.syncedImmediately ? '✓ Synced to database' : '✓ Saved to offline queue'}
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2.5">
              <div className="flex justify-between font-mono text-[11px] text-slate-500 pb-2 border-b border-slate-200">
                <span className="font-bold text-slate-800">{lastCompletedBill.billNo}</span>
                <span>{lastCompletedBill.time}</span>
              </div>
              <div className="space-y-1 text-[11px]">
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
                  <span className="font-bold text-slate-800">
                    {lastCompletedBill.paymentMethod === 'CASH_UPI' ? 'Cash + UPI' : lastCompletedBill.paymentMethod}
                  </span>
                </div>
                {lastCompletedBill.paymentMethod === 'CASH_UPI' && (
                  <div className="flex justify-between text-[10px] text-slate-600 bg-slate-100 px-2 py-1 rounded">
                    <span>Cash: <strong>₹{(lastCompletedBill.cashAmount ?? 0).toFixed(2)}</strong></span>
                    <span>UPI: <strong>₹{(lastCompletedBill.upiAmount ?? 0).toFixed(2)}</strong></span>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-200 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Purchased Items
                </div>
                {lastCompletedBill.items.map(i => (
                  <div key={i.productId} className="flex justify-between text-slate-700">
                    <span className="truncate mr-2">
                      {i.quantity}x {i.productName}
                    </span>
                    <span className="font-bold text-slate-900 shrink-0">
                      ₹{(i.priceAtEvent * i.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-slate-300 flex justify-between font-bold text-sm text-slate-900">
                <span>Total Paid:</span>
                <span className="text-emerald-700">₹{lastCompletedBill.totalAmount.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCopyReceipt}
                className="flex-1 py-2 px-3 border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedReceipt ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copied!</span>
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
                onClick={() => setShowReceiptModal(false)}
                className="py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* PICK ANY COMBO CUSTOMIZATION MODAL */}
      {pickingCombo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-pink-100 text-pink-600 rounded-xl">
                  <Gift className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{pickingCombo.name}</h3>
                  <p className="text-xs text-slate-500">
                    Pick exactly {pickingCombo.minItems || 3} items for ₹{pickingCombo.price}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPickingCombo(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Allowed Products Selection */}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {(pickingCombo.items.length > 0
                ? pickingCombo.items.map(ci => ({ productId: ci.productId, productName: ci.productName }))
                : allocations.map(a => ({ productId: a.productId, productName: a.productName }))
              ).map(item => {
                const alloc = allocations.find(a => a.productId === item.productId);
                const maxStock = alloc ? alloc.remainingQty : 0;
                const selectedCount = pickSelectedMap[item.productId] || 0;

                return (
                  <div key={item.productId} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                    <div>
                      <div className="font-bold text-slate-900">{item.productName}</div>
                      <div className="text-[10px] text-slate-400">Available in stall: {maxStock}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={selectedCount <= 0}
                        onClick={() => setPickSelectedMap(prev => ({ ...prev, [item.productId]: Math.max(0, (prev[item.productId] || 0) - 1) }))}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-300 flex items-center justify-center font-bold disabled:opacity-40 hover:bg-slate-100 cursor-pointer"
                      >
                        -
                      </button>
                      <span className="w-6 text-center font-black text-slate-900 text-sm">{selectedCount}</span>
                      <button
                        type="button"
                        disabled={selectedCount >= maxStock}
                        onClick={() => setPickSelectedMap(prev => ({ ...prev, [item.productId]: (prev[item.productId] || 0) + 1 }))}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-300 flex items-center justify-center font-bold disabled:opacity-40 hover:bg-slate-100 cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total picked progress */}
            {(() => {
              const currentTotal = Object.values(pickSelectedMap).reduce((a, b) => a + b, 0);
              const targetTotal = pickingCombo.minItems || 3;
              const isMatch = currentTotal === targetTotal;
              return (
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="text-xs">
                    <span className="text-slate-500">Selected: </span>
                    <strong className={isMatch ? 'text-emerald-700 font-extrabold' : 'text-amber-700 font-bold'}>
                      {currentTotal} / {targetTotal} items
                    </strong>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPickingCombo(null)}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!isMatch}
                      onClick={() => {
                        const customComponents = Object.entries(pickSelectedMap)
                          .filter(([_, q]) => q > 0)
                          .map(([pId, q]) => {
                            const alloc = allocations.find(a => a.productId === pId);
                            return {
                              productId: pId,
                              productName: alloc?.productName || pId,
                              quantity: q,
                            };
                          });
                        handleAddComboToCart(pickingCombo, customComponents);
                        setPickingCombo(null);
                      }}
                      className="px-4 py-1.5 text-xs font-bold bg-pink-600 hover:bg-pink-700 disabled:opacity-40 text-white rounded-lg transition-all shadow-xs cursor-pointer"
                    >
                      Add Bundle to Bill
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
export default MemberSalePortalPage;
