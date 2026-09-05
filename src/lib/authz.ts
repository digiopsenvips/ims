import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { hasPermissionForUser } from '@/lib/permissions';

export type AppRole = 'DEVELOPER' | 'ADMIN' | 'HEAD' | 'MEMBER';

export async function getCurrentSessionUser() {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      userPermissions: {
        include: {
          permission: true,
        },
      },
    },
  });
}

export async function requireRole(roles: AppRole[]) {
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect('/login');
  }

  if (!roles.includes(user.role as AppRole)) {
    redirect('/login?error=forbidden');
  }

  return user;
}

export async function requirePermission(permissionKey: string) {
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect('/login');
  }

  const allowed = hasPermissionForUser(
    user.userPermissions.map((userPermission) => ({ permission: userPermission.permission })),
    permissionKey,
  );

  if (!allowed) {
    redirect('/dashboard?error=forbidden');
  }

  return user;
}

export async function hasPermission(permissionKey: string): Promise<boolean> {
  const user = await getCurrentSessionUser();

  if (!user) {
    return false;
  }

  return hasPermissionForUser(
    user.userPermissions.map((userPermission) => ({ permission: userPermission.permission })),
    permissionKey,
  );
}

export async function getUserPermissions(): Promise<string[]> {
  const user = await getCurrentSessionUser();

  if (!user) {
    return [];
  }

  return user.userPermissions.map((up) => up.permission.key);
}
