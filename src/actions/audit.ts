'use server';

import { getCurrentSessionUser, hasPermission, requirePermission } from '@/lib/authz';
import { prisma } from '@/lib/prisma';

export async function getAuditLogs() {
  await requirePermission('audit.view');

  return prisma.auditLog.findMany({
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function getAuditLogsForExport() {
  return prisma.auditLog.findMany({
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });
}

function escapeCsvValue(value: unknown) {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export async function exportAuditLogsCsv() {
  await requirePermission('reports.export');

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

  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
}

export async function canViewAuditLogs() {
  const user = await getCurrentSessionUser();
  if (!user) {
    return false;
  }

  if (user.role === 'DEVELOPER' || user.role === 'ADMIN') {
    return true;
  }

  return hasPermission('audit.view');
}
