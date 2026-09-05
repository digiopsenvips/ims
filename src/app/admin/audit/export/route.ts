import { NextResponse } from 'next/server';

import { getAuditLogsForExport } from '@/actions/audit';
import { getCurrentSessionUser, hasPermission } from '@/lib/authz';

export async function GET() {
  const user = await getCurrentSessionUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasExportPermission = await hasPermission('reports.export');
  const isPrivileged = user.role === 'DEVELOPER' || user.role === 'ADMIN';

  if (!hasExportPermission && !isPrivileged) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const logs = await getAuditLogsForExport();
  const rows = [
    ['Created At', 'User', 'Action', 'Entity Type', 'Entity ID', 'Previous Data', 'New Data', 'Metadata'],
    ...logs.map((log) => [
      log.createdAt.toISOString(),
      log.user ? `${log.user.name} (${log.user.username})` : 'System',
      log.action,
      log.entityType,
      log.entityId ?? '',
      JSON.stringify(log.previousData ?? {}),
      JSON.stringify(log.newData ?? {}),
      JSON.stringify(log.metadata ?? {}),
    ]),
  ];

  const csvText = rows
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  return new NextResponse(csvText, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="audit-logs.csv"',
    },
  });
}
