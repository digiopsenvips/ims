import Link from 'next/link';

import { getAuditLogs } from '@/actions/audit';
import { requirePermission } from '@/lib/authz';

export default async function AuditLogsPage() {
  await requirePermission('audit.view');

  const logs = await getAuditLogs();

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Audit</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Audit log</h1>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/admin" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Back to admin
            </Link>
            <a href="/admin/audit/export" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Export CSV
            </a>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-700">Timestamp</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">User</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Action</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Entity</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Entity ID</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Before</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">After</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      No audit records found.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{log.createdAt.toLocaleString()}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {log.user ? `${log.user.name} (${log.user.username})` : 'System'}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">{log.action}</td>
                      <td className="px-4 py-3 text-slate-600">{log.entityType}</td>
                      <td className="px-4 py-3 text-slate-500">{log.entityId ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {log.previousData ? JSON.stringify(log.previousData).slice(0, 120) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {log.newData ? JSON.stringify(log.newData).slice(0, 120) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {log.metadata ? JSON.stringify(log.metadata).slice(0, 120) : '—'}
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
