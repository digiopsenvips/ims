import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireRole } from '@/lib/authz';
import { getAllPermissions } from '@/actions/permissions';
import type { Permission } from '@prisma/client';

export default async function PermissionsPage() {
  const user = await requireRole(['DEVELOPER', 'ADMIN']);

  if (!user) {
    redirect('/login');
  }

  const allPermissions = await getAllPermissions();

  const permissionsByCategory = allPermissions.reduce((acc: Record<string, typeof allPermissions>, perm: Permission) => {
    if (!acc[perm.category]) acc[perm.category] = [];
    acc[perm.category].push(perm);
    return acc;
  }, {});

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Permission Reference</h1>
            <p className="mt-1 text-sm text-slate-600">Available permissions in the system</p>
          </div>
          <Link href="/admin" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50">
            Back to Admin
          </Link>
        </div>

        <div className="space-y-6">
          {Object.entries(permissionsByCategory).map(([category, perms]) => (
            <div key={category} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
                <h2 className="text-sm font-semibold uppercase text-slate-700">{category}</h2>
              </div>
              <div className="divide-y divide-slate-200">
                {perms.map((perm: Permission) => (
                  <div key={perm.id} className="px-6 py-4 hover:bg-slate-50 transition">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold">{perm.name}</p>
                        <p className="text-xs text-slate-500 mt-1">{perm.description}</p>
                      </div>
                      <span className="ml-4 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-mono text-slate-700">
                        {perm.key}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
