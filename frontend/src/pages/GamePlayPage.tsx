import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../lib/api';
import { Game, AppEvent, PaymentMethod } from '../types';
import {
  Gamepad2,
  Trophy,
  Frown,
  Check,
  CreditCard,
  Banknote,
  Copy,
  Receipt,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  User as UserIcon,
  Phone,
  ArrowRight,
  ChevronDown,
  Loader2,
  Calendar,
  Layers,
  ChevronLeft,
  Info,
  Building2,
  ShieldCheck,
} from 'lucide-react';

export const GamePlayPage: React.FC = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const storageKey = user?.id ? `enactus_ims_pos_event_${user.id}` : 'enactus_ims_pos_event_guest';

  const [games, setGames] = useState<Game[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string>(searchParams.get('gameId') || '');
  const [selectedEventId, setSelectedEventId] = useState<string>(() => {
    const urlEvent = searchParams.get('eventId');
    if (urlEvent) return urlEvent;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return saved;
    } catch {}
    return '';
  });

  const selectedEventIdRef = useRef<string>(selectedEventId);
  useEffect(() => {
    selectedEventIdRef.current = selectedEventId;
  }, [selectedEventId]);

  const handleSelectEvent = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    selectedEventIdRef.current = eventId;
    try {
      if (eventId) localStorage.setItem(storageKey, eventId);
    } catch {}
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (eventId) next.set('eventId', eventId);
      else next.delete('eventId');
      return next;
    }, { replace: true });
    setRecordedResult(null);
  }, [setSearchParams, storageKey]);

  // Payment State
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [splitCash, setSplitCash] = useState<string>('');
  const [splitUpi, setSplitUpi] = useState<string>('');

  // Customer State
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [showCustomerFields, setShowCustomerFields] = useState<boolean>(false);

  // Result & Execution State
  const [recordedResult, setRecordedResult] = useState<'WIN' | 'LOSE' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Completed Receipt View
  const [completedReceipt, setCompletedReceipt] = useState<any | null>(null);
  const [copiedReceipt, setCopiedReceipt] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load games and active events
  const loadInitialData = async () => {
    try {
      const [gamesRes, eventsRes] = await Promise.all([
        api.get('/games?status=ACTIVE'),
        api.get('/events'),
      ]);

      if (gamesRes?.games) {
        setGames(gamesRes.games);
        if (!selectedGameId && gamesRes.games.length > 0) {
          setSelectedGameId(gamesRes.games[0].id);
        }
      }

      if (eventsRes?.events) {
        setEvents(eventsRes.events);
        const now = Date.now();
        const activeEv = eventsRes.events.find((e: AppEvent) => {
          const isPast = e.status === 'ENDED' || (e.endDatetime && now >= new Date(e.endDatetime).getTime());
          const isUp = e.status === 'UPCOMING' || (e.startDatetime && now < new Date(e.startDatetime).getTime());
          return !isPast && !isUp;
        });

        // Preserve existing selection if valid
        const currentTarget = searchParams.get('eventId') || selectedEventIdRef.current || (() => {
          try { return localStorage.getItem(storageKey); } catch { return null; }
        })();

        if (currentTarget && eventsRes.events.some((e: AppEvent) => e.id === currentTarget)) {
          if (selectedEventIdRef.current !== currentTarget) {
            setSelectedEventId(currentTarget);
            selectedEventIdRef.current = currentTarget;
          }
        } else if (!selectedEventIdRef.current) {
          if (activeEv) {
            setSelectedEventId(activeEv.id);
            selectedEventIdRef.current = activeEv.id;
            try { localStorage.setItem(storageKey, activeEv.id); } catch {}
          } else if (eventsRes.events.length > 0) {
            setSelectedEventId(eventsRes.events[0].id);
            selectedEventIdRef.current = eventsRes.events[0].id;
          }
        }
      }
    } catch (err) {
      console.error('Failed to load play data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Listen for inventory updates via socket to maintain live reward stock
  useEffect(() => {
    if (!socket) return;
    const handleUpdate = () => {
      Promise.all([
        api.get('/games?status=ACTIVE'),
        api.get('/events'),
      ])
        .then(([gamesRes, eventsRes]) => {
          if (gamesRes?.games) setGames(gamesRes.games);
          if (eventsRes?.events) setEvents(eventsRes.events);
        })
        .catch(console.error);
    };
    socket.on('inventory:updated', handleUpdate);
    socket.on('game:updated', handleUpdate);
    socket.on('game:played', handleUpdate);
    socket.on('sale:created', handleUpdate);

    return () => {
      socket.off('inventory:updated', handleUpdate);
      socket.off('game:updated', handleUpdate);
      socket.off('game:played', handleUpdate);
      socket.off('sale:created', handleUpdate);
    };
  }, [socket]);

  const currentGame = games.find(g => g.id === selectedGameId);
  const currentEvent = events.find(e => e.id === selectedEventId);

  const now = Date.now();
  const activeEvents = events.filter(e => {
    const isPast = e.status === 'ENDED' || (e.endDatetime && now >= new Date(e.endDatetime).getTime());
    const isUp = e.status === 'UPCOMING' || (e.startDatetime && now < new Date(e.startDatetime).getTime());
    return !isPast && !isUp;
  });
  const upcomingEvents = events.filter(e => {
    return e.status === 'UPCOMING' || (e.startDatetime && now < new Date(e.startDatetime).getTime() && e.status !== 'ENDED');
  });
  const concludedEvents = events.filter(e => {
    return e.status === 'ENDED' || (e.endDatetime && now >= new Date(e.endDatetime).getTime());
  });

  const isEventEnded = Boolean(
    currentEvent?.status === 'ENDED' ||
      (currentEvent?.endDatetime && Date.now() >= new Date(currentEvent.endDatetime).getTime())
  );
  const isEventUpcoming = Boolean(
    currentEvent?.status === 'UPCOMING' ||
      (currentEvent?.startDatetime && Date.now() < new Date(currentEvent.startDatetime).getTime())
  );

  const entryFee = currentGame?.entryFee ?? 0;

  // Split calculations
  const cashNum = parseFloat(splitCash) || 0;
  const upiNum = parseFloat(splitUpi) || 0;
  const splitTotalPaid = Math.round((cashNum + upiNum) * 100) / 100;
  const splitRemaining = Math.round((entryFee - splitTotalPaid) * 100) / 100;
  const isSplitValid =
    paymentMethod === 'CASH_UPI'
      ? Math.abs(splitRemaining) < 0.01 &&
        cashNum >= 0 &&
        upiNum >= 0 &&
        (splitCash.trim() !== '' || splitUpi.trim() !== '') &&
        entryFee > 0
      : true;

  // Live reward stock calculation for the selected stall/event
  const getLiveStock = (productId?: string, rewardStock?: number, whStock?: number) => {
    if (!productId) return { available: 0, isAllocated: false };
    const alloc = currentEvent?.allocations?.find(a => a.productId === productId);
    if (alloc) {
      return { available: alloc.remainingQty, isAllocated: true };
    }
    return { available: whStock ?? rewardStock ?? 0, isAllocated: false };
  };

  const winLive = getLiveStock(
    currentGame?.winReward.productId,
    currentGame?.winReward.availableStock,
    currentGame?.winReward.warehouseStock
  );
  const loseLive = getLiveStock(
    currentGame?.loseReward?.productId,
    currentGame?.loseReward?.availableStock,
    currentGame?.loseReward?.warehouseStock
  );

  const isWinOutOfStock = currentGame ? winLive.available < currentGame.winReward.quantity : false;
  const isLoseOutOfStock = currentGame?.loseReward ? loseLive.available < currentGame.loseReward.quantity : false;

  // Expected reward depending on recordedResult
  const targetReward =
    recordedResult === 'WIN'
      ? currentGame?.winReward
      : recordedResult === 'LOSE'
      ? currentGame?.loseReward || {
          productId: '',
          productName: 'No consolation reward configured',
          quantity: 0,
          availableStock: 999,
          isLowStock: false,
          isOutOfStock: false,
        }
      : null;

  const isRewardOutOfStock =
    recordedResult === 'WIN'
      ? isWinOutOfStock
      : recordedResult === 'LOSE'
      ? isLoseOutOfStock
      : false;

  // Handle final reward issuance
  const handleIssueReward = async () => {
    if (!currentGame || !currentEvent || !recordedResult) return;
    if (isEventEnded) {
      setErrorMessage('This event has ended and is no longer accepting transactions.');
      return;
    }
    if (isEventUpcoming) {
      setErrorMessage('This event has not started yet.');
      return;
    }
    if (isSubmitting) return; // Prevent double click

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const clientTxId = `game_tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const payload = {
        gameId: currentGame.id,
        eventId: currentEvent.id,
        result: recordedResult,
        paymentMethod,
        cashAmount: paymentMethod === 'CASH_UPI' ? cashNum : paymentMethod === 'CASH' ? entryFee : 0,
        upiAmount: paymentMethod === 'CASH_UPI' ? upiNum : paymentMethod === 'UPI' ? entryFee : 0,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        clientTxId,
      };

      const res = await api.post('/games/play', payload);

      if (res?.receipt) {
        setCompletedReceipt(res.receipt);
      }
    } catch (err: any) {
      console.error('Failed to issue reward:', err);
      setErrorMessage(err.message || 'Failed to record game play. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForNextCustomer = () => {
    setCompletedReceipt(null);
    setRecordedResult(null);
    setCustomerName('');
    setCustomerPhone('');
    setSplitCash('');
    setSplitUpi('');
    setErrorMessage(null);
  };

  const handleCopyReceipt = () => {
    if (!completedReceipt) return;
    const text = [
      `🎮 *Enactus VIPS-TC Game Receipt*`,
      `*Receipt ID:* ${completedReceipt.receiptId}`,
      `*Session ID:* ${completedReceipt.sessionCode}`,
      `*Stall:* ${completedReceipt.eventName}`,
      `*Game:* ${completedReceipt.gameName}`,
      `*Result:* ${completedReceipt.result === 'WIN' ? '🏆 WIN' : '❌ LOSE'}`,
      `*Reward Issued:* ${completedReceipt.rewardDescription}`,
      `*Entry Fee:* ₹${completedReceipt.amountPaid}`,
      `*Payment:* ${completedReceipt.paymentMethod}`,
      `*Cashier:* ${completedReceipt.sellerName}`,
      `*Date/Time:* ${new Date(completedReceipt.timestamp).toLocaleString('en-IN')}`,
      `\nThank you for supporting student social entrepreneurship! 💚`,
    ].join('\n');

    navigator.clipboard.writeText(text);
    setCopiedReceipt(true);
    setTimeout(() => setCopiedReceipt(false), 3000);
  };

  if (isLoading) {
    return (
      <div className="max-w-xl mx-auto p-12 text-center text-slate-400">
        <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-purple-600" />
        <p className="text-sm font-bold">Initializing Game Terminal...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5 pb-20">
      {/* 1. Terminal Top Bar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 flex items-center justify-center font-black shadow-2xs shrink-0">
            <Gamepad2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-tight">
                Game Play Terminal
              </h1>
              {isEventEnded ? (
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  Stall Concluded
                </span>
              ) : isEventUpcoming ? (
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                  Upcoming Stall
                </span>
              ) : (
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Stall
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Operator: <strong className="text-slate-800 font-semibold">{user?.name || 'Cashier'}</strong>
              {user?.department && (
                <span className="text-slate-500"> &bull; Department: <span className="font-medium text-slate-700">{user.department}</span></span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
          <Link
            to={selectedEventId ? `/sales-entry?eventId=${selectedEventId}` : '/sales-entry'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/60 transition-colors cursor-pointer"
            title="Return to POS Sales Entry"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Back to POS</span>
          </Link>
          <Link
            to="/games"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 transition-colors cursor-pointer"
            title="Manage Games Catalog"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Manage Games</span>
          </Link>
        </div>
      </div>

      {/* 2. SUCCESS RECEIPT VIEW (When game is finished) */}
      {completedReceipt ? (
        <div className="max-w-xl mx-auto bg-white border-2 border-emerald-500 rounded-2xl p-6 sm:p-7 shadow-xl space-y-4 animate-fadeIn">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-2 shadow-xs">
              <Check className="w-6 h-6 stroke-[3]" />
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              Transaction Completed
            </div>
            <div className="text-2xl font-black text-slate-900">
              Receipt {completedReceipt.receiptId}
            </div>
            <div className="text-xs font-semibold text-slate-500">
              Session Code: <span className="font-mono text-purple-700 font-bold">{completedReceipt.sessionCode}</span>
            </div>
          </div>

          {/* Receipt Breakdown Card */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2.5 text-xs">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <span className="text-slate-500 font-medium">Game Played:</span>
              <span className="font-bold text-slate-900 text-sm">{completedReceipt.gameName}</span>
            </div>

            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <span className="text-slate-500 font-medium">Physical Result:</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-extrabold uppercase ${
                  completedReceipt.result === 'WIN'
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : 'bg-slate-200 text-slate-800'
                }`}
              >
                {completedReceipt.result === 'WIN' ? '🏆 WINNER' : '❌ PARTICIPATION'}
              </span>
            </div>

            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <span className="text-slate-500 font-medium">Reward Issued:</span>
              <span className="font-black text-purple-900 text-sm">
                🎁 {completedReceipt.rewardDescription}
              </span>
            </div>

            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <span className="text-slate-500 font-medium">Amount Paid:</span>
              <span className="font-black text-emerald-700 text-sm">
                ₹{completedReceipt.amountPaid} ({completedReceipt.paymentMethod})
              </span>
            </div>

            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <span className="text-slate-500 font-medium">Stall / Location:</span>
              <span className="font-semibold text-slate-800">{completedReceipt.eventName}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Cashier / Operator:</span>
              <span className="font-semibold text-slate-800">{completedReceipt.sellerName}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
            <button
              onClick={handleCopyReceipt}
              className="w-full sm:flex-1 py-2.5 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {copiedReceipt ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-700">Copied to Clipboard!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-slate-500" />
                  <span>Share WhatsApp Receipt</span>
                </>
              )}
            </button>

            <button
              onClick={handleResetForNextCustomer}
              className="w-full sm:flex-1 py-2.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Next Game Play</span>
            </button>
          </div>
        </div>
      ) : (
        /* 3. RESPONSIVE TWO-COLUMN CASHIER WORKFLOW (1150px) */
        <div className="lg:grid lg:grid-cols-12 lg:gap-6 space-y-5 lg:space-y-0 items-start">
          {/* LEFT COLUMN: Stall, Game, Info & Payment (7 Cols) */}
          <div className="lg:col-span-7 space-y-4">
            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-center gap-2 animate-fadeIn">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Step 1 & 2: Select Stall & Game */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-2xs space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Stall Selector */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-slate-900 text-white text-[9px] font-black flex items-center justify-center">
                      1
                    </span>
                    <span>Stall / Event</span>
                  </label>
                  <div className="relative">
                    <select
                      value={selectedEventId}
                      onChange={e => {
                        handleSelectEvent(e.target.value);
                      }}
                      className="w-full text-xs font-semibold bg-slate-50 focus:bg-white border border-slate-300 rounded-lg p-2.5 pr-8 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer appearance-none min-h-[38px] transition-colors"
                    >
                      {activeEvents.length > 0 && (
                        <optgroup label="Active Stalls (Open for Play)">
                          {activeEvents.map(ev => (
                            <option key={ev.id} value={ev.id}>
                              🟢 {ev.name} (Live)
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {upcomingEvents.length > 0 && (
                        <optgroup label="Upcoming Stalls">
                          {upcomingEvents.map(ev => (
                            <option key={ev.id} value={ev.id}>
                              ⏳ {ev.name} (Starts {new Date(ev.startDatetime).toLocaleDateString()})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {concludedEvents.length > 0 && (
                        <optgroup label="Concluded Stalls (Read-only)">
                          {concludedEvents.map(ev => (
                            <option key={ev.id} value={ev.id}>
                              🔒 {ev.name} (Ended / Closed)
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* Game Selector */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-slate-900 text-white text-[9px] font-black flex items-center justify-center">
                      2
                    </span>
                    <span>Stall Game</span>
                  </label>
                  <div className="relative">
                    <select
                      value={selectedGameId}
                      onChange={e => {
                        setSelectedGameId(e.target.value);
                        setRecordedResult(null);
                      }}
                      className="w-full text-xs font-semibold bg-slate-50 focus:bg-white border border-slate-300 rounded-lg p-2.5 pr-8 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer appearance-none min-h-[38px] transition-colors"
                    >
                      {games.map(g => (
                        <option key={g.id} value={g.id}>
                          🎯 {g.name} &bull; ₹{g.entryFee}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Closed-Event Warning Alert */}
              {isEventEnded && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl flex items-start justify-between gap-3 animate-fadeIn">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">This stall/event has ended.</span>
                      <p className="text-amber-800 text-[11px] mt-0.5">
                        New game plays and reward deductions are disabled. Select an active event to continue.
                      </p>
                    </div>
                  </div>
                  {activeEvents.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedEventId(activeEvents[0].id)}
                      className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] rounded-lg shrink-0 transition-colors cursor-pointer"
                    >
                      Switch to {activeEvents[0].name}
                    </button>
                  )}
                </div>
              )}

              {/* Upcoming-Event Alert */}
              {isEventUpcoming && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 text-xs rounded-xl flex items-start gap-2.5 animate-fadeIn">
                  <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">This stall/event has not started yet.</span>
                    <p className="text-blue-800 text-[11px] mt-0.5">
                      Game plays cannot be recorded before the scheduled start time.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Current Game Information Card */}
            {currentGame && (
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-2xs space-y-3.5">
                {/* Title & Entry Fee Header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                        🎯 {currentGame.name}
                      </h2>
                      {currentGame.projectName && (
                        <span className="text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded uppercase tracking-wider">
                          Project {currentGame.projectName}
                        </span>
                      )}
                    </div>
                    {currentGame.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {currentGame.description}
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Entry Fee
                    </span>
                    <span className="text-2xl font-black text-slate-900">
                      ₹{currentGame.entryFee}
                    </span>
                  </div>
                </div>

                {/* Two-column Reward Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* WIN Reward */}
                  <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/60 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
                        <Trophy className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>WIN REWARD</span>
                      </div>
                      <div className="text-xs font-semibold text-amber-900 mt-1 truncate" title={currentGame.winReward.productName}>
                        {currentGame.winReward.productName} × {currentGame.winReward.quantity}
                      </div>
                      <div className="text-[10px] text-amber-800/80 font-medium">
                        {winLive.isAllocated ? 'Stall Allocation' : 'Central Warehouse'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Stock</div>
                      <div className="text-sm font-black text-slate-900">
                        {isWinOutOfStock ? (
                          <span className="text-rose-600 text-[10px] font-bold uppercase">Out of Stock</span>
                        ) : winLive.available <= 5 ? (
                          <span className="text-amber-700 text-xs font-bold">{winLive.available}</span>
                        ) : (
                          <span>{winLive.available}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* LOSE Consolation */}
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/80 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                        <Frown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>LOSE CONSOLATION</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-700 mt-1 truncate" title={currentGame.loseReward?.productName || 'None'}>
                        {currentGame.loseReward
                          ? `${currentGame.loseReward.productName} × ${currentGame.loseReward.quantity}`
                          : 'No consolation reward'}
                      </div>
                      {currentGame.loseReward && (
                        <div className="text-[10px] text-slate-500 font-medium">
                          {loseLive.isAllocated ? 'Stall Allocation' : 'Central Warehouse'}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Stock</div>
                      <div className="text-sm font-black text-slate-900">
                        {currentGame.loseReward ? (
                          isLoseOutOfStock ? (
                            <span className="text-rose-600 text-[10px] font-bold uppercase">Out of Stock</span>
                          ) : loseLive.available <= 5 ? (
                            <span className="text-amber-700 text-xs font-bold">{loseLive.available}</span>
                          ) : (
                            <span>{loseLive.available}</span>
                          )
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Payment Method Card */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-2xs space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">
                    3
                  </span>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Collect Entry Fee
                  </h3>
                </div>
                <div className="text-xs font-bold text-slate-900">
                  Amount to Collect: <span className="text-emerald-700 font-black text-sm">₹{entryFee}</span>
                </div>
              </div>

              {/* Payment Method Cards */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <button
                  type="button"
                  disabled={isEventEnded || isEventUpcoming}
                  onClick={() => setPaymentMethod('UPI')}
                  className={`py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    paymentMethod === 'UPI'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                      : 'border-slate-200 bg-slate-50/60 hover:bg-white hover:border-slate-300 text-slate-700'
                  } ${isEventEnded || isEventUpcoming ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <CreditCard className="w-4 h-4" />
                  <span>UPI</span>
                </button>

                <button
                  type="button"
                  disabled={isEventEnded || isEventUpcoming}
                  onClick={() => setPaymentMethod('CASH')}
                  className={`py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    paymentMethod === 'CASH'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                      : 'border-slate-200 bg-slate-50/60 hover:bg-white hover:border-slate-300 text-slate-700'
                  } ${isEventEnded || isEventUpcoming ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Banknote className="w-4 h-4" />
                  <span>CASH</span>
                </button>

                <button
                  type="button"
                  disabled={isEventEnded || isEventUpcoming}
                  onClick={() => setPaymentMethod('CASH_UPI')}
                  className={`py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    paymentMethod === 'CASH_UPI'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                      : 'border-slate-200 bg-slate-50/60 hover:bg-white hover:border-slate-300 text-slate-700'
                  } ${isEventEnded || isEventUpcoming ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-1">
                    <Banknote className="w-3.5 h-3.5" />
                    <span className="text-[10px] text-slate-400">+</span>
                    <CreditCard className="w-3.5 h-3.5" />
                  </div>
                  <span>SPLIT</span>
                </button>
              </div>

              {/* Split Cash + UPI Box */}
              {paymentMethod === 'CASH_UPI' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 animate-fadeIn">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                    <span>Split Amounts</span>
                    <span className="text-[10px] text-slate-500 font-normal">Must equal entry fee ₹{entryFee}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-slate-600 mb-0.5">
                        <span>Cash (₹)</span>
                        <button
                          type="button"
                          onClick={() => setSplitCash(Math.max(0, Math.round((entryFee - upiNum) * 100) / 100).toString())}
                          className="text-indigo-600 hover:underline font-semibold cursor-pointer text-[9px]"
                        >
                          Fill
                        </button>
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={splitCash}
                        onChange={e => setSplitCash(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-bold bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-slate-600 mb-0.5">
                        <span>UPI (₹)</span>
                        <button
                          type="button"
                          onClick={() => setSplitUpi(Math.max(0, Math.round((entryFee - cashNum) * 100) / 100).toString())}
                          className="text-indigo-600 hover:underline font-semibold cursor-pointer text-[9px]"
                        >
                          Fill
                        </button>
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={splitUpi}
                        onChange={e => setSplitUpi(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-bold bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900"
                      />
                    </div>
                  </div>
                  <div className="text-[11px] font-semibold flex items-center justify-between pt-1 border-t border-slate-200">
                    <span>Total Paid: ₹{splitTotalPaid} / ₹{entryFee}</span>
                    {isSplitValid ? (
                      <span className="text-emerald-700 flex items-center gap-1 font-bold">
                        <Check className="w-3.5 h-3.5 text-emerald-600" /> Payment Balanced
                      </span>
                    ) : (
                      <span className="text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Difference: ₹{splitRemaining.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Optional Customer Details Accordion */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCustomerFields(!showCustomerFields)}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center justify-between w-full cursor-pointer py-0.5"
                >
                  <span>{showCustomerFields ? '− Hide Player Details' : '+ Customer / Player Details (Optional)'}</span>
                  {(customerName || customerPhone) && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                      ✓ Added
                    </span>
                  )}
                </button>
                {showCustomerFields && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-1 animate-fadeIn">
                    <div className="relative">
                      <UserIcon className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Player Name (Optional)"
                        value={customerName}
                        onChange={e => setCustomerName(e.target.value)}
                        className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                      />
                    </div>
                    <div className="relative">
                      <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="tel"
                        placeholder="WhatsApp / Phone (Optional)"
                        value={customerPhone}
                        onChange={e => setCustomerPhone(e.target.value)}
                        className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Physical Outcome Selection & Submit Panel (5 Cols) */}
          <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-20">
            {/* Step 4: Record Physical Result Card */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">
                    4
                  </span>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Record Physical Result
                  </h3>
                </div>
                <span className="text-[10px] text-slate-400 font-semibold">Cashier Verified</span>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                Customer plays the physical game at the stall. The volunteer verifies and records the actual outcome below.
              </p>

              {/* Clickable Outcome Cards (Equally Sized, Unclipped) */}
              <div className="grid grid-cols-2 gap-3">
                {/* WIN Card */}
                <button
                  type="button"
                  disabled={isEventEnded || isEventUpcoming || !currentGame}
                  onClick={() => setRecordedResult('WIN')}
                  className={`p-4 rounded-2xl border-2 flex flex-col items-center justify-center text-center gap-2 transition-all cursor-pointer min-h-[145px] ${
                    recordedResult === 'WIN'
                      ? 'border-amber-500 bg-amber-50 text-amber-950 shadow-sm ring-2 ring-amber-400/30'
                      : 'border-slate-200 bg-slate-50/70 hover:bg-amber-50/40 hover:border-amber-300 text-slate-800'
                  } ${isEventEnded || isEventUpcoming ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-200 flex items-center justify-center text-2xl shadow-2xs">
                    🏆
                  </div>
                  <div>
                    <div className="text-base font-black tracking-tight text-amber-950">
                      WIN
                    </div>
                    <div className="text-[11px] font-bold text-amber-900 mt-0.5 line-clamp-1" title={currentGame?.winReward.productName}>
                      {currentGame?.winReward.productName}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {currentGame?.winReward.quantity} unit &bull; Stock: {winLive.available}
                    </div>
                  </div>
                </button>

                {/* LOSE Card */}
                <button
                  type="button"
                  disabled={isEventEnded || isEventUpcoming || !currentGame}
                  onClick={() => setRecordedResult('LOSE')}
                  className={`p-4 rounded-2xl border-2 flex flex-col items-center justify-center text-center gap-2 transition-all cursor-pointer min-h-[145px] ${
                    recordedResult === 'LOSE'
                      ? 'border-slate-800 bg-slate-100 text-slate-950 shadow-sm ring-2 ring-slate-400/30'
                      : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100 hover:border-slate-300 text-slate-800'
                  } ${isEventEnded || isEventUpcoming ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-slate-200 border border-slate-300 flex items-center justify-center text-2xl shadow-2xs">
                    ❌
                  </div>
                  <div>
                    <div className="text-base font-black tracking-tight text-slate-900">
                      LOSE
                    </div>
                    <div className="text-[11px] font-bold text-slate-800 mt-0.5 line-clamp-1" title={currentGame?.loseReward?.productName || 'Consolation'}>
                      {currentGame?.loseReward ? currentGame.loseReward.productName : 'Consolation'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {currentGame?.loseReward
                        ? `${currentGame.loseReward.quantity} unit • Stock: ${loseLive.available}`
                        : 'No reward deducted'}
                    </div>
                  </div>
                </button>
              </div>

              {/* Review & Final Confirmation Container */}
              <div className="pt-3 border-t border-slate-100 space-y-3">
                {/* Summary Strip */}
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-1.5 text-xs">
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Selected Outcome:</span>
                    <span className="font-bold text-slate-900">
                      {recordedResult === 'WIN' ? '🏆 WIN' : recordedResult === 'LOSE' ? '❌ LOSE' : 'Not Selected Yet'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Reward to Issue:</span>
                    <span className="font-bold text-purple-900 truncate max-w-[170px]">
                      {recordedResult ? targetReward?.productName || 'None' : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Payment Method:</span>
                    <span className="font-bold text-slate-900">{paymentMethod}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 pt-1 border-t border-slate-200/80">
                    <span className="font-bold text-slate-800">Total Entry Fee:</span>
                    <span className="font-black text-emerald-700 text-sm">₹{entryFee}</span>
                  </div>
                </div>

                {isRewardOutOfStock && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Selected reward is OUT OF STOCK. Cannot issue.</span>
                  </div>
                )}

                {/* Primary Complete Button (Never Clipped) */}
                <button
                  type="button"
                  onClick={handleIssueReward}
                  disabled={
                    isSubmitting ||
                    !recordedResult ||
                    isRewardOutOfStock ||
                    !isSplitValid ||
                    isEventEnded ||
                    isEventUpcoming ||
                    !currentGame ||
                    !currentEvent
                  }
                  className="w-full py-3.5 px-4 rounded-xl text-sm font-black text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:hover:bg-purple-600 shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>RECORDING TRANSACTION...</span>
                    </>
                  ) : isEventEnded ? (
                    <>
                      <AlertTriangle className="w-4 h-4" />
                      <span>STALL CLOSED (EVENT ENDED)</span>
                    </>
                  ) : isEventUpcoming ? (
                    <>
                      <AlertTriangle className="w-4 h-4" />
                      <span>STALL NOT STARTED YET</span>
                    </>
                  ) : !recordedResult ? (
                    <span>SELECT WIN OR LOSE ABOVE</span>
                  ) : paymentMethod === 'CASH_UPI' && !isSplitValid ? (
                    <span>SPLIT PAYMENT NOT BALANCED</span>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>RECORD GAME PLAY • ₹{entryFee}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Operator Verification Note */}
            <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600 space-y-1">
              <div className="font-bold text-slate-800 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Cashier Checklist</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Ensure entry fee is collected via UPI or Cash before recording the game result. Once submitted, inventory stock is deducted in real time.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
