import { Prisma } from '@prisma/client';

import { getCurrentSessionUser } from '@/lib/authz';
import { prisma } from '@/lib/prisma';

export type AuditEventInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  previousData?: Prisma.InputJsonValue | null;
  newData?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
  userId?: string | null;
};

export async function recordAuditEvent(input: AuditEventInput) {
  const actorId = input.userId ?? (await getCurrentSessionUser())?.id ?? null;

  return prisma.auditLog.create({
    data: {
      userId: actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      previousData: input.previousData ?? undefined,
      newData: input.newData ?? undefined,
      metadata: input.metadata ?? undefined,
    },
  });
}
