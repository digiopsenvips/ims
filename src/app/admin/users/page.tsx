import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireRole } from '@/lib/authz';
import { getAllUsers } from '@/actions/permissions';

export default async function UsersManagementPage() {
  const user = await requireRole(['DEVELOPER', 'ADMIN']);

  if (!user) {
    redirect('/login');
  }

  const users = await getAllUsers();

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">User Management</h1>
          </div>
          <Link href="/admin" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50">
            Back to Admin
          </Link>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-500">Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-500">Username</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-500">Role</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-500">Permissions</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-500">Active</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 transition">
                  <td className="px-6 py-4 text-sm font-medium">{u.name}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">{u.username}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{u.userPermissions.length}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <Link href={`/admin/users/${u.id}`} className="text-blue-600 hover:underline">
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
