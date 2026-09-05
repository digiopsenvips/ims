import { redirect } from 'next/navigation';

import { getDashboardAnalytics } from '@/actions/analytics';
import { requireRole } from '@/lib/authz';
import DashboardClient from './dashboard-client';

export default async function DashboardPage() {
  const user = await requireRole(['DEVELOPER', 'ADMIN', 'HEAD', 'MEMBER']);

  if (!user) {
    redirect('/login');
  }

  const analytics = await getDashboardAnalytics();

  return <DashboardClient user={user} analytics={analytics} />;
}
