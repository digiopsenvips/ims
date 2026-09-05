import { redirect } from 'next/navigation';

import { requireRole } from '@/lib/authz';
import { getUserWithPermissions, getAllPermissions } from '@/actions/permissions';
import UserPermissionsContent from './content';

export default async function UserPermissionsPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  const user = await requireRole(['DEVELOPER', 'ADMIN']);

  if (!user) {
    redirect('/login');
  }

  const userData = await getUserWithPermissions(userId);
  const allPermissions = await getAllPermissions();

  if (!userData) {
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
        <div className="mx-auto max-w-6xl">
          <p>User not found</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <UserPermissionsContent user={userData} allPermissions={allPermissions} userId={userId} />
    </main>
  );
}
