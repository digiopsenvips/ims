import { redirect } from 'next/navigation';

import { getActiveSalesContext, getMySales } from '@/actions/sales';
import { requireRole } from '@/lib/authz';
import MemberSalesClient from './sales-client';

export default async function MemberPage() {
  const user = await requireRole(['DEVELOPER', 'ADMIN', 'HEAD', 'MEMBER']);

  if (!user) {
    redirect('/login');
  }

  const [context, initialSales] = await Promise.all([getActiveSalesContext(), getMySales()]);

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <MemberSalesClient user={user} context={context} initialSales={initialSales} />
    </main>
  );
}
