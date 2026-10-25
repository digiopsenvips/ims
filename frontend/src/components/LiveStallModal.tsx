import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { AppEvent } from '../types';
import {
  Store,
  MapPin,
  Clock,
  X,
  ShoppingCart,
  Gamepad2,
  ExternalLink,
  PowerOff,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  TrendingUp,
  PackageCheck,
  Package,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface LiveStallModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeEvent: AppEvent | null;
  onEventUpdated?: () => void;
  initialEventId?: string;
}

function formatISTDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export const LiveStallModal: React.FC<LiveStallModalProps> = ({
  isOpen,
  onClose,
  activeEvent,
  onEventUpdated,
  initialEventId,
}) => {
  const navigate = useNavigate();
  const { user, isDeveloper, isAdmin, isHead, hasPermission } = useAuth();

  const [eventsList, setEventsList] = useState<AppEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [stallDetails, setStallDetails] = useState<AppEvent | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [confirmClose, setConfirmClose] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
    details?: string;
  } | null>(null);

  const canManage = isDeveloper || isAdmin || isHead || hasPermission('edit_events');
  const canViewRevenue =
    isDeveloper || isAdmin || isHead || hasPermission('view_sales_revenue') || hasPermission('view_event_breakdown');

  // Load events and detailed stall info
  const loadStallData = useCallback(async () => {
    if (!isOpen) return;
    setIsLoading(true);
    setStatusMessage(null);
    setConfirmClose(false);

    try {
      const res = await api.get<any>('/events');
      const allEvents: AppEvent[] = Array.isArray(res) ? res : res?.events || [];
      setEventsList(allEvents);

      // Determine current target event ID
      const targetId =
        selectedEventId ||
        activeEvent?.id ||
        allEvents.find(e => e.status === 'ACTIVE')?.id ||
        allEvents[0]?.id ||
        '';

      if (targetId) {
        setSelectedEventId(targetId);
        const detailRes = await api.get<any>(`/events/${targetId}`);
        const eventData = detailRes?.event || detailRes;
        setStallDetails(eventData);
      } else {
        setStallDetails(null);
      }
    } catch (err: any) {
      console.error('Failed to load stall details:', err);
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Failed to fetch authoritative stall details from server.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, activeEvent?.id, initialEventId, selectedEventId]);

  useEffect(() => {
    if (isOpen) {
      const initial = initialEventId || activeEvent?.id || '';
      setSelectedEventId(prev => prev || initial);
      loadStallData();
    } else {
      setSelectedEventId('');
      setStallDetails(null);
    }
  }, [isOpen]);

  // Handle switching selected stall in dropdown
  const handleSelectEvent = async (eventId: string) => {
    setSelectedEventId(eventId);
    setIsLoading(true);
    setStatusMessage(null);
    setConfirmClose(false);
    try {
      const detailRes = await api.get<any>(`/events/${eventId}`);
      const eventData = detailRes?.event || detailRes;
      setStallDetails(eventData);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Failed to fetch selected stall details.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Close stall action
  const handleCloseStall = async () => {
    if (!stallDetails) return;
    setIsActionLoading(true);
    setStatusMessage(null);

    try {
      const res: any = await api.post(`/events/${stallDetails.id}/close`);
      const returnedSummary = res?.returnedItems?.length
        ? `${res.returnedItems.length} product(s) returned to main inventory.`
        : 'All unsold inventory reconciled.';

      setStatusMessage({
        type: 'success',
        text: res?.message || `Stall "${stallDetails.name}" successfully closed.`,
        details: returnedSummary,
      });

      setConfirmClose(false);
      onEventUpdated?.();
      await loadStallData();
    } catch (err: any) {
      console.error('Failed to close stall:', err);
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Failed to close stall. Check backend permissions.',
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  // Open / Switch active stall action
  const handleOpenStall = async (eventIdToOpen: string) => {
    setIsActionLoading(true);
    setStatusMessage(null);

    try {
      const res: any = await api.post(`/events/${eventIdToOpen}/open`);
      setStatusMessage({
        type: 'success',
        text: res?.message || 'Stall opened successfully for live transactions.',
      });

      onEventUpdated?.();
      await handleSelectEvent(eventIdToOpen);
    } catch (err: any) {
      console.error('Failed to open stall:', err);
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Failed to open stall.',
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  // Keyboard navigation & accessibility
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isActive = stallDetails?.status === 'ACTIVE';
  const totalAllocated =
    stallDetails?.summary?.totalAllocatedUnits ?? stallDetails?.totalAllocated ?? 0;
  const totalSold = stallDetails?.summary?.totalSoldUnits ?? stallDetails?.totalSold ?? 0;
  const totalRemaining =
    stallDetails?.summary?.totalRemainingUnits ?? stallDetails?.totalRemaining ?? 0;
  const soldPercent =
    totalAllocated > 0 ? Math.min(100, Math.round((totalSold / totalAllocated) * 100)) : 0;
  const totalRevenue = stallDetails?.summary?.totalRevenue ?? stallDetails?.totalRevenue ?? 0;
  const gamesCount =
    stallDetails?.gamesCount ??
    (stallDetails?.games ? stallDetails.games.filter((g: any) => g.status === 'ACTIVE').length : 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-stall-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg my-auto overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-100 text-emerald-800 shadow-2xs">
              <Store className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="live-stall-title" className="text-base font-bold text-slate-900 leading-tight">
                  Live Stall Management
                </h3>
                {isActive && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Authoritative event status, metrics, and operational controls
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            aria-label="Close live stall modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status / Alert Messages */}
        {statusMessage && (
          <div
            className={`px-5 py-3 border-b text-xs flex items-start gap-2.5 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="font-semibold">{statusMessage.text}</p>
              {statusMessage.details && (
                <p className="text-[11px] text-slate-600 mt-0.5">{statusMessage.details}</p>
              )}
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
              <span className="text-xs font-semibold text-slate-600">Loading stall records...</span>
            </div>
          ) : stallDetails ? (
            <>
              {/* Stall Identity Banner */}
              <div className="bg-gradient-to-br from-slate-50 to-slate-100/70 p-4 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Active Event / Stall
                    </span>
                    <h4 className="text-lg font-black text-slate-900 leading-tight">
                      {stallDetails.name}
                    </h4>
                  </div>
                  <span
                    className={`px-2.5 py-1 text-[11px] font-black uppercase tracking-wider rounded-full border shadow-2xs ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : stallDetails.status === 'ENDED'
                        ? 'bg-slate-100 text-slate-600 border-slate-300'
                        : 'bg-blue-50 text-blue-800 border-blue-300'
                    }`}
                  >
                    {stallDetails.status}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 pt-1">
                  <div className="flex items-center gap-1.5 truncate">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate" title={stallDetails.location}>
                      {stallDetails.location || 'Campus / Event Location'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 truncate">
                    <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">
                      {formatISTDateTime(stallDetails.startDatetime)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Real-time Metrics Grid */}
              <div className="grid grid-cols-2 gap-3">
                {/* Units Sold / Deployed */}
                <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span className="font-semibold text-slate-500">Stall Sales</span>
                    <PackageCheck className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-black text-slate-900">{totalSold}</span>
                    <span className="text-xs text-slate-500 font-medium">/ {totalAllocated} sold</span>
                  </div>
                  {/* Progress Bar */}
                  <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${soldPercent}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium mt-1">
                    {soldPercent}% sold • {totalRemaining} remaining
                  </p>
                </div>

                {/* Revenue or Games */}
                {canViewRevenue ? (
                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                      <span className="font-semibold text-slate-500">Stall Revenue</span>
                      <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-black text-emerald-700">
                        ₹{Number(totalRevenue).toFixed(2)}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium mt-2">
                      Total sales & game earnings
                    </p>
                  </div>
                ) : (
                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                      <span className="font-semibold text-slate-500">Active Games</span>
                      <Gamepad2 className="w-3.5 h-3.5 text-purple-600" />
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-black text-slate-900">{gamesCount}</span>
                      <span className="text-xs text-slate-500 font-medium">configured</span>
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium mt-2">
                      Available for customer play
                    </p>
                  </div>
                )}
              </div>

              {/* Quick Operation Links */}
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Fast Operations
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate(`/sales-entry?eventId=${stallDetails.id}`);
                    }}
                    className="flex items-center justify-center gap-2 px-3 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
                  >
                    <ShoppingCart className="w-4 h-4 text-emerald-400" />
                    <span>+ New Sale (POS)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate(`/games/play?eventId=${stallDetails.id}`);
                    }}
                    className="flex items-center justify-center gap-2 px-3 py-2.5 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    <Gamepad2 className="w-4 h-4 text-purple-600" />
                    <span>Play Stall Game</span>
                  </button>
                </div>

                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate(`/events/${stallDetails.id}`);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-slate-400" />
                      View Full Stall Console, Allocations & Products
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>
              </div>

              {/* Stall Lifecycle: Open / Close / Switch */}
              {canManage ? (
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Stall Controls (Head / Admin)
                  </span>

                  {/* Switch Stall Dropdown */}
                  {eventsList.length > 1 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <select
                          value={selectedEventId}
                          onChange={e => handleSelectEvent(e.target.value)}
                          className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        >
                          {eventsList.map(ev => (
                            <option key={ev.id} value={ev.id}>
                              {ev.name} ({ev.status})
                            </option>
                          ))}
                        </select>
                      </div>
                      {stallDetails.status !== 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={() => handleOpenStall(stallDetails.id)}
                          disabled={isActionLoading}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          Make Live
                        </button>
                      )}
                    </div>
                  )}

                  {/* Close Stall Section */}
                  {isActive && (
                    <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                      {!confirmClose ? (
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-bold text-slate-900">Close Live Stall</p>
                            <p className="text-[11px] text-slate-500">
                              Finalizes sales and returns unsold inventory to warehouse
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setConfirmClose(true)}
                            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition-colors shrink-0 cursor-pointer shadow-2xs"
                          >
                            Close Stall
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-start gap-2 text-rose-800 text-xs">
                            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                            <p>
                              <strong>Confirm Stall Closure:</strong> All {totalRemaining} unsold item(s) will be immediately returned to warehouse inventory. This action cannot be undone.
                            </p>
                          </div>
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setConfirmClose(false)}
                              disabled={isActionLoading}
                              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleCloseStall}
                              disabled={isActionLoading}
                              className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 shadow-xs"
                            >
                              {isActionLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
                              Confirm & Close
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500 flex items-start gap-2">
                  <Store className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <p>
                    You are logged in as a <strong>Member</strong>. You can record sales and host games at this stall. Stall lifecycle changes and stock reconciliation are reserved for Event Heads and Admins.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="py-8 text-center text-slate-500 text-xs space-y-3">
              <Store className="w-8 h-8 text-slate-400 mx-auto" />
              <p>No active live stall is currently open.</p>
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate('/events');
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Store className="w-3.5 h-3.5" />
                  <span>Create / Open a Stall</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs text-slate-400">
          <span>ENACTUS VIPS-TC IMS</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-slate-600 hover:text-slate-900 font-medium hover:bg-slate-200/60 rounded-md transition-colors cursor-pointer"
          >
            Dismiss (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
