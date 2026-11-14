import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import {
  ShieldAlert,
  Search,
  RefreshCw,
  KeyRound,
  UserCheck,
  UserMinus,
  Sliders,
  Clock,
  Shield,
  UserX,
  AlertCircle,
} from 'lucide-react';

interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  targetUserId?: string | null;
  targetUsername?: string | null;
  details?: any;
  ipAddress?: string | null;
  createdAt: string;
}

export const AuditLogsViewer: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchLogs = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.get('/users/audit-logs?limit=200');
      if (data?.logs) {
        setLogs(data.logs);
      }
    } catch (err: any) {
      console.error('Failed to load audit logs:', err);
      setErrorMsg(err.message || 'Failed to fetch audit logs');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'PERMISSIONS_UPDATED':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
            <Sliders className="w-3 h-3" />
            <span>PERMISSIONS_UPDATED</span>
          </span>
        );
      case 'USER_RETIRED':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
            <UserMinus className="w-3 h-3" />
            <span>USER_RETIRED</span>
          </span>
        );
      case 'USER_REACTIVATED':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
            <UserCheck className="w-3 h-3" />
            <span>USER_REACTIVATED</span>
          </span>
        );
      case 'PASSWORD_RESET':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
            <KeyRound className="w-3 h-3" />
            <span>PASSWORD_RESET</span>
          </span>
        );
      case 'USER_CREATED':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
            <UserCheck className="w-3 h-3" />
            <span>USER_CREATED</span>
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700 border border-slate-200">
            {action}
          </span>
        );
    }
  };

  const formatDetails = (details: any) => {
    if (!details) return <span className="text-slate-400 italic">No details recorded</span>;
    if (typeof details === 'string') return <span>{details}</span>;

    const parts: React.ReactNode[] = [];
    if (details.reason) {
      parts.push(
        <div key="reason" className="text-amber-800 font-medium">
          Reason: "{details.reason}"
        </div>
      );
    }
    if (details.added && Array.isArray(details.added) && details.added.length > 0) {
      parts.push(
        <div key="added" className="text-emerald-700 text-[11px]">
          <span className="font-bold">+ Granted ({details.added.length}):</span>{' '}
          <span className="font-mono text-[10px]">{details.added.join(', ')}</span>
        </div>
      );
    }
    if (details.removed && Array.isArray(details.removed) && details.removed.length > 0) {
      parts.push(
        <div key="removed" className="text-rose-700 text-[11px]">
          <span className="font-bold">- Revoked ({details.removed.length}):</span>{' '}
          <span className="font-mono text-[10px]">{details.removed.join(', ')}</span>
        </div>
      );
    }
    if (details.totalAssigned !== undefined) {
      parts.push(
        <div key="total" className="text-slate-500 text-[10px]">
          Total active permissions: {details.totalAssigned}
        </div>
      );
    }
    if (details.role) {
      parts.push(
        <div key="role" className="text-slate-600 text-[11px]">
          Role: <span className="font-bold">{details.role}</span>
        </div>
      );
    }

    if (parts.length > 0) {
      return <div className="space-y-1">{parts}</div>;
    }

    return <pre className="text-[10px] text-slate-600 font-mono overflow-x-auto">{JSON.stringify(details, null, 2)}</pre>;
  };

  const filteredLogs = logs.filter(log => {
    if (actionFilter !== 'ALL' && log.action !== actionFilter) return false;
    if (!searchQuery.trim()) return true;

    const q = searchQuery.toLowerCase();
    const matchActor = (log.actorName || '').toLowerCase().includes(q);
    const matchTarget = (log.targetUsername || '').toLowerCase().includes(q);
    const matchAction = (log.action || '').toLowerCase().includes(q);
    const matchIp = (log.ipAddress || '').toLowerCase().includes(q);
    const matchDetails = JSON.stringify(log.details || '').toLowerCase().includes(q);

    return matchActor || matchTarget || matchAction || matchIp || matchDetails;
  });

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search audit trail by actor, target, reason..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
            />
          </div>

          <select
            aria-label="Filter Audit Logs by Action"
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="text-xs bg-slate-50 font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 text-slate-700 cursor-pointer"
          >
            <option value="ALL">All Actions ({logs.length})</option>
            <option value="PERMISSIONS_UPDATED">Permissions Updated</option>
            <option value="USER_RETIRED">User Retired</option>
            <option value="USER_REACTIVATED">User Reactivated</option>
            <option value="PASSWORD_RESET">Password Reset</option>
            <option value="USER_CREATED">User Created</option>
          </select>
        </div>

        <button
          type="button"
          onClick={fetchLogs}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Audit Logs</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">Actor</th>
                <th className="py-2.5 px-4">Target User</th>
                <th className="py-2.5 px-4">Details &amp; Audit Payload</th>
                <th className="py-2.5 px-4 text-right">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {isLoading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-500" />
                    <span>Loading security audit trail...</span>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No security audit logs match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => {
                  const date = new Date(log.createdAt);
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap text-slate-500 text-[11px]">
                        <div className="font-semibold text-slate-800">
                          {date.toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {getActionBadge(log.action)}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{log.actorName}</div>
                        <span className="text-[10px] px-1.5 py-0.2 rounded font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {log.actorRole}
                        </span>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {log.targetUsername ? (
                          <div>
                            <div className="font-mono text-xs font-semibold text-slate-900">
                              @{log.targetUsername}
                            </div>
                            {log.targetUserId && (
                              <div className="text-[9px] font-mono text-slate-400 truncate max-w-[120px]">
                                {log.targetUserId}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 max-w-md">
                        {formatDetails(log.details)}
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap font-mono text-[11px] text-slate-400">
                        {log.ipAddress || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
