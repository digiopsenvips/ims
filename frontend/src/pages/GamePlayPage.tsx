import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';

export const GamePlayPage: React.FC = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [games, setGames] = useState<Game[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string>(searchParams.get('gameId') || '');
  const [selectedEventId, setSelectedEventId] = useState<string>(searchParams.get('eventId') || '');

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
        if (!selectedEventId && eventsRes.events.length > 0) {
          const now = Date.now();
          const activeEv =
            eventsRes.events.find(
              (e: AppEvent) => e.status === 'ACTIVE' && now < new Date(e.endDatetime).getTime()
            ) ||
            eventsRes.events.find((e: AppEvent) => e.status === 'ACTIVE') ||
            eventsRes.events.find(
              (e: AppEvent) => e.status !== 'ENDED' && now < new Date(e.endDatetime).getTime()
            ) ||
            eventsRes.events[0];
          setSelectedEventId(activeEv?.id || '');
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
      api.get('/games?status=ACTIVE').then(res => {
        if (res?.games) setGames(res.games);
      });
    };
    socket.on('inventory:updated', handleUpdate);
    socket.on('game:updated', handleUpdate);

    return () => {
      socket.off('inventory:updated', handleUpdate);
      socket.off('game:updated', handleUpdate);
    };
  }, [socket]);

  const currentGame = games.find(g => g.id === selectedGameId);
  const currentEvent = events.find(e => e.id === selectedEventId);

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

  const isRewardOutOfStock = targetReward ? targetReward.isOutOfStock : false;

  // Handle final reward issuance
  const handleIssueReward = async () => {
    if (!currentGame || !currentEvent || !recordedResult) return;
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
    <div className="max-w-xl mx-auto px-2 sm:px-4 py-2 sm:py-3 space-y-4 pb-20">
      {/* 1. Terminal Top Bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 shadow-xs flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center font-black text-sm tracking-tight shrink-0 shadow-xs">
            🎮
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                Game Play Terminal
              </h1>
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.2 rounded">
                Live Stall
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Operator: <strong className="text-slate-700">{user?.name}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/sales-entry"
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
          >
            ← POS
          </Link>
          <Link
            to="/games"
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
          >
            Manage
          </Link>
        </div>
      </div>

      {/* 2. SUCCESS RECEIPT VIEW (When game is finished) */}
      {completedReceipt ? (
        <div className="bg-white border-2 border-emerald-500 rounded-2xl p-5 sm:p-6 shadow-lg space-y-4 animate-fadeIn">
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
        /* 3. ACTIVE GAME PLAY CONTROLLER */
        <div className="space-y-4">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Step 1 & 2: Select Stall & Game */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Stall Selector */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Step 1: Stall / Event
                </label>
                <div className="relative">
                  <select
                    value={selectedEventId}
                    onChange={e => setSelectedEventId(e.target.value)}
                    className="w-full text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg p-2.5 pr-8 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer appearance-none"
                  >
                    {events.map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} ({ev.status})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Game Selector */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Step 2: Game
                </label>
                <div className="relative">
                  <select
                    value={selectedGameId}
                    onChange={e => {
                      setSelectedGameId(e.target.value);
                      setRecordedResult(null);
                    }}
                    className="w-full text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg p-2.5 pr-8 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer appearance-none"
                  >
                    {games.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.name} &bull; ₹{g.entryFee} / play
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Current Game Overview Card */}
            {currentGame && (
              <div className="bg-purple-50/70 border border-purple-200 rounded-xl p-3.5 flex items-center justify-between">
                <div>
                  <div className="text-sm font-black text-purple-950 flex items-center gap-1.5">
                    <span>🎯 {currentGame.name}</span>
                    <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-1.5 py-0.2 rounded">
                      {currentGame.projectName || 'Enactus'}
                    </span>
                  </div>
                  <div className="text-xs text-purple-800 mt-1 space-y-0.5">
                    <div>
                      🏆 <strong>WIN:</strong> {currentGame.winReward.productName} × {currentGame.winReward.quantity}{' '}
                      <span className="text-[10px] font-semibold text-slate-500">
                        (Stock: {currentGame.winReward.availableStock})
                      </span>
                    </div>
                    {currentGame.loseReward && (
                      <div>
                        ❌ <strong>LOSE:</strong> {currentGame.loseReward.productName} × {currentGame.loseReward.quantity}{' '}
                        <span className="text-[10px] font-semibold text-slate-500">
                          (Stock: {currentGame.loseReward.availableStock})
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-[10px] font-bold text-purple-600 uppercase">Entry Fee</div>
                  <div className="text-2xl font-black text-purple-950 leading-tight">
                    ₹{currentGame.entryFee}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Payment Method */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Step 3: Collect Entry Fee (₹{entryFee})
              </label>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Payment: {paymentMethod === 'CASH_UPI' ? 'Cash + UPI' : paymentMethod}
              </span>
            </div>

            {/* Payment buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('UPI')}
                className={`py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                  paymentMethod === 'UPI'
                    ? 'border-purple-600 bg-purple-50 text-purple-900 shadow-xs'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <CreditCard className="w-4 h-4 text-purple-600" />
                <span>UPI</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CASH')}
                className={`py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                  paymentMethod === 'CASH'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-xs'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <Banknote className="w-4 h-4 text-emerald-600" />
                <span>CASH</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CASH_UPI')}
                className={`py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                  paymentMethod === 'CASH_UPI'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-xs'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1">
                  <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-[10px] text-slate-400">+</span>
                  <CreditCard className="w-3.5 h-3.5 text-purple-600" />
                </div>
                <span>SPLIT</span>
              </button>
            </div>

            {/* Split inputs if CASH_UPI selected */}
            {paymentMethod === 'CASH_UPI' && (
              <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      Cash Amount (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={splitCash}
                      onChange={e => setSplitCash(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded-lg font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      UPI Amount (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={splitUpi}
                      onChange={e => setSplitUpi(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded-lg font-bold bg-white"
                    />
                  </div>
                </div>

                <div className="text-[11px] font-semibold flex justify-between items-center pt-1 border-t border-blue-200/80">
                  <span>Paid: ₹{splitTotalPaid} / ₹{entryFee}</span>
                  <span className={isSplitValid ? 'text-emerald-700' : 'text-red-700'}>
                    {isSplitValid ? '✓ Exact match' : `Difference: ₹${splitRemaining.toFixed(2)}`}
                  </span>
                </div>
              </div>
            )}

            {/* Step 4: Optional Customer Details Toggle */}
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCustomerFields(!showCustomerFields)}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
              >
                <span>{showCustomerFields ? '▾ Hide Customer Details' : '▸ + Optional Customer Details'}</span>
              </button>

              {showCustomerFields && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2">
                  <div className="relative">
                    <UserIcon className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                    <input
                      type="text"
                      placeholder="Player Name"
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                      className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                    <input
                      type="tel"
                      placeholder="Player Phone"
                      value={customerPhone}
                      onChange={e => setCustomerPhone(e.target.value)}
                      className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Step 5: Large Physical Outcome Buttons */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
            <div className="text-center">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Step 4: Record Physical Game Result
              </label>
              <div className="text-xs text-slate-500 mt-0.5">
                Customer has played. Cashier records the official outcome.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => setRecordedResult('WIN')}
                className={`py-6 px-3 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer ${
                  recordedResult === 'WIN'
                    ? 'border-amber-500 bg-amber-50 text-amber-950 shadow-md ring-2 ring-amber-400/40'
                    : 'border-slate-200 bg-slate-50 hover:bg-amber-50/50 hover:border-amber-300 text-slate-800'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-2xl shadow-xs">
                  🏆
                </div>
                <div className="text-lg font-black tracking-tight text-amber-950">
                  WIN
                </div>
                <div className="text-[11px] font-bold text-amber-800">
                  {currentGame?.winReward.productName} × {currentGame?.winReward.quantity}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRecordedResult('LOSE')}
                className={`py-6 px-3 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer ${
                  recordedResult === 'LOSE'
                    ? 'border-slate-700 bg-slate-100 text-slate-950 shadow-md ring-2 ring-slate-400/40'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-400 text-slate-800'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-2xl shadow-xs">
                  ❌
                </div>
                <div className="text-lg font-black tracking-tight text-slate-900">
                  LOSE
                </div>
                <div className="text-[11px] font-bold text-slate-700">
                  {currentGame?.loseReward
                    ? `${currentGame.loseReward.productName} × ${currentGame.loseReward.quantity}`
                    : 'Consolation'}
                </div>
              </button>
            </div>
          </div>

          {/* Step 6: Confirmation & Final Issue Reward Button */}
          {recordedResult && (
            <div className="bg-white border-2 border-purple-500 rounded-2xl p-4 sm:p-5 shadow-md space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <div className="text-xs font-bold text-purple-700 uppercase tracking-wider">
                    {recordedResult === 'WIN' ? '🏆 Winner Selected' : '❌ Consolation Selected'}
                  </div>
                  <div className="text-base font-black text-slate-900 mt-0.5">
                    {targetReward?.productName} × {targetReward?.quantity}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Stock Available</div>
                  <div className="text-lg font-black text-slate-900">
                    {targetReward?.availableStock ?? 0}
                  </div>
                </div>
              </div>

              {isRewardOutOfStock ? (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>Cannot issue reward: Product is OUT OF STOCK. Inventory cannot become negative.</span>
                </div>
              ) : null}

              <button
                type="button"
                onClick={handleIssueReward}
                disabled={isSubmitting || isRewardOutOfStock || !isSplitValid}
                className="w-full py-4 px-4 rounded-xl text-sm font-black text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:pointer-events-none shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Deducting Stock & Generating Receipt...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>ISSUE REWARD & CONFIRM (₹{entryFee})</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
