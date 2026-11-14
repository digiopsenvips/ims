import { prisma } from '../config/prisma';

export interface AuditLogEvent {
  action: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  targetUserId?: string;
  targetUsername?: string;
  details?: Record<string, any>;
  ipAddress?: string;
}

export async function logAuditEvent(event: AuditLogEvent): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: event.action,
        actorId: event.actorId,
        actorName: event.actorName,
        actorRole: event.actorRole,
        targetUserId: event.targetUserId,
        targetUsername: event.targetUsername,
        details: event.details || {},
        ipAddress: event.ipAddress,
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
