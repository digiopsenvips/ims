'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Permission } from '@prisma/client';
import { assignPermissionToUser, revokePermissionFromUser, getUserWithPermissions } from '@/actions/permissions';

interface User {
  id: string;
  name: string;
  username: string;
  role: string;
  userPermissions: Array<{
    permission: Permission;
  }>;
}

interface Props {
  user: User;
  allPermissions: Permission[];
  userId: string;
}

export default function UserPermissionsContent({ user: initialUser, allPermissions, userId }: Props) {
  const [user, setUser] = useState(initialUser);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTogglePermission = async (permissionKey: string, hasPermission: boolean) => {
    setLoading(true);
    setError(null);

    try {
      if (hasPermission) {
        await revokePermissionFromUser(userId, permissionKey);
      } else {
        await assignPermissionToUser(userId, permissionKey);
      }

      const updatedUser = await getUserWithPermissions(userId);
      if (updatedUser) {
        setUser(updatedUser);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permission');
    } finally {
      setLoading(false);
    }
  };

  const userPermissionKeys = new Set(user.userPermissions.map((up) => up.permission.key));
  const permissionsByCategory = allPermissions.reduce((acc: Record<string, Permission[]>, perm: Permission) => {
    if (!acc[perm.category]) acc[perm.category] = [];
    acc[perm.category].push(perm);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Manage Permissions: {user.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {user.username} ({user.role}) — {user.userPermissions.length} permissions assigned
          </p>
        </div>
        <Link
          href="/admin/users"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
        >
          Back to Users
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="space-y-6">
        {Object.entries(permissionsByCategory).map(([category, perms]) => (
          <div key={category} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
              <h2 className="text-sm font-semibold uppercase text-slate-700">{category}</h2>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2 lg:grid-cols-3">
              {perms.map((perm) => {
                const hasPermission = userPermissionKeys.has(perm.key);
                return (
                  <label
                    key={perm.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    <input
                      type="checkbox"
                      checked={hasPermission}
                      onChange={() => handleTogglePermission(perm.key, hasPermission)}
                      disabled={loading}
                      className="mt-1 h-4 w-4 cursor-pointer rounded border-slate-300 disabled:cursor-not-allowed"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{perm.name}</p>
                      <p className="text-xs text-slate-500">{perm.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
