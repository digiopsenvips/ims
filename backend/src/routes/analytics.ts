import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';

const router = Router();

// GET /api/analytics/dashboard: Comprehensive analytics data with permissions enforcement
router.get(
  '/dashboard',
  authenticateToken,
  requirePermission('view_analytics'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { eventId, projectId, memberId, startDate, endDate } = req.query;

    const isDev = req.user?.role === Role.DEVELOPER;
    const isAdmin = req.user?.role === Role.ADMIN;
    const canViewRevenue = isDev || isAdmin || !!req.user?.permissions?.['view_revenue'];
    const canViewEventBreakdown = isDev || isAdmin || !!req.user?.permissions?.['view_event_breakdown'];

    try {
      const whereClause: any = {};
      if (eventId) whereClause.eventId = String(eventId);
      if (memberId) {
        const memId = String(memberId);
        const memberCond = [
          { memberId: memId },
          { sellerUserIdAtSale: memId },
        ];
        whereClause.AND = whereClause.AND ? [...whereClause.AND, { OR: memberCond }] : [{ OR: memberCond }];
      }
      if (projectId) {
        whereClause.OR = [
          { product: { projectId: String(projectId) } },
          { items: { some: { product: { projectId: String(projectId) } } } },
        ];
      }
      if (startDate || endDate) {
        whereClause.saleTime = {};
        if (startDate) whereClause.saleTime.gte = new Date(String(startDate));
        if (endDate) whereClause.saleTime.lte = new Date(String(endDate));
      }

      // Fetch all matched sales with items, product, and event details
      const sales = await prisma.sale.findMany({
        where: whereClause,
        include: {
          event: true,
          product: {
            include: {
              project: true,
            },
          },
          items: {
            include: {
              product: {
                include: {
                  project: true,
                },
              },
            },
          },
          member: {
            select: { id: true, name: true },
          },
        },
        orderBy: { saleTime: 'asc' },
      });

      // 1. Overview KPIs
      let totalUnitsSold = 0;
      let totalRevenue = 0;

      // 2. Product Share (Pie Chart data)
      const productMap: Record<
        string,
        { name: string; project: string; units: number; revenue: number }
      > = {};

      // 3. Project Share
      const projectMap: Record<string, { name: string; units: number; revenue: number }> = {};

      // 4. Per Event / Stall Performance
      const eventMap: Record<
        string,
        {
          eventId: string;
          eventName: string;
          totalUnits: number;
          totalRevenue: number;
          productUnits: Record<string, { name: string; count: number }>;
        }
      > = {};

      // 5. Time Trend (Daily)
      const dateMap: Record<string, { date: string; units: number; revenue: number }> = {};

      for (const s of sales) {
        totalRevenue += Number(s.totalAmount);

        const lineItems = (s.items && s.items.length > 0)
          ? s.items.map(item => ({
              productId: item.productId,
              productName: item.product.name,
              projectName: item.product.project.name,
              quantity: item.quantity,
              revenue: Number(item.lineTotal),
            }))
          : s.product
          ? [{
              productId: s.productId!,
              productName: s.product.name,
              projectName: s.product.project.name,
              quantity: s.quantity || 1,
              revenue: Number(s.totalAmount),
            }]
          : [];

        for (const item of lineItems) {
          totalUnitsSold += item.quantity;
          const pId = item.productId;
          const pName = item.productName;
          const prjName = item.projectName;
          const rev = item.revenue;

          // Product
          if (!productMap[pId]) {
            productMap[pId] = { name: pName, project: prjName, units: 0, revenue: 0 };
          }
          productMap[pId].units += item.quantity;
          productMap[pId].revenue += rev;

          // Project
          if (!projectMap[prjName]) {
            projectMap[prjName] = { name: prjName, units: 0, revenue: 0 };
          }
          projectMap[prjName].units += item.quantity;
          projectMap[prjName].revenue += rev;

          // Event
          if (canViewEventBreakdown) {
            const eId = s.eventId;
            const eName = s.event.name;
            if (!eventMap[eId]) {
              eventMap[eId] = {
                eventId: eId,
                eventName: eName,
                totalUnits: 0,
                totalRevenue: 0,
                productUnits: {},
              };
            }
            eventMap[eId].totalUnits += item.quantity;
            eventMap[eId].totalRevenue += rev;
            if (!eventMap[eId].productUnits[pId]) {
              eventMap[eId].productUnits[pId] = { name: pName, count: 0 };
            }
            eventMap[eId].productUnits[pId].count += item.quantity;
          }

          // Time trend (YYYY-MM-DD)
          const dateKey = s.saleTime.toISOString().split('T')[0];
          if (!dateMap[dateKey]) {
            dateMap[dateKey] = { date: dateKey, units: 0, revenue: 0 };
          }
          dateMap[dateKey].units += item.quantity;
          dateMap[dateKey].revenue += rev;
        }
      }

      // Convert product share to array
      const productShare = Object.values(productMap).map(p => ({
        name: p.name,
        project: p.project,
        units: p.units,
        revenue: canViewRevenue ? p.revenue : undefined,
      }));

      // Convert project share to array
      const projectShare = Object.values(projectMap).map(p => ({
        name: p.name,
        units: p.units,
        revenue: canViewRevenue ? p.revenue : undefined,
      }));

      // Convert event performance to array and determine best seller
      const stallPerformance = canViewEventBreakdown
        ? Object.values(eventMap).map(e => {
            let bestSellerName = 'None';
            let maxCount = 0;
            for (const p of Object.values(e.productUnits)) {
              if (p.count > maxCount) {
                maxCount = p.count;
                bestSellerName = p.name;
              }
            }
            return {
              eventId: e.eventId,
              eventName: e.eventName,
              totalUnits: e.totalUnits,
              totalRevenue: canViewRevenue ? e.totalRevenue : undefined,
              bestSellingProduct: bestSellerName,
              bestSellingUnits: maxCount,
            };
          })
        : [];

      // Convert time trend to sorted array
      const timeTrend = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

      res.json({
        canViewRevenue,
        canViewEventBreakdown,
        overview: {
          totalSalesRecords: sales.length,
          totalUnitsSold,
          totalRevenue: canViewRevenue ? totalRevenue : null,
        },
        productShare,
        projectShare,
        stallPerformance,
        timeTrend,
      });
    } catch (error) {
      console.error('Fetch analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  }
);

export default router;
