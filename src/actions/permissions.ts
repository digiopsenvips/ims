'use server';

import { requireRole } from '@/lib/authz';
import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export async function assignPermissionToUser(userId: string, permissionKey: string) {
  const currentUser = await requireRole(['DEVELOPER', 'ADMIN']);

  const permission = await prisma.permission.findUnique({
    where: { key: permissionKey },
  });

  if (!permission) {
    throw new Error(`Permission with key ${permissionKey} not found`);
  }

  const existingAssignment = await prisma.userPermission.findUnique({
    where: {
      userId_permissionId: {
        userId,
        permissionId: permission.id,
      },
    },
  });

  if (existingAssignment) {
    return existingAssignment;
  }

  const assignment = await prisma.userPermission.create({
    data: {
      userId,
      permissionId: permission.id,
      grantedBy: currentUser.id,
    },
    include: {
      permission: true,
    },
  });

  await recordAuditEvent({
    action: 'PERMISSION_GRANTED',
    entityType: 'USER_PERMISSION',
    entityId: assignment.id,
    previousData: { userId, permissionKey: permission.key },
    newData: { userId, permissionKey: permission.key, grantedBy: currentUser.id },
    metadata: { grantedBy: currentUser.id },
  });

  return assignment;
}

export async function revokePermissionFromUser(userId: string, permissionKey: string) {
  await requireRole(['DEVELOPER', 'ADMIN']);

  const permission = await prisma.permission.findUnique({
    where: { key: permissionKey },
  });

  if (!permission) {
    throw new Error(`Permission with key ${permissionKey} not found`);
  }

  await prisma.userPermission.delete({
    where: {
      userId_permissionId: {
        userId,
        permissionId: permission.id,
      },
    },
  });

  const currentUser = await requireRole(['DEVELOPER', 'ADMIN']);

  await recordAuditEvent({
    action: 'PERMISSION_REVOKED',
    entityType: 'USER_PERMISSION',
    entityId: userId,
    previousData: { userId, permissionKey: permission.key },
    newData: { userId, permissionKey: permission.key, revokedBy: currentUser.id },
    metadata: { revokedBy: currentUser.id },
  });
}

export async function getUserWithPermissions(userId: string) {
  await requireRole(['DEVELOPER', 'ADMIN']);

  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      userPermissions: {
        include: {
          permission: true,
        },
      },
    },
  });
}

export async function getAllPermissions() {
  await requireRole(['DEVELOPER', 'ADMIN']);

  return prisma.permission.findMany({
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });
}

export async function getAllUsers() {
  await requireRole(['DEVELOPER', 'ADMIN']);

  return prisma.user.findMany({
    include: {
      userPermissions: {
        include: {
          permission: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });
}
