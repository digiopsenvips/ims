import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireRole } from '@/lib/authz';

export default async function AdminPage() {
  const user = await requireRole(['DEVELOPER', 'ADMIN']);

  if (!user) {
    redirect('/login');
  }

  return (
    <main className="min-h-screen text-slate-900">
      <div className="app-shell">
        <div className="panel-card overflow-hidden">
          <div className="bg-slate-900 px-6 py-7 text-white sm:px-8">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300">Admin</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Operational management</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              System administration, configuration, and process oversight.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {[
            { title: 'Users', subtitle: 'User management', description: 'Manage accounts, roles, and access.', href: '/admin/users' },
            { title: 'Permissions', subtitle: 'Granular access', description: 'View and assign permissions.', href: '/admin/permissions' },
            { title: 'Projects', subtitle: 'Organization', description: 'Manage active Enactus projects.', href: '/admin/projects' },
            { title: 'Products', subtitle: 'Catalog', description: 'Track all product offerings.', href: '/admin/products' },
            { title: 'Events', subtitle: 'Event operations', description: 'Create and manage sales events.', href: '/admin/events' },
            { title: 'Inventory', subtitle: 'Stock control', description: 'Monitor availability and adjustments.', href: '/admin/inventory' },
            { title: 'Sales', subtitle: 'Revenue operations', description: 'Review live sales and corrections.', href: '/admin/sales' },
            { title: 'Audit log', subtitle: 'Compliance', description: 'Inspect operational history and exports.', href: '/admin/audit' },
          ].map((card) => (
            <div key={card.title} className="metric-card flex h-full flex-col justify-between gap-4 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{card.subtitle}</p>
                <h2 className="mt-3 text-xl font-semibold text-slate-900">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
              </div>
              <Link href={card.href} className="primary-button mt-2 w-full justify-center">
                Open module
              </Link>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
