'use client';

import Link from 'next/link';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface SummaryMetric {
  userCount: number;
  projectCount: number;
  productCount: number;
  activeEventCount: number;
  salesCount: number;
  totalRevenue: number;
  averageOrderValue: number;
}

interface SalesByDayPoint {
  date: string;
  revenue: number;
  sales: number;
}

interface ProductPerformance {
  name: string;
  quantity: number;
  revenue: number;
}

interface ProjectPerformance {
  name: string;
  revenue: number;
  sales: number;
}

const CHART_COLORS = ['#0f172a', '#475569', '#64748b', '#94a3b8', '#cbd5e1'];

function formatCurrencyTooltip(value: number | string | ReadonlyArray<number | string> | undefined) {
  const numericValue = Array.isArray(value) ? Number(value[0] ?? 0) : Number(value ?? 0);
  return [`₹${numericValue.toLocaleString('en-IN')}`, 'Revenue'];
}

export default function DashboardClient({
  user,
  analytics,
}: {
  user: { id: string; name: string; role: string };
  analytics: {
    summary: SummaryMetric;
    salesByDay: SalesByDayPoint[];
    topProducts: ProductPerformance[];
    projectPerformance: ProjectPerformance[];
  };
}) {
  const summaryCards = [
    { label: 'Active users', value: analytics.summary.userCount },
    { label: 'Projects', value: analytics.summary.projectCount },
    { label: 'Products', value: analytics.summary.productCount },
    { label: 'Active events', value: analytics.summary.activeEventCount },
  ];

  const quickActions = [
    { title: 'Users', subtitle: 'Manage accounts', href: '/admin/users', roles: ['DEVELOPER', 'ADMIN'] },
    { title: 'Permissions', subtitle: 'Access controls', href: '/admin/permissions', roles: ['DEVELOPER', 'ADMIN'] },
    { title: 'Projects', subtitle: 'Organization', href: '/admin/projects', roles: ['DEVELOPER', 'ADMIN', 'HEAD'] },
    { title: 'Products', subtitle: 'Catalog', href: '/admin/products', roles: ['DEVELOPER', 'ADMIN', 'HEAD'] },
    { title: 'Inventory', subtitle: 'Stock control', href: '/admin/inventory', roles: ['DEVELOPER', 'ADMIN', 'HEAD'] },
    { title: 'Events', subtitle: 'Sales events', href: '/admin/events', roles: ['DEVELOPER', 'ADMIN', 'HEAD'] },
    { title: 'Sales', subtitle: 'Revenue ops', href: '/admin/sales', roles: ['DEVELOPER', 'ADMIN', 'HEAD', 'MEMBER'] },
    { title: 'Audit log', subtitle: 'Compliance', href: '/admin/audit', roles: ['DEVELOPER', 'ADMIN'] },
  ].filter((action) => action.roles.includes(user.role));

  return (
    <main className="min-h-screen text-slate-900">
      <div className="app-shell space-y-8">
        <div className="panel-card overflow-hidden">
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-900 px-6 py-7 text-white sm:px-8">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-200">Dashboard</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Welcome back, {user.name}</h1>
            <p className="mt-2 text-sm text-slate-200">
              Role: <span className="font-medium text-white">{user.role}</span>
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="metric-card">
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{card.value}</p>
            </div>
          ))}
        </div>

        <section className="panel-card p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Quick access</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Operations</h2>
            </div>
            <Link href="/admin" className="text-sm font-medium text-emerald-700 transition hover:text-emerald-800">
              Open admin console
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((action) => (
              <Link
                key={action.title}
                href={action.href}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{action.subtitle}</p>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">{action.title}</h3>
                <div className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
                  Open module
                  <span aria-hidden="true">→</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
          <div className="panel-card p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Revenue trend</h2>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                ₹{analytics.summary.totalRevenue.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.salesByDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip formatter={formatCurrencyTooltip} />
                  <Bar dataKey="revenue" radius={[8, 8, 0, 0]} fill="#0f172a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel-card p-6">
            <h2 className="text-xl font-semibold">Sales snapshot</h2>
            <div className="mt-5 space-y-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Total sales</p>
                <p className="mt-2 text-2xl font-semibold">{analytics.summary.salesCount}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Average order value</p>
                <p className="mt-2 text-2xl font-semibold">₹{analytics.summary.averageOrderValue.toFixed(2)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Active events</p>
                <p className="mt-2 text-2xl font-semibold">{analytics.summary.activeEventCount}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div className="panel-card p-6">
            <h2 className="text-xl font-semibold">Top products</h2>
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.topProducts} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={80} />
                  <Tooltip formatter={formatCurrencyTooltip} />
                  <Bar dataKey="revenue" radius={[0, 10, 10, 0]} fill="#475569">
                    {analytics.topProducts.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel-card p-6">
            <h2 className="text-xl font-semibold">Project revenue</h2>
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.projectPerformance}
                    dataKey="revenue"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={45}
                    paddingAngle={3}
                  >
                    {analytics.projectPerformance.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={formatCurrencyTooltip} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 space-y-2">
              {analytics.projectPerformance.map((entry, index) => (
                <div key={entry.name} className="flex items-center justify-between text-sm text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                    {entry.name}
                  </div>
                  <span className="font-medium text-slate-900">₹{entry.revenue.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
