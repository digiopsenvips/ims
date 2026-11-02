import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type {
  WhatsAppDelivery,
  WhatsAppDeliveryStatus,
  WhatsAppQueueConfig,
  WhatsAppQueueSummary,
  ReconciliationPreviewReport,
} from '../types';
import {
  MessageCircle,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Play,
  Pause,
  RotateCcw,
  Settings,
  Activity,
  Send,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  Eye,
  Ban,
  History,
  ShieldAlert,
  Zap,
  Phone,
  Calendar,
  Info,
  CheckCheck,
  X,
  Edit3,
  Check,
  ExternalLink,
} from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

function maskPhone(phone: string): string {
  if (!phone) return '–';
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) {
    return '+91 ' + digits.slice(-10, -6) + 'XXXX' + digits.slice(-2);
  }
  if (digits.length >= 4) {
    return '****' + digits.slice(-4);
  }
  return phone;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtRelative(iso?: string | null): string {
  if (!iso) return '–';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.max(1, Math.round(diff))}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// ─── Status Badge ────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING:    { label: 'Pending',    color: 'bg-slate-100 text-slate-600 border-slate-300',          icon: <Clock className="w-3 h-3" /> },
  QUEUED:     { label: 'Queued',     color: 'bg-blue-100 text-blue-700 border-blue-300',             icon: <Clock className="w-3 h-3" /> },
  SENDING:    { label: 'Sending',    color: 'bg-amber-100 text-amber-700 border-amber-300',          icon: <Send className="w-3 h-3 animate-pulse" /> },
  SENT:       { label: 'Sent',       color: 'bg-blue-100 text-blue-700 border-blue-300',             icon: <CheckCircle2 className="w-3 h-3" /> },
  DELIVERED:  { label: 'Delivered',  color: 'bg-emerald-100 text-emerald-700 border-emerald-300',    icon: <CheckCheck className="w-3 h-3" /> },
  FAILED:     { label: 'Failed',     color: 'bg-red-100 text-red-700 border-red-300',                icon: <XCircle className="w-3 h-3" /> },
  RETRY_WAIT: { label: 'Retry Wait', color: 'bg-orange-100 text-orange-700 border-orange-300',       icon: <RotateCcw className="w-3 h-3" /> },
  UNKNOWN:    { label: 'Unknown',    color: 'bg-yellow-100 text-yellow-700 border-yellow-300',       icon: <AlertTriangle className="w-3 h-3" /> },
  SKIPPED:    { label: 'Skipped',    color: 'bg-purple-100 text-purple-700 border-purple-300',       icon: <Info className="w-3 h-3" /> },
  CANCELLED:  { label: 'Cancelled',  color: 'bg-slate-100 text-slate-500 border-slate-200',          icon: <Ban className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, color: 'bg-slate-100 text-slate-600 border-slate-200', icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${meta.color}`}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color = 'slate',
  icon,
}: {
  label: string;
  value: number | string;
  sub?: string;
  color?: 'slate' | 'emerald' | 'blue' | 'amber' | 'red' | 'orange' | 'yellow' | 'purple';
  icon: React.ReactNode;
}) {
  const colors = {
    slate:   'bg-slate-50  text-slate-600  border-slate-200',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    blue:    'bg-blue-50   text-blue-600   border-blue-200',
    amber:   'bg-amber-50  text-amber-600  border-amber-200',
    red:     'bg-red-50    text-red-600    border-red-200',
    orange:  'bg-orange-50 text-orange-600 border-orange-200',
    yellow:  'bg-yellow-50 text-yellow-600 border-yellow-200',
    purple:  'bg-purple-50 text-purple-600 border-purple-200',
  };
  return (
    <div className={`rounded-xl border p-3.5 flex flex-col gap-2 ${colors[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</span>
        <span className="opacity-60">{icon}</span>
      </div>
      <div className="text-2xl font-black tracking-tight">{value}</div>
      {sub && <div className="text-[10px] font-medium opacity-60">{sub}</div>}
    </div>
  );
}

// ─── Audit Log Timeline ───────────────────────────────────────────────────────

function AuditTimeline({
  log,
}: {
  log?: Array<{
    ts?: string;
    timestamp?: string;
    action?: string;
    event?: string;
    details?: string;
    detail?: string;
    error?: string;
  }> | null;
}) {
  if (!log || log.length === 0) return <p className="text-xs text-slate-400 italic">No audit events yet.</p>;
  return (
    <div className="space-y-2">
      {[...log].reverse().map((entry, i) => {
        const time = entry.ts || entry.timestamp;
        const action = entry.action || entry.event || 'EVENT';
        const detail = entry.details || entry.detail || entry.error;
        return (
          <div key={i} className="flex gap-2 text-[11px]">
            <div className="shrink-0 w-1.5 h-1.5 mt-1.5 rounded-full bg-slate-400" />
            <div>
              <span className="font-semibold text-slate-700">{action}</span>
              {detail && <span className="text-slate-500 ml-1">— {detail}</span>}
              {time && <div className="text-slate-400">{fmtDate(time)}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Delivery Detail Modal ────────────────────────────────────────────────────

function DeliveryDetailModal({
  delivery,
  onClose,
  onAction,
  onUpdatePhone,
  isDeveloper,
  isAdmin,
}: {
  delivery: WhatsAppDelivery;
  onClose: () => void;
  onAction: (id: string, action: 'retry' | 'cancel' | 'mark_delivered' | 'mark_failed' | 'retry_send') => Promise<void>;
  onUpdatePhone: (id: string, phone: string, customerName?: string) => Promise<void>;
  isDeveloper: boolean;
  isAdmin: boolean;
}) {
  const [acting, setActing] = useState(false);
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState(delivery.customerPhone || '');
  const [nameInput, setNameInput] = useState(delivery.customerName || '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const canOperate = isDeveloper || isAdmin;

  // Check if customer name looks like a 10-digit phone number (e.g. Receipt #386)
  const nameDigits = (delivery.customerName || '').replace(/\D/g, '');
  const nameLooksLikePhone = nameDigits.length === 10;

  const act = async (action: 'retry' | 'cancel' | 'mark_delivered' | 'mark_failed' | 'retry_send') => {
    if (acting) return;
    setActing(true);
    try {
      await onAction(delivery.id, action);
      onClose();
    } finally {
      setActing(false);
    }
  };

  const handleSavePhone = async () => {
    const cleaned = phoneInput.replace(/\D/g, '');
    if (cleaned.length < 10 || cleaned.length > 15) {
      setPhoneError('Please enter a valid 10-15 digit phone number.');
      return;
    }
    setPhoneError(null);
    setActing(true);
    try {
      await onUpdatePhone(delivery.id, phoneInput, nameInput);
      setIsEditingPhone(false);
      onClose();
    } catch (e: any) {
      setPhoneError(e?.message || 'Failed to update phone');
    } finally {
      setActing(false);
    }
  };

  const billSnapshot = (delivery as any).billSnapshot;
  const snapshotItems: Array<{ productName: string; quantity: number; unitPrice: number; lineTotal: number }> =
    billSnapshot?.items || [];

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <MessageCircle className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Receipt #{delivery.receiptNumber}</h3>
              <p className="text-[11px] text-slate-500">WhatsApp Delivery Record</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Status + Meta */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <div className="text-[10px] text-slate-500 font-semibold uppercase mb-1">Status</div>
              <StatusBadge status={delivery.status} />
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <div className="text-[10px] text-slate-500 font-semibold uppercase mb-1">Attempts</div>
              <div className="text-sm font-bold text-slate-900">{delivery.attemptCount}</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <div className="text-[10px] text-slate-500 font-semibold uppercase mb-1">Customer</div>
              <div className="text-xs font-semibold text-slate-900">{delivery.customerName || '–'}</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <div className="text-[10px] text-slate-500 font-semibold uppercase mb-1 flex items-center justify-between">
                <span>Phone</span>
                {canOperate && delivery.status !== 'DELIVERED' && !isEditingPhone && (
                  <button
                    onClick={() => {
                      if (nameLooksLikePhone && !delivery.customerPhone) {
                        setPhoneInput(delivery.customerName || '');
                        setNameInput('Customer');
                      }
                      setIsEditingPhone(true);
                    }}
                    className="text-[10px] text-emerald-600 font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
                  >
                    <Edit3 className="w-2.5 h-2.5" /> Edit
                  </button>
                )}
              </div>
              <div className="text-xs font-mono text-slate-900">{maskPhone(delivery.customerPhone)}</div>
            </div>
          </div>

          {/* Quick Swap Hint for Swapped Name/Phone (e.g. #386) */}
          {nameLooksLikePhone && canOperate && delivery.status !== 'DELIVERED' && !isEditingPhone && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-1.5">
              <div className="font-bold text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Possible Swapped Phone Detected
              </div>
              <p className="text-amber-800 text-[11px]">
                The customer name &quot;{delivery.customerName}&quot; looks like a 10-digit mobile number.
              </p>
              <button
                onClick={() => {
                  setPhoneInput(delivery.customerName || '');
                  setNameInput(delivery.customerPhone || 'Customer');
                  setIsEditingPhone(true);
                }}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-[10px] cursor-pointer"
              >
                Swap Name &amp; Phone ({delivery.customerName})
              </button>
            </div>
          )}

          {/* Inline Phone Editor */}
          {isEditingPhone && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
              <div className="text-xs font-bold text-blue-900 flex items-center justify-between">
                <span>Update Customer Details</span>
                <button onClick={() => setIsEditingPhone(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-slate-600">Customer Name</label>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-600">Mobile Phone</label>
                  <input
                    type="text"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="98XXXXXXXX"
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white font-mono"
                  />
                </div>
              </div>
              {phoneError && <div className="text-[10px] text-red-600 font-bold">{phoneError}</div>}
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => setIsEditingPhone(false)}
                  className="px-2 py-1 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePhone}
                  disabled={acting}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  {acting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Save &amp; Queue Bill
                </button>
              </div>
            </div>
          )}

          {/* Bill Items Snapshot */}
          {snapshotItems.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Commercial Items</div>
              <div className="divide-y divide-slate-200/60 max-h-36 overflow-y-auto">
                {snapshotItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center py-1 text-xs">
                    <span className="text-slate-800 font-medium">
                      {item.quantity}× {item.productName}
                    </span>
                    <span className="font-semibold text-slate-900">₹{item.lineTotal.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-xs font-bold text-slate-900">
                <span>Total Amount:</span>
                <span className="text-emerald-700">₹{Number(billSnapshot.totalAmount || 0).toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="space-y-1.5">
            {delivery.sentAt && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Sent at</span>
                <span className="font-semibold text-slate-800">{fmtDate(delivery.sentAt)}</span>
              </div>
            )}
            {delivery.deliveredAt && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Delivered at</span>
                <span className="font-semibold text-emerald-700">{fmtDate(delivery.deliveredAt)}</span>
              </div>
            )}
            {delivery.lastAttemptAt && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Last attempt</span>
                <span className="font-semibold text-slate-800">{fmtDate(delivery.lastAttemptAt)}</span>
              </div>
            )}
            {delivery.nextAttemptAt && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Next retry at</span>
                <span className="font-semibold text-orange-700">{fmtDate(delivery.nextAttemptAt)}</span>
              </div>
            )}
            {delivery.providerMessageId && (
              <div className="flex justify-between text-xs gap-2">
                <span className="text-slate-500 shrink-0">Message ID</span>
                <span className="font-mono text-slate-700 truncate text-right">{delivery.providerMessageId}</span>
              </div>
            )}
          </div>

          {/* Error */}
          {delivery.lastError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
              <div className="text-[10px] font-bold text-red-700 uppercase mb-1">Last Error</div>
              <div className="text-xs text-red-800 font-mono break-words">{delivery.lastError}</div>
            </div>
          )}

          {/* Audit Log */}
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Audit Timeline</div>
            <AuditTimeline log={delivery.auditLog} />
          </div>

          {/* Actions */}
          {canOperate && (
            <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2">
              {(delivery.status === 'FAILED' || delivery.status === 'RETRY_WAIT') && (
                <button
                  onClick={() => act('retry')}
                  disabled={acting}
                  className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  Retry Now
                </button>
              )}
              {delivery.status === 'UNKNOWN' && (
                <>
                  <button
                    onClick={() => act('mark_delivered')}
                    disabled={acting}
                    className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                    Mark Delivered
                  </button>
                  <button
                    onClick={() => act('retry_send')}
                    disabled={acting}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    Retry Send
                  </button>
                  <button
                    onClick={() => act('mark_failed')}
                    disabled={acting}
                    className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                    Mark Failed
                  </button>
                </>
              )}
              {(delivery.status === 'PENDING' || delivery.status === 'QUEUED' || delivery.status === 'RETRY_WAIT') && (
                <button
                  onClick={() => act('cancel')}
                  disabled={acting}
                  className="flex-1 px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Reconciliation Modal ─────────────────────────────────────────────────────

function ReconciliationModal({
  isOpen,
  onClose,
  onApplied,
}: {
  isOpen: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<ReconciliationPreviewReport | null>(null);
  const [applying, setApplying] = useState(false);
  const [filterTab, setFilterTab] = useState<'ALL' | 'QUEUED' | 'SKIPPED' | 'FAILED' | 'CANCELLED'>('ALL');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.get<ReconciliationPreviewReport>('/whatsapp/queue/reconcile-preview?checkpointReceipt=355');
      setPreview(data);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to generate reconciliation preview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchPreview();
    }
  }, [isOpen, fetchPreview]);

  if (!isOpen) return null;

  const handleApply = async () => {
    if (!window.confirm('Apply historical recovery? All 25 eligible unsent bills after receipt #355 will be queued for automated delivery.')) {
      return;
    }
    setApplying(true);
    try {
      await api.post('/whatsapp/queue/reconcile-historical', { checkpointReceipt: 355 });
      onApplied();
      onClose();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to apply reconciliation');
    } finally {
      setApplying(false);
    }
  };

  const filteredItems = (preview?.items || []).filter((item) => {
    if (filterTab === 'ALL') return true;
    return item.status === filterTab;
  });

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col border border-slate-200">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Historical Bill Recovery &amp; Reconciliation</h2>
              <p className="text-xs text-slate-500">
                Recovery checkpoint: <span className="font-bold text-slate-800">Receipt #355</span> (Confirmed delivered)
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-semibold">
              {errorMsg}
            </div>
          )}

          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <span className="text-sm font-semibold">Auditing sales transactions relative to receipt #355…</span>
            </div>
          ) : preview ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl border bg-blue-50 border-blue-200">
                  <div className="text-[10px] font-bold text-blue-600 uppercase">Eligible to Queue</div>
                  <div className="text-2xl font-black text-blue-900 mt-1">{preview.queuedUnsent}</div>
                  <div className="text-[10px] text-blue-700 mt-0.5">Valid customer phone</div>
                </div>
                <div className="p-3 rounded-xl border bg-purple-50 border-purple-200">
                  <div className="text-[10px] font-bold text-purple-600 uppercase">Skipped (No Phone)</div>
                  <div className="text-2xl font-black text-purple-900 mt-1">{preview.skippedIneligible}</div>
                  <div className="text-[10px] text-purple-700 mt-0.5">Missing phone at checkout</div>
                </div>
                <div className="p-3 rounded-xl border bg-red-50 border-red-200">
                  <div className="text-[10px] font-bold text-red-600 uppercase">Invalid Phone Format</div>
                  <div className="text-2xl font-black text-red-900 mt-1">{preview.failedInvalid}</div>
                  <div className="text-[10px] text-red-700 mt-0.5">E.g. #386 (Swapped name/phone)</div>
                </div>
                <div className="p-3 rounded-xl border bg-emerald-50 border-emerald-200">
                  <div className="text-[10px] font-bold text-emerald-600 uppercase">Checkpoint #355</div>
                  <div className="text-2xl font-black text-emerald-900 mt-1">Confirmed</div>
                  <div className="text-[10px] text-emerald-700 mt-0.5">Last sent bill</div>
                </div>
              </div>

              {/* Instructions banner */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-800">
                    {preview.scannedAfterCheckpoint} sales were recorded after checkpoint #355.
                  </span>{' '}
                  Applying recovery will add all 25 eligible bills to the delivery queue with idempotent keys.
                  Repeated reconciliation is 100% safe and will never duplicate any bill.
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                <button
                  onClick={() => setFilterTab('ALL')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg cursor-pointer ${
                    filterTab === 'ALL' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  All ({preview.items.length})
                </button>
                <button
                  onClick={() => setFilterTab('QUEUED')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg cursor-pointer ${
                    filterTab === 'QUEUED' ? 'bg-blue-600 text-white' : 'text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  Eligible ({preview.queuedUnsent})
                </button>
                <button
                  onClick={() => setFilterTab('SKIPPED')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg cursor-pointer ${
                    filterTab === 'SKIPPED' ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-purple-50'
                  }`}
                >
                  Skipped / No Phone ({preview.skippedIneligible})
                </button>
                <button
                  onClick={() => setFilterTab('FAILED')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg cursor-pointer ${
                    filterTab === 'FAILED' ? 'bg-red-600 text-white' : 'text-red-700 hover:bg-red-50'
                  }`}
                >
                  Invalid ({preview.failedInvalid})
                </button>
              </div>

              {/* Preview Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Receipt</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Customer</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Phone</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Amount</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Status</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Audit / Reconciliation Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map((item) => (
                      <tr key={item.receiptNumber} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-bold text-slate-900">#{item.receiptNumber}</td>
                        <td className="px-3 py-2 text-slate-700">{item.customerName || '–'}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{maskPhone(item.customerPhone)}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">₹{item.totalAmount}</td>
                        <td className="px-3 py-2"><StatusBadge status={item.status} /></td>
                        <td className="px-3 py-2 text-slate-500 text-[11px] max-w-xs truncate" title={item.reason}>
                          {item.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={applying || loading || !preview}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-sm"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
            Confirm &amp; Recover {preview?.queuedUnsent || 0} Bills
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Config Panel ─────────────────────────────────────────────────────────────

function ConfigPanel({
  config,
  onSave,
}: {
  config: WhatsAppQueueConfig;
  onSave: (c: Partial<WhatsAppQueueConfig>) => Promise<void>;
}) {
  const [form, setForm] = useState(config);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof WhatsAppQueueConfig>(k: K, v: WhatsAppQueueConfig[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
        <Settings className="w-4 h-4 text-slate-500" /> Queue Throttling &amp; Pacing Configuration
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Min interval (s)</span>
          <input
            type="number"
            min={5}
            max={300}
            value={form.minIntervalSeconds}
            onChange={(e) => set('minIntervalSeconds', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Max interval (s)</span>
          <input
            type="number"
            min={5}
            max={600}
            value={form.maxIntervalSeconds}
            onChange={(e) => set('maxIntervalSeconds', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Window messages</span>
          <input
            type="number"
            min={1}
            max={100}
            value={form.maxWindowMessages}
            onChange={(e) => set('maxWindowMessages', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Window (min)</span>
          <input
            type="number"
            min={1}
            max={60}
            value={form.windowMinutes}
            onChange={(e) => set('windowMinutes', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Daily budget</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={form.maxDailyBudget}
            onChange={(e) => set('maxDailyBudget', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Max retries</span>
          <input
            type="number"
            min={0}
            max={10}
            value={form.maxRetries}
            onChange={(e) => set('maxRetries', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Retry backoff (min)</span>
          <input
            type="number"
            min={1}
            max={60}
            value={form.retryBackoffMinutes}
            onChange={(e) => set('retryBackoffMinutes', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.quietHoursEnabled}
            onChange={(e) => set('quietHoursEnabled', e.target.checked)}
            className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer"
          />
          <span className="text-xs font-semibold text-slate-700">Quiet hours (IST)</span>
        </label>
        {form.quietHoursEnabled && (
          <div className="grid grid-cols-2 gap-2 ml-5">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-600">Start</span>
              <input
                type="time"
                value={form.quietHoursStart}
                onChange={(e) => set('quietHoursStart', e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-600">End</span>
              <input
                type="time"
                value={form.quietHoursEnd}
                onChange={(e) => set('quietHoursEnd', e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
          </div>
        )}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.randomDelayEnabled}
            onChange={(e) => set('randomDelayEnabled', e.target.checked)}
            className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer"
          />
          <span className="text-xs font-semibold text-slate-700">Random jitter between min &amp; max interval</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.autoSendEnabled}
            onChange={(e) => set('autoSendEnabled', e.target.checked)}
            className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer"
          />
          <span className="text-xs font-semibold text-slate-700">Auto-send enabled</span>
        </label>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Settings className="w-3.5 h-3.5" />}
        {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Configuration'}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All Statuses' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'SENDING', label: 'Sending' },
  { value: 'SENT', label: 'Sent' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'UNKNOWN', label: 'Unknown / Review' },
  { value: 'SKIPPED', label: 'Skipped (Ineligible)' },
  { value: 'RETRY_WAIT', label: 'Retry Wait' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'PENDING', label: 'Pending' },
];

export const WhatsAppBillingPage: React.FC = () => {
  const { isDeveloper, isAdmin } = useAuth();
  const canOperate = isDeveloper || isAdmin;

  // Gateway status
  const [gwStatus, setGwStatus] = useState<{
    isConnected: boolean;
    status: string;
    connectedNumber?: string | null;
    qrDataUrl?: string | null;
    lastError?: string | null;
    nextSlotInMs?: number;
    lastDeliveredAt?: string | null;
  } | null>(null);

  // Queue summary
  const [summary, setSummary] = useState<WhatsAppQueueSummary | null>(null);

  // Delivery list
  const [deliveries, setDeliveries] = useState<WhatsAppDelivery[]>([]);
  const [totalDeliveries, setTotalDeliveries] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Config
  const [config, setConfig] = useState<WhatsAppQueueConfig | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // Modals
  const [detailDelivery, setDetailDelivery] = useState<WhatsAppDelivery | null>(null);
  const [showReconcileModal, setShowReconcileModal] = useState(false);

  // Operation states
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [circuitResetting, setCircuitResetting] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // Countdown timer for next dispatch slot
  const [countdownSec, setCountdownSec] = useState<number | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data Fetchers ──────────────────────────────────────────────────────────

  const fetchGateway = useCallback(async () => {
    try {
      const data = await api.get<any>('/whatsapp/status');
      setGwStatus(data);
      if (typeof data.nextSlotInMs === 'number') {
        setCountdownSec(Math.ceil(data.nextSlotInMs / 1000));
      }
    } catch { /* silently ignore */ }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await api.get<WhatsAppQueueSummary>('/whatsapp/queue/summary');
      setSummary(data);
      if (typeof data.nextSlotInMs === 'number') {
        setCountdownSec(Math.ceil(data.nextSlotInMs / 1000));
      }
    } catch { /* silently ignore */ }
  }, []);

  const fetchDeliveries = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(searchQ ? { search: searchQ } : {}),
      });
      const data = await api.get<{ deliveries: WhatsAppDelivery[]; total?: number; pagination?: { totalRecords: number } }>(
        `/whatsapp/queue?${params}`
      );
      setDeliveries(data.deliveries ?? []);
      setTotalDeliveries(data.total ?? data.pagination?.totalRecords ?? 0);
    } catch { /* silently ignore */ }
  }, [page, statusFilter, searchQ]);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await api.get<WhatsAppQueueConfig>('/whatsapp/config');
      setConfig(data);
    } catch { /* silently ignore */ }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchGateway(), fetchSummary(), fetchDeliveries()]);
    setLastRefreshedAt(new Date());
  }, [fetchGateway, fetchSummary, fetchDeliveries]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchGateway(), fetchSummary(), fetchDeliveries(), fetchConfig()]);
      setLastRefreshedAt(new Date());
      setLoading(false);
    };
    init();
    const interval = setInterval(() => {
      fetchGateway();
      fetchSummary();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

  // Live countdown decrementer
  useEffect(() => {
    if (countdownSec === null || countdownSec <= 0) return;
    const t = setInterval(() => {
      setCountdownSec((prev) => (prev && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [countdownSec]);

  // ── Search debounce ────────────────────────────────────────────────────────

  const handleSearchInput = (v: string) => {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchQ(v);
      setPage(1);
    }, 350);
  };

  // ── Queue Controls ─────────────────────────────────────────────────────────

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4000);
  };

  const handlePause = async () => {
    try {
      await api.post('/whatsapp/queue/pause', { reason: 'Manual pause by operator' });
      showMsg('ok', 'Queue paused.');
      fetchSummary();
      fetchConfig();
    } catch (e: any) { showMsg('err', e?.message || 'Failed to pause'); }
  };

  const handleResume = async () => {
    try {
      await api.post('/whatsapp/queue/resume', {});
      showMsg('ok', 'Queue resumed.');
      fetchSummary();
      fetchConfig();
    } catch (e: any) { showMsg('err', e?.message || 'Failed to resume'); }
  };

  const handleResetCircuit = async () => {
    if (!window.confirm('Reset the circuit breaker? The queue will resume dispatching.')) return;
    setCircuitResetting(true);
    try {
      await api.post('/whatsapp/queue/resume', { resetCircuit: true });
      showMsg('ok', 'Circuit breaker reset. Queue resumed.');
      fetchSummary();
      fetchConfig();
    } catch (e: any) {
      showMsg('err', e?.message || 'Failed');
    } finally {
      setCircuitResetting(false);
    }
  };

  const handleDeliveryAction = async (id: string, action: 'retry' | 'cancel' | 'mark_delivered' | 'mark_failed' | 'retry_send') => {
    const endpointMap: Record<string, string> = {
      retry: `/whatsapp/queue/${id}/retry`,
      cancel: `/whatsapp/queue/${id}/cancel`,
      mark_delivered: `/whatsapp/queue/${id}/resolve`,
      mark_failed: `/whatsapp/queue/${id}/resolve`,
      retry_send: `/whatsapp/queue/${id}/resolve`,
    };
    const bodyMap: Record<string, object> = {
      retry: {},
      cancel: {},
      mark_delivered: { action: 'MARK_DELIVERED' },
      mark_failed: { action: 'MARK_FAILED' },
      retry_send: { action: 'RETRY_SEND' },
    };
    await api.post(endpointMap[action], bodyMap[action]);
    showMsg('ok', `Action "${action}" applied.`);
    await refreshAll();
  };

  const handleUpdatePhone = async (id: string, phone: string, customerName?: string) => {
    await api.put(`/whatsapp/queue/${id}/phone`, { phone, customerName });
    showMsg('ok', 'Phone number updated and bill queued for delivery.');
    await refreshAll();
  };

  const handleSaveConfig = async (updates: Partial<WhatsAppQueueConfig>) => {
    const data = await api.put<WhatsAppQueueConfig>('/whatsapp/config', updates);
    setConfig(data);
    showMsg('ok', 'Configuration saved.');
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(totalDeliveries / pageSize));
  const isPaused = config?.isPaused ?? false;
  const circuitTripped = config?.circuitBreakerTripped ?? false;
  const isConnected = gwStatus?.isConnected ?? false;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <span className="text-sm font-semibold">Loading WhatsApp Billing Dashboard…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-emerald-600" />
            WhatsApp Billing Queue
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Automated customer receipts · Checkpoint: <span className="font-semibold text-slate-700">Receipt #355</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {actionMsg && (
            <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${actionMsg.type === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
              {actionMsg.text}
            </span>
          )}
          <span className="text-[11px] text-slate-400 mr-1 hidden sm:inline">
            Updated {fmtRelative(lastRefreshedAt.toISOString())}
          </span>
          <button
            onClick={refreshAll}
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {canOperate && (
            <button
              onClick={() => setShowReconcileModal(true)}
              className="px-3.5 py-1.5 text-xs font-bold rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer flex items-center gap-1.5 transition-colors"
            >
              <History className="w-3.5 h-3.5" /> Recovery &amp; Reconcile
            </button>
          )}
          {canOperate && (
            <button
              onClick={() => setShowConfig((v) => !v)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border cursor-pointer flex items-center gap-1.5 transition-colors ${
                showConfig ? 'bg-slate-900 text-white border-transparent' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Settings className="w-3.5 h-3.5" /> Config
            </button>
          )}
        </div>
      </div>

      {/* Gateway Status Banner */}
      <div
        className={`rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isConnected
            ? 'bg-emerald-50 border-emerald-200'
            : gwStatus?.status === 'SCAN_QR'
            ? 'bg-amber-50 border-amber-300'
            : 'bg-red-50 border-red-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-3 h-3 rounded-full shrink-0 ${
              isConnected
                ? 'bg-emerald-500'
                : gwStatus?.status === 'SCAN_QR'
                ? 'bg-amber-500 animate-pulse'
                : 'bg-red-500'
            }`}
          />
          <div>
            <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
              <span>
                Gateway:{' '}
                {isConnected
                  ? `Connected (+${gwStatus?.connectedNumber || 'linked'})`
                  : gwStatus?.status === 'SCAN_QR'
                  ? 'Awaiting QR Scan to Link Number'
                  : 'WhatsApp Disconnected'}
              </span>
              {isConnected && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-extrabold uppercase tracking-wide">
                  Active
                </span>
              )}
            </div>
            {!isConnected ? (
              <p className="text-[11px] text-slate-600 mt-0.5">
                WhatsApp is disconnected — bills are safely queued in database and will be dispatched once reconnected.
              </p>
            ) : (
              <p className="text-[11px] text-emerald-800 mt-0.5">
                Throttled dispatch enabled ({config?.minIntervalSeconds || 15}–{config?.maxIntervalSeconds || 35}s delay)
                {summary?.lastDeliveredAt && ` · Last delivered: ${fmtDate(summary.lastDeliveredAt)}`}
              </p>
            )}
          </div>
        </div>

        {/* Right side status badges / timers */}
        <div className="flex items-center gap-3 flex-wrap">
          {isConnected && countdownSec !== null && countdownSec > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-white/80 border border-emerald-300 rounded-lg text-xs font-semibold text-emerald-800">
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>Next slot: {countdownSec}s</span>
            </div>
          )}

          {circuitTripped && (
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-red-100 text-red-700 border border-red-300 rounded-full text-[10px] font-bold flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> Circuit Tripped
              </span>
              {canOperate && (
                <button
                  onClick={handleResetCircuit}
                  disabled={circuitResetting}
                  className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold rounded-full cursor-pointer flex items-center gap-1 disabled:opacity-50"
                >
                  {circuitResetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pause Banner */}
      {isPaused && (
        <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 flex items-center gap-3">
          <Pause className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-xs font-semibold text-amber-900 flex-1">
            Queue is paused{config?.pauseReason ? `: ${config.pauseReason}` : '.'}
          </span>
          {canOperate && (
            <button
              onClick={handleResume}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" /> Resume
            </button>
          )}
        </div>
      )}

      {/* Summary Stats Grid */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatCard
            label="Total Tracked"
            value={summary.total ?? 0}
            icon={<Activity className="w-4 h-4" />}
            color="slate"
            sub="all records"
          />
          <StatCard
            label="Pending / Queued"
            value={(summary.totalPending ?? summary.byStatus?.['PENDING'] ?? 0) + (summary.totalQueued ?? summary.byStatus?.['QUEUED'] ?? 0)}
            icon={<Clock className="w-4 h-4" />}
            color="blue"
            sub="awaiting dispatch"
          />
          <StatCard
            label="Processing"
            value={summary.totalSending ?? summary.byStatus?.['SENDING'] ?? 0}
            icon={<Send className="w-4 h-4" />}
            color="amber"
            sub="in flight"
          />
          <StatCard
            label="Delivered"
            value={summary.totalDelivered ?? summary.byStatus?.['DELIVERED'] ?? 0}
            icon={<CheckCheck className="w-4 h-4" />}
            color="emerald"
            sub="confirmed sent"
          />
          <StatCard
            label="Failed"
            value={summary.failedCount ?? summary.totalFailed ?? summary.byStatus?.['FAILED'] ?? 0}
            icon={<XCircle className="w-4 h-4" />}
            color="red"
            sub="needs fix / retry"
          />
          <StatCard
            label="Unknown"
            value={summary.unknownCount ?? summary.totalUnknown ?? summary.byStatus?.['UNKNOWN'] ?? 0}
            icon={<AlertTriangle className="w-4 h-4" />}
            color="yellow"
            sub="pre-355 audit"
          />
          <StatCard
            label="Skipped"
            value={summary.skippedCount ?? summary.totalSkipped ?? summary.byStatus?.['SKIPPED'] ?? 0}
            icon={<Info className="w-4 h-4" />}
            color="purple"
            sub="no phone"
          />
        </div>
      )}

      {/* Config Panel */}
      {showConfig && config && (
        <ConfigPanel config={config} onSave={handleSaveConfig} />
      )}

      {/* Queue Action Bar */}
      {canOperate && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="flex items-center gap-2">
            {!isPaused ? (
              <button
                onClick={handlePause}
                className="px-3.5 py-1.5 bg-white hover:bg-amber-50 text-amber-800 text-xs font-bold rounded-lg border border-amber-300 cursor-pointer flex items-center gap-1.5"
              >
                <Pause className="w-3.5 h-3.5" /> Pause Queue
              </button>
            ) : (
              <button
                onClick={handleResume}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" /> Resume Queue
              </button>
            )}
            <button
              onClick={() => setShowReconcileModal(true)}
              className="px-3.5 py-1.5 bg-white hover:bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-300 cursor-pointer flex items-center gap-1.5"
            >
              <History className="w-3.5 h-3.5" /> Reconcile Historical Bills
            </button>
          </div>
          <div className="text-[11px] text-slate-500">
            Daily Budget: <span className="font-bold text-slate-800">{summary?.todayCount ?? 0}</span> / {config?.maxDailyBudget ?? 200}
          </div>
        </div>
      )}

      {/* Delivery Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        {/* Table Header / Filters */}
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Send className="w-4 h-4 text-slate-400" />
            Delivery Queue
            <span className="text-slate-500 font-normal text-xs ml-1">
              ({totalDeliveries} total records)
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={searchInput}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="Receipt #, phone, customer…"
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg w-52 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            {/* Status filter */}
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="pl-8 pr-6 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none bg-white cursor-pointer"
              >
                {STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Desktop Table */}
        <div className="overflow-x-auto hidden sm:block">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Receipt</th>
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Customer</th>
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Phone</th>
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Amount</th>
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Event</th>
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-center font-bold text-slate-500 uppercase tracking-wide">Tries</th>
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Last Attempt</th>
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Delivered / Scheduled</th>
                <th className="px-4 py-2.5 text-center font-bold text-slate-500 uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deliveries.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-slate-400 text-sm">
                    No delivery records found
                    {statusFilter && ` for status "${statusFilter}"`}
                    {searchQ && ` matching "${searchQ}"`}.
                  </td>
                </tr>
              )}
              {deliveries.map((d) => {
                const totalAmt = d.sale?.totalAmount ?? (d as any).billSnapshot?.totalAmount;
                const eventName = d.sale?.event?.name ?? (d as any).billSnapshot?.eventName;
                return (
                  <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-900">
                      #{d.receiptNumber}
                      {d.saleId && <span className="ml-1 text-[10px] text-slate-400 font-normal">id:{d.saleId}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium">{d.customerName || '–'}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{maskPhone(d.customerPhone)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {totalAmt !== undefined ? `₹${Number(totalAmt).toFixed(0)}` : '–'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[130px] truncate" title={eventName}>
                      {eventName || '–'}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                    <td className="px-4 py-3 text-center text-slate-700">{d.attemptCount}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtRelative(d.lastAttemptAt)}</td>
                    <td className="px-4 py-3 text-slate-600 font-medium">
                      {d.deliveredAt ? (
                        <span className="text-emerald-700">{fmtDate(d.deliveredAt)}</span>
                      ) : d.nextAttemptAt ? (
                        <span className="text-orange-700">{fmtDate(d.nextAttemptAt)}</span>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setDetailDelivery(d)}
                        className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                        title="View details &amp; audit history"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="sm:hidden divide-y divide-slate-100">
          {deliveries.length === 0 && (
            <div className="px-4 py-10 text-center text-slate-400 text-sm">No records found.</div>
          )}
          {deliveries.map((d) => (
            <div key={d.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-sm">#{d.receiptNumber}</span>
                <StatusBadge status={d.status} />
              </div>
              <div className="text-xs text-slate-600">
                {d.customerName || '–'} · {maskPhone(d.customerPhone)}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{d.attemptCount} tries · {fmtRelative(d.lastAttemptAt)}</span>
                <button
                  onClick={() => setDetailDelivery(d)}
                  className="text-emerald-600 font-bold cursor-pointer"
                >
                  Details →
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalDeliveries)} of {totalDeliveries}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-semibold text-slate-700 px-2">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info note */}
      <div className="flex items-start gap-2 text-[11px] text-slate-400 pb-4">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Customer phone numbers are masked for privacy. Delivery jobs are processed one-at-a-time with server-side rate
          limiting and random delay to comply with WhatsApp messaging policies.
        </span>
      </div>

      {/* Detail Modal */}
      {detailDelivery && (
        <DeliveryDetailModal
          delivery={detailDelivery}
          onClose={() => setDetailDelivery(null)}
          onAction={handleDeliveryAction}
          onUpdatePhone={handleUpdatePhone}
          isDeveloper={isDeveloper}
          isAdmin={isAdmin}
        />
      )}

      {/* Historical Reconciliation Modal */}
      <ReconciliationModal
        isOpen={showReconcileModal}
        onClose={() => setShowReconcileModal(false)}
        onApplied={() => {
          showMsg('ok', 'Historical recovery applied successfully! Queue has been populated.');
          refreshAll();
        }}
      />
    </div>
  );
};