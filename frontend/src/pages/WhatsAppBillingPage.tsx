import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { WhatsAppDelivery, WhatsAppDeliveryStatus, WhatsAppQueueConfig, WhatsAppQueueSummary } from '../types';
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
} from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

function maskPhone(phone: string): string {
  if (!phone) return '–';
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) {
    return '+91 ' + digits.slice(-10, -6) + 'XXXX' + digits.slice(-2);
  }
  return '****' + digits.slice(-4);
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function fmtRelative(iso?: string | null): string {
  if (!iso) return '–';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
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

function StatCard({ label, value, sub, color = 'slate', icon }: {
  label: string; value: number | string; sub?: string;
  color?: 'slate' | 'emerald' | 'blue' | 'amber' | 'red' | 'orange' | 'yellow';
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

function AuditTimeline({ log }: { log?: Array<{ ts: string; event: string; detail?: string }> | null }) {
  if (!log || log.length === 0) return <p className="text-xs text-slate-400 italic">No audit events yet.</p>;
  return (
    <div className="space-y-2">
      {[...log].reverse().map((entry, i) => (
        <div key={i} className="flex gap-2 text-[11px]">
          <div className="shrink-0 w-1.5 h-1.5 mt-1.5 rounded-full bg-slate-400" />
          <div>
            <span className="font-semibold text-slate-700">{entry.event}</span>
            {entry.detail && <span className="text-slate-500 ml-1">— {entry.detail}</span>}
            <div className="text-slate-400">{fmtDate(entry.ts)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Delivery Detail Modal ────────────────────────────────────────────────────

function DeliveryDetailModal({
  delivery,
  onClose,
  onAction,
  isDeveloper,
  isAdmin,
}: {
  delivery: WhatsAppDelivery;
  onClose: () => void;
  onAction: (id: string, action: 'retry' | 'cancel' | 'mark_delivered' | 'mark_failed' | 'retry_send') => Promise<void>;
  isDeveloper: boolean;
  isAdmin: boolean;
}) {
  const [acting, setActing] = useState(false);
  const canOperate = isDeveloper || isAdmin;

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
              <p className="text-[11px] text-slate-500">WhatsApp Delivery Detail</p>
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
              <div className="text-[10px] text-slate-500 font-semibold uppercase mb-1">Phone</div>
              <div className="text-xs font-mono text-slate-900">{maskPhone(delivery.customerPhone)}</div>
            </div>
          </div>

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

// ─── Config Panel ─────────────────────────────────────────────────────────────

function ConfigPanel({ config, onSave }: {
  config: WhatsAppQueueConfig;
  onSave: (c: Partial<WhatsAppQueueConfig>) => Promise<void>;
}) {
  const [form, setForm] = useState(config);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof WhatsAppQueueConfig>(k: K, v: WhatsAppQueueConfig[K]) =>
    setForm(f => ({ ...f, [k]: v }));

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
        <Settings className="w-4 h-4 text-slate-500" /> Queue Configuration
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Min interval (s)</span>
          <input type="number" min={5} max={300} value={form.minIntervalSeconds}
            onChange={e => set('minIntervalSeconds', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Max interval (s)</span>
          <input type="number" min={5} max={600} value={form.maxIntervalSeconds}
            onChange={e => set('maxIntervalSeconds', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Window messages</span>
          <input type="number" min={1} max={100} value={form.maxWindowMessages}
            onChange={e => set('maxWindowMessages', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Window (min)</span>
          <input type="number" min={1} max={60} value={form.windowMinutes}
            onChange={e => set('windowMinutes', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Daily budget</span>
          <input type="number" min={1} max={1000} value={form.maxDailyBudget}
            onChange={e => set('maxDailyBudget', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Max retries</span>
          <input type="number" min={0} max={10} value={form.maxRetries}
            onChange={e => set('maxRetries', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-600">Retry backoff (min)</span>
          <input type="number" min={1} max={60} value={form.retryBackoffMinutes}
            onChange={e => set('retryBackoffMinutes', Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        </label>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.quietHoursEnabled}
            onChange={e => set('quietHoursEnabled', e.target.checked)}
            className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer" />
          <span className="text-xs font-semibold text-slate-700">Quiet hours (IST)</span>
        </label>
        {form.quietHoursEnabled && (
          <div className="grid grid-cols-2 gap-2 ml-5">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-600">Start</span>
              <input type="time" value={form.quietHoursStart}
                onChange={e => set('quietHoursStart', e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-600">End</span>
              <input type="time" value={form.quietHoursEnd}
                onChange={e => set('quietHoursEnd', e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            </label>
          </div>
        )}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.randomDelayEnabled}
            onChange={e => set('randomDelayEnabled', e.target.checked)}
            className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer" />
          <span className="text-xs font-semibold text-slate-700">Random jitter between min & max interval</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.autoSendEnabled}
            onChange={e => set('autoSendEnabled', e.target.checked)}
            className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer" />
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
  { value: 'PENDING', label: 'Pending' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'SENDING', label: 'Sending' },
  { value: 'SENT', label: 'Sent' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'RETRY_WAIT', label: 'Retry Wait' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const WhatsAppBillingPage: React.FC = () => {
  const { isDeveloper, isAdmin } = useAuth();
  const canOperate = isDeveloper || isAdmin;

  // Gateway status
  const [gwStatus, setGwStatus] = useState<{ isConnected: boolean; status: string; connectedNumber?: string | null } | null>(null);

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

  // Detail modal
  const [detailDelivery, setDetailDelivery] = useState<WhatsAppDelivery | null>(null);

  // Operation states
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [circuitResetting, setCircuitResetting] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data Fetchers ──────────────────────────────────────────────────────────

  const fetchGateway = useCallback(async () => {
    try {
      const data = await api.get<any>('/whatsapp/status');
      setGwStatus(data);
    } catch { /* silently ignore */ }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await api.get<WhatsAppQueueSummary>('/whatsapp/queue/summary');
      setSummary(data);
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
      const data = await api.get<{ deliveries: WhatsAppDelivery[]; total: number }>(
        `/whatsapp/queue?${params}`
      );
      setDeliveries(data.deliveries ?? []);
      setTotalDeliveries(data.total ?? 0);
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
  }, [fetchGateway, fetchSummary, fetchDeliveries]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchGateway(), fetchSummary(), fetchDeliveries(), fetchConfig()]);
      setLoading(false);
    };
    init();
    const interval = setInterval(() => { fetchGateway(); fetchSummary(); }, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

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
      fetchSummary(); fetchConfig();
    } catch (e: any) { showMsg('err', e?.message || 'Failed to pause'); }
  };

  const handleResume = async () => {
    try {
      await api.post('/whatsapp/queue/resume', {});
      showMsg('ok', 'Queue resumed.');
      fetchSummary(); fetchConfig();
    } catch (e: any) { showMsg('err', e?.message || 'Failed to resume'); }
  };

  const handleResetCircuit = async () => {
    if (!window.confirm('Reset the circuit breaker? The queue will resume dispatching.')) return;
    setCircuitResetting(true);
    try {
      await api.post('/whatsapp/queue/resume', { resetCircuit: true });
      showMsg('ok', 'Circuit breaker reset. Queue resumed.');
      fetchSummary(); fetchConfig();
    } catch (e: any) {
      showMsg('err', e?.message || 'Failed');
    } finally {
      setCircuitResetting(false);
    }
  };

  const handleReconcile = async () => {
    if (!window.confirm('Run historical reconciliation? Bills after Nov 1 5:22 PM will be queued; earlier bills marked UNKNOWN.')) return;
    setReconciling(true);
    try {
      const result = await api.post<{ queued: number; unknown: number; skipped: number }>('/whatsapp/queue/reconcile-historical', {});
      showMsg('ok', `Reconciliation done: ${result.queued} queued, ${result.unknown} unknown, ${result.skipped} skipped.`);
      await refreshAll();
    } catch (e: any) {
      showMsg('err', e?.message || 'Reconciliation failed');
    } finally {
      setReconciling(false);
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

  // ── Render ─────────────────────────────────────────────────────────────────

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
          <p className="text-xs text-slate-500 mt-0.5">Manage automated bill delivery to customers</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {actionMsg && (
            <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${actionMsg.type === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
              {actionMsg.text}
            </span>
          )}
          <button onClick={refreshAll} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          {canOperate && (
            <button onClick={() => setShowConfig(v => !v)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border cursor-pointer flex items-center gap-1.5 transition-colors ${showConfig ? 'bg-slate-900 text-white border-transparent' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
              <Settings className="w-3.5 h-3.5" /> Config
            </button>
          )}
        </div>
      </div>

      {/* Gateway Status Banner */}
      <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
        isConnected ? 'bg-emerald-50 border-emerald-200' :
        gwStatus?.status === 'SCAN_QR' ? 'bg-amber-50 border-amber-300' :
        'bg-red-50 border-red-200'
      }`}>
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isConnected ? 'bg-emerald-500' : gwStatus?.status === 'SCAN_QR' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`} />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold text-slate-900">
            Gateway: {isConnected ? `Connected — +${gwStatus?.connectedNumber || 'linked'}` : gwStatus?.status === 'SCAN_QR' ? 'Awaiting QR scan' : (gwStatus?.status || 'Disconnected')}
          </span>
          {!isConnected && (
            <span className="ml-2 text-[11px] text-slate-600">Queue will hold messages until WhatsApp reconnects.</span>
          )}
        </div>
        {circuitTripped && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="px-2 py-1 bg-red-100 text-red-700 border border-red-300 rounded-full text-[10px] font-bold flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> Circuit Tripped
            </span>
            {canOperate && (
              <button onClick={handleResetCircuit} disabled={circuitResetting}
                className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold rounded-full cursor-pointer flex items-center gap-1 disabled:opacity-50">
                {circuitResetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Reset
              </button>
            )}
          </div>
        )}
      </div>

      {/* Pause Banner */}
      {isPaused && (
        <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 flex items-center gap-3">
          <Pause className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-xs font-semibold text-amber-900 flex-1">Queue is paused{config?.pauseReason ? `: ${config.pauseReason}` : '.'}</span>
          {canOperate && (
            <button onClick={handleResume} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5" /> Resume
            </button>
          )}
        </div>
      )}

      {/* Summary Stats Grid */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Total" value={summary.total ?? 0} icon={<Activity className="w-4 h-4" />} color="slate" sub="all time" />
          <StatCard
            label="Pending / Queued"
            value={
              (summary.byStatus?.['PENDING'] ?? (summary as any).totalPending ?? 0) +
              (summary.byStatus?.['QUEUED'] ?? (summary as any).totalQueued ?? 0)
            }
            icon={<Clock className="w-4 h-4" />}
            color="blue"
            sub="awaiting dispatch"
          />
          <StatCard
            label="Delivered"
            value={summary.byStatus?.['DELIVERED'] ?? (summary as any).totalDelivered ?? 0}
            icon={<CheckCheck className="w-4 h-4" />}
            color="emerald"
            sub="confirmed"
          />
          <StatCard
            label="Failed"
            value={summary.failedCount ?? summary.byStatus?.['FAILED'] ?? (summary as any).totalFailed ?? 0}
            icon={<XCircle className="w-4 h-4" />}
            color="red"
            sub="need attention"
          />
          <StatCard
            label="Unknown"
            value={summary.unknownCount ?? summary.byStatus?.['UNKNOWN'] ?? (summary as any).totalUnknown ?? 0}
            icon={<AlertTriangle className="w-4 h-4" />}
            color="yellow"
            sub="pre-cutoff bills"
          />
        </div>
      )}

      {/* Config Panel */}
      {showConfig && config && (
        <ConfigPanel config={config} onSave={handleSaveConfig} />
      )}

      {/* Queue Controls */}
      {canOperate && (
        <div className="flex flex-wrap gap-2">
          {!isPaused ? (
            <button onClick={handlePause}
              className="px-3.5 py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-bold rounded-lg border border-amber-300 cursor-pointer flex items-center gap-1.5">
              <Pause className="w-3.5 h-3.5" /> Pause Queue
            </button>
          ) : (
            <button onClick={handleResume}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5" /> Resume Queue
            </button>
          )}
          <button onClick={handleReconcile} disabled={reconciling}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg border border-slate-300 cursor-pointer flex items-center gap-1.5 disabled:opacity-50">
            {reconciling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
            Reconcile Historical Bills
          </button>
        </div>
      )}

      {/* Delivery Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {/* Table Header / Filters */}
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Send className="w-4 h-4 text-slate-400" />
            Delivery Queue
            <span className="text-slate-400 font-normal text-xs ml-1">({totalDeliveries} records)</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={searchInput}
                onChange={e => handleSearchInput(e.target.value)}
                placeholder="Receipt # or name…"
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg w-44 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            {/* Status filter */}
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                className="pl-8 pr-6 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none bg-white cursor-pointer"
              >
                {STATUS_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-center font-bold text-slate-500 uppercase tracking-wide">Tries</th>
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Last Attempt</th>
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Delivered At</th>
                <th className="px-4 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wide">Created</th>
                <th className="px-4 py-2.5 text-center font-bold text-slate-500 uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deliveries.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400 text-sm">
                    No delivery records found
                    {statusFilter && ` for status "${statusFilter}"`}
                    {searchQ && ` matching "${searchQ}"`}.
                  </td>
                </tr>
              )}
              {deliveries.map(d => (
                <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-bold text-slate-800">
                    #{d.receiptNumber}
                    {d.saleId && <span className="ml-1 text-[10px] text-slate-400 font-normal">id:{d.saleId}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{d.customerName || '–'}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{maskPhone(d.customerPhone)}</td>
                  <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                  <td className="px-4 py-3 text-center text-slate-700">{d.attemptCount}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtRelative(d.lastAttemptAt)}</td>
                  <td className="px-4 py-3 text-slate-500">{d.deliveredAt ? fmtDate(d.deliveredAt) : '–'}</td>
                  <td className="px-4 py-3 text-slate-400">{fmtRelative(d.createdAt)}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => setDetailDelivery(d)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer"
                      title="View details"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="sm:hidden divide-y divide-slate-100">
          {deliveries.length === 0 && (
            <div className="px-4 py-10 text-center text-slate-400 text-sm">No records found.</div>
          )}
          {deliveries.map(d => (
            <div key={d.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-sm">#{d.receiptNumber}</span>
                <StatusBadge status={d.status} />
              </div>
              <div className="text-xs text-slate-600">{d.customerName || '–'} · {maskPhone(d.customerPhone)}</div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{d.attemptCount} attempts · {fmtRelative(d.lastAttemptAt)}</span>
                <button onClick={() => setDetailDelivery(d)} className="text-emerald-600 font-bold cursor-pointer">Details →</button>
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
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-semibold text-slate-700 px-2">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
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
        <span>Phone numbers are masked for privacy. UNKNOWN bills are pre-cutoff records that require manual resolution — they are never auto-retried.</span>
      </div>

      {/* Detail Modal */}
      {detailDelivery && (
        <DeliveryDetailModal
          delivery={detailDelivery}
          onClose={() => setDetailDelivery(null)}
          onAction={handleDeliveryAction}
          isDeveloper={isDeveloper}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
};
