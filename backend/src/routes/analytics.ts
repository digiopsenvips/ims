import { businessDateRange, businessDay } from '../services/reportDates';
import { responsePolicy } from '../middleware/responsePolicy';
import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';

const router = Router();
router.use(responsePolicy);

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
          { game: { projectId: String(projectId) } },
        ];
      }
      if (startDate || endDate) whereClause.saleTime = businessDateRange(startDate, endDate);

      // Fetch all matched sales with items, product, and event details
      const sales = await prisma.sale.findMany({
        where: whereClause,
        include: {
          event: true,
          game: { include: { project: true } },
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
        const isGame = s.transactionType === 'GAME';
        const lineItems = s.items.length > 0
          ? s.items.map(item => ({ productId: item.productId, productName: item.product.name,
              projectId: item.product.projectId, projectName: item.product.project.name,
              quantity: item.quantity, revenue: Number(item.lineTotal) }))
          : s.product ? [{ productId: s.productId!, productName: s.product.name,
              projectId: s.product.projectId, projectName: s.product.project.name,
              quantity: s.quantity || 0, revenue: Number(s.totalAmount) }] : [];
        const selectedItems = projectId ? lineItems.filter(item => item.projectId === String(projectId)) : lineItems;
        if (isGame && projectId && s.game?.projectId !== String(projectId)) continue;
        const revenue = !projectId || isGame ? Number(s.totalAmount) : selectedItems.reduce((sum, item) => sum + item.revenue, 0);
        const units = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
        totalRevenue += revenue; totalUnitsSold += units;
        // Fees are counted once per sale, even for a no-reward game loss.
        const date = businessDay(s.saleTime);
        if (!dateMap[date]) dateMap[date] = { date, units: 0, revenue: 0 };
        dateMap[date].units += units; dateMap[date].revenue += revenue;
        if (canViewEventBreakdown) {
          if (!eventMap[s.eventId]) eventMap[s.eventId] = { eventId: s.eventId, eventName: s.event.name,
            totalUnits: 0, totalRevenue: 0, productUnits: {} };
          eventMap[s.eventId].totalUnits += units; eventMap[s.eventId].totalRevenue += revenue;
        }
        for (const item of selectedItems) {
          if (!productMap[item.productId]) productMap[item.productId] = { name: item.productName, project: item.projectName, units: 0, revenue: 0 };
          productMap[item.productId].units += item.quantity; productMap[item.productId].revenue += item.revenue;
          if (!projectMap[item.projectName]) projectMap[item.projectName] = { name: item.projectName, units: 0, revenue: 0 };
          projectMap[item.projectName].units += item.quantity; projectMap[item.projectName].revenue += item.revenue;
          if (canViewEventBreakdown) {
            const products = eventMap[s.eventId].productUnits;
            if (!products[item.productId]) products[item.productId] = { name: item.productName, count: 0 };
            products[item.productId].count += item.quantity;
          }
        }
        if (isGame) {
          const project = s.game?.project?.name || 'Unassigned games';
          if (!projectMap[project]) projectMap[project] = { name: project, units: 0, revenue: 0 };
          projectMap[project].revenue += revenue;
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

      // Fetch Game Sessions for game analytics
      const gameSessionWhere: any = { status: 'COMPLETED' };
      if (eventId) gameSessionWhere.eventId = String(eventId);
      if (startDate || endDate) gameSessionWhere.createdAt = businessDateRange(startDate, endDate);
      if (projectId) gameSessionWhere.game = { projectId: String(projectId) };
      if (memberId) gameSessionWhere.OR = [{ sellerId: String(memberId) }, { sale: { sellerUserIdAtSale: String(memberId) } }];

      const gameSessions = await prisma.gameSession.findMany({
        where: gameSessionWhere,
        include: {
          game: { include: { project: true } },
          event: true,
          rewardProduct: true,
        },
      });

      let totalGamesPlayed = gameSessions.length;
      let totalGameRevenue = 0;
      let totalWins = 0;
      let totalLosses = 0;
      let totalRewardsIssued = 0;
      let estimatedRewardValue = 0;

      const gMap: Record<string, any> = {};
      const evGameMap: Record<string, any> = {};

      for (const gs of gameSessions) {
        const fee = Number(gs.entryFee);
        totalGameRevenue += fee;
        totalRewardsIssued += gs.rewardQuantity;
        const rewardBase = gs.rewardProduct?.basePrice ? Number(gs.rewardProduct.basePrice) : 0;
        estimatedRewardValue += rewardBase * gs.rewardQuantity;

        if (gs.result === 'WIN') totalWins++;
        else totalLosses++;

        if (!gMap[gs.gameId]) {
          gMap[gs.gameId] = {
            gameId: gs.gameId,
            gameName: gs.game.name,
            projectName: gs.game.project?.name || 'Upcycle',
            plays: 0,
            revenue: 0,
            wins: 0,
            losses: 0,
            rewardsIssued: 0,
          };
        }
        gMap[gs.gameId].plays++;
        gMap[gs.gameId].revenue += fee;
        gMap[gs.gameId].rewardsIssued += gs.rewardQuantity;
        if (gs.result === 'WIN') gMap[gs.gameId].wins++;
        else gMap[gs.gameId].losses++;

        if (!evGameMap[gs.eventId]) {
          evGameMap[gs.eventId] = {
            eventId: gs.eventId,
            eventName: gs.event.name,
            plays: 0,
            revenue: 0,
            wins: 0,
            losses: 0,
            rewardsIssued: 0,
          };
        }
        evGameMap[gs.eventId].plays++;
        evGameMap[gs.eventId].revenue += fee;
        evGameMap[gs.eventId].rewardsIssued += gs.rewardQuantity;
        if (gs.result === 'WIN') evGameMap[gs.eventId].wins++;
        else evGameMap[gs.eventId].losses++;
      }

      const gameWinRate = totalGamesPlayed > 0 ? Math.round((totalWins / totalGamesPlayed) * 1000) / 10 : 0;

      const gameBreakdown = Object.values(gMap).map((g: any) => ({
        ...g,
        revenue: canViewRevenue ? g.revenue : undefined,
        winRate: g.plays > 0 ? Math.round((g.wins / g.plays) * 1000) / 10 : 0,
      }));

      const eventGameBreakdown = Object.values(evGameMap).map((e: any) => ({
        ...e,
        revenue: canViewRevenue ? e.revenue : undefined,
        winRate: e.plays > 0 ? Math.round((e.wins / e.plays) * 1000) / 10 : 0,
      }));

      // Combos analytics
      let totalCombosSold = 0;
      let totalComboRevenue = 0;
      let totalComboUnits = 0;
      const comboBreakdownMap: Record<string, any> = {};

      for (const s of sales) {
        const cartSnapshot = Array.isArray(s.cartSnapshot) ? (s.cartSnapshot as any[]) : null;
        if (cartSnapshot && cartSnapshot.length > 0) {
          const comboLines = cartSnapshot.filter(l => l.type === 'COMBO');
          for (const line of comboLines) {
            const cRev = Number(line.lineTotal || 0);
            const cUnits = Number(line.quantity || 1);
            totalCombosSold += cUnits;
            totalComboRevenue += cRev;
            const compUnits = Array.isArray(line.components)
              ? line.components.reduce((sum: number, c: any) => sum + (Number(c.totalQuantity) || Number(c.quantity) * cUnits || 0), 0)
              : cUnits;
            totalComboUnits += compUnits;

            const cId = line.comboId || line.name || 'unknown';
            const cName = line.name || 'Special Combo';

            if (!comboBreakdownMap[cId]) {
              comboBreakdownMap[cId] = {
                comboId: line.comboId || cId,
                comboName: cName,
                salesCount: 0,
                revenue: 0,
                unitsSold: 0,
              };
            }
            comboBreakdownMap[cId].salesCount += 1;
            comboBreakdownMap[cId].revenue += cRev;
            comboBreakdownMap[cId].unitsSold += cUnits;
          }
        } else if (s.transactionType === 'COMBO' || Boolean(s.comboId)) {
          const cRev = Number(s.totalAmount);
          totalCombosSold += 1;
          totalComboRevenue += cRev;
          const cUnits = (s.items || []).reduce((sum, item) => sum + item.quantity, 0) || s.quantity || 1;
          totalComboUnits += cUnits;

          const cId = s.comboId || s.comboName || 'unknown';
          const cName = s.comboName || (s.comboId ? `Combo ${s.comboId}` : 'Special Combo');

          if (!comboBreakdownMap[cId]) {
            comboBreakdownMap[cId] = {
              comboId: s.comboId || cId,
              comboName: cName,
              salesCount: 0,
              revenue: 0,
              unitsSold: 0,
            };
          }
          comboBreakdownMap[cId].salesCount++;
          comboBreakdownMap[cId].revenue += cRev;
          comboBreakdownMap[cId].unitsSold += cUnits;
        }
      }

      const comboBreakdown = Object.values(comboBreakdownMap).map((c: any) => ({
        ...c,
        revenue: canViewRevenue ? c.revenue : undefined,
      }));

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
        gameAnalytics: {
          totalGamesPlayed,
          totalGameRevenue: canViewRevenue ? totalGameRevenue : null,
          totalWins,
          totalLosses,
          winRate: gameWinRate,
          totalRewardsIssued,
          estimatedRewardValue: canViewRevenue ? estimatedRewardValue : null,
          gameBreakdown,
          eventBreakdown: eventGameBreakdown,
        },
        comboAnalytics: {
          totalCombosSold,
          totalComboRevenue: canViewRevenue ? totalComboRevenue : null,
          totalComboUnits,
          comboBreakdown,
        },
      });
    } catch (error) {
      console.error('Fetch analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  }
);

export default router;
