'use server';

import { requireRole } from '@/lib/authz';
import { prisma } from '@/lib/prisma';

export async function getDashboardAnalytics() {
  const user = await requireRole(['DEVELOPER', 'ADMIN', 'HEAD', 'MEMBER']);

  const [userCount, projectCount, productCount, activeEventCount, sales] = await Promise.all([
    prisma.user.count({ where: { isActive: true } }),
    prisma.project.count({ where: { isActive: true } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.event.count({ where: { status: 'ACTIVE' } }),
    prisma.sale.findMany({
      orderBy: { saleTime: 'desc' },
      include: {
        saleItems: {
          include: {
            product: {
              include: {
                project: true,
              },
            },
          },
        },
        event: true,
      },
    }),
  ]);

  const totalRevenue = sales.reduce((sum, sale) => sum + Number(sale.totalAmount), 0);

  const salesByDayMap = new Map<string, { date: string; revenue: number; sales: number }>();
  const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  const projectMap = new Map<string, { name: string; revenue: number; sales: number }>();

  for (const sale of sales) {
    const dayKey = sale.saleTime.toISOString().slice(0, 10);
    const existing = salesByDayMap.get(dayKey) ?? { date: dayKey, revenue: 0, sales: 0 };
    existing.revenue += Number(sale.totalAmount);
    existing.sales += 1;
    salesByDayMap.set(dayKey, existing);

    for (const item of sale.saleItems) {
      const productName = item.product.name;
      const productEntry = productMap.get(productName) ?? { name: productName, quantity: 0, revenue: 0 };
      productEntry.quantity += item.quantity;
      productEntry.revenue += Number(item.lineTotal);
      productMap.set(productName, productEntry);

      const projectName = item.product.project.name;
      const projectEntry = projectMap.get(projectName) ?? { name: projectName, revenue: 0, sales: 0 };
      projectEntry.revenue += Number(item.lineTotal);
      projectEntry.sales += 1;
      projectMap.set(projectName, projectEntry);
    }
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
    },
    summary: {
      userCount,
      projectCount,
      productCount,
      activeEventCount,
      salesCount: sales.length,
      totalRevenue,
      averageOrderValue: sales.length ? totalRevenue / sales.length : 0,
    },
    salesByDay: Array.from(salesByDayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    topProducts: Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    projectPerformance: Array.from(projectMap.values()).sort((a, b) => b.revenue - a.revenue),
  };
}
