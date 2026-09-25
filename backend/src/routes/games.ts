import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { requireRoles } from '../middleware/rbac';
import { sanitizeSaleForUser } from '../middleware/piiSanitizer';
import { broadcast } from '../sockets';
import { Role, GameStatus, GameResult, PaymentMethod, TransactionType, GameSessionStatus } from '@prisma/client';
import { computeEventStatus, reconcileSingleEvent } from '../services/eventLifecycle';

const router = Router();

// GET /api/games: List all games with live reward stock and aggregate metrics
router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { status, eventId, projectId, search } = req.query;

      const whereClause: any = {};

      if (status && (status === 'ACTIVE' || status === 'INACTIVE')) {
        whereClause.status = status as GameStatus;
      }

      if (eventId) {
        whereClause.eventId = String(eventId);
      }

      if (projectId) {
        whereClause.projectId = String(projectId);
      }

      if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        whereClause.OR = [
          { name: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ];
      }

      const games = await prisma.game.findMany({
        where: whereClause,
        include: {
          project: {
            select: { id: true, name: true, code: true },
          },
          event: {
            select: { id: true, name: true, status: true, startDatetime: true, endDatetime: true },
          },
          winRewardProduct: {
            include: {
              inventory: true,
              project: { select: { id: true, name: true } },
            },
          },
          loseRewardProduct: {
            include: {
              inventory: true,
              project: { select: { id: true, name: true } },
            },
          },
          sessions: {
            where: { status: GameSessionStatus.COMPLETED },
            select: {
              id: true,
              result: true,
              entryFee: true,
              rewardQuantity: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const formatted = games.map(game => {
        const totalPlays = game.sessions.length;
        const wins = game.sessions.filter(s => s.result === GameResult.WIN).length;
        const losses = game.sessions.filter(s => s.result === GameResult.LOSE).length;
        const winRate = totalPlays > 0 ? Math.round((wins / totalPlays) * 1000) / 10 : 0;
        const totalRevenue = game.sessions.reduce((sum, s) => sum + Number(s.entryFee), 0);
        const totalRewardsIssued = game.sessions.reduce((sum, s) => sum + (s.rewardQuantity || 1), 0);

        const winRewardStock = game.winRewardProduct.inventory?.quantityOnHand ?? 0;
        const loseRewardStock = game.loseRewardProduct?.inventory?.quantityOnHand ?? 0;

        return {
          id: game.id,
          name: game.name,
          description: game.description,
          projectId: game.projectId,
          projectName: game.project?.name || null,
          projectCode: game.project?.code || null,
          eventId: game.eventId,
          eventName: game.event?.name || null,
          eventStatus: game.event?.status || null,
          entryFee: Number(game.entryFee),
          status: game.status,
          winReward: {
            productId: game.winRewardProductId,
            productName: game.winRewardProduct.name,
            quantity: game.winRewardQuantity,
            availableStock: winRewardStock,
            isLowStock: winRewardStock > 0 && winRewardStock <= 5,
            isOutOfStock: winRewardStock <= 0,
          },
          loseReward: game.loseRewardProduct
            ? {
                productId: game.loseRewardProductId,
                productName: game.loseRewardProduct.name,
                quantity: game.loseRewardQuantity,
                availableStock: loseRewardStock,
                isLowStock: loseRewardStock > 0 && loseRewardStock <= 5,
                isOutOfStock: loseRewardStock <= 0,
              }
            : null,
          stats: {
            totalPlays,
            wins,
            losses,
            winRate,
            totalRevenue,
            totalRewardsIssued,
          },
          createdAt: game.createdAt,
          updatedAt: game.updatedAt,
        };
      });

      res.json({ games: formatted });
    } catch (error) {
      console.error('Fetch games error:', error);
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  }
);

// GET /api/games/analytics: Game analytics overview, game-wise, and event-wise breakdown
router.get(
  '/analytics',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { eventId, startDate, endDate } = req.query;

      const sessionWhere: any = { status: GameSessionStatus.COMPLETED };
      if (eventId) sessionWhere.eventId = String(eventId);
      if (startDate || endDate) {
        sessionWhere.createdAt = {};
        if (startDate) sessionWhere.createdAt.gte = new Date(String(startDate));
        if (endDate) sessionWhere.createdAt.lte = new Date(String(endDate));
      }

      const sessions = await prisma.gameSession.findMany({
        where: sessionWhere,
        include: {
          game: {
            include: { project: true },
          },
          event: true,
          rewardProduct: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      let totalGamesPlayed = sessions.length;
      let totalGameRevenue = 0;
      let totalWins = 0;
      let totalLosses = 0;
      let totalRewardsIssued = 0;
      let estimatedRewardValue = 0;

      const gameMap: Record<
        string,
        {
          gameId: string;
          gameName: string;
          projectName: string;
          plays: number;
          revenue: number;
          wins: number;
          losses: number;
          rewardsIssued: number;
          estimatedRewardCost: number;
        }
      > = {};

      const eventMap: Record<
        string,
        {
          eventId: string;
          eventName: string;
          plays: number;
          revenue: number;
          wins: number;
          losses: number;
          rewardsIssued: number;
        }
      > = {};

      for (const s of sessions) {
        const fee = Number(s.entryFee);
        totalGameRevenue += fee;
        totalRewardsIssued += s.rewardQuantity;

        const prodBasePrice = s.rewardProduct?.basePrice ? Number(s.rewardProduct.basePrice) : 0;
        estimatedRewardValue += prodBasePrice * s.rewardQuantity;

        if (s.result === GameResult.WIN) {
          totalWins++;
        } else {
          totalLosses++;
        }

        // Per game
        if (!gameMap[s.gameId]) {
          gameMap[s.gameId] = {
            gameId: s.gameId,
            gameName: s.game.name,
            projectName: s.game.project?.name || 'Upcycle',
            plays: 0,
            revenue: 0,
            wins: 0,
            losses: 0,
            rewardsIssued: 0,
            estimatedRewardCost: 0,
          };
        }
        gameMap[s.gameId].plays++;
        gameMap[s.gameId].revenue += fee;
        gameMap[s.gameId].rewardsIssued += s.rewardQuantity;
        gameMap[s.gameId].estimatedRewardCost += prodBasePrice * s.rewardQuantity;
        if (s.result === GameResult.WIN) {
          gameMap[s.gameId].wins++;
        } else {
          gameMap[s.gameId].losses++;
        }

        // Per event
        if (!eventMap[s.eventId]) {
          eventMap[s.eventId] = {
            eventId: s.eventId,
            eventName: s.event.name,
            plays: 0,
            revenue: 0,
            wins: 0,
            losses: 0,
            rewardsIssued: 0,
          };
        }
        eventMap[s.eventId].plays++;
        eventMap[s.eventId].revenue += fee;
        eventMap[s.eventId].rewardsIssued += s.rewardQuantity;
        if (s.result === GameResult.WIN) {
          eventMap[s.eventId].wins++;
        } else {
          eventMap[s.eventId].losses++;
        }
      }

      const winRate = totalGamesPlayed > 0 ? Math.round((totalWins / totalGamesPlayed) * 1000) / 10 : 0;

      const gameBreakdown = Object.values(gameMap).map(g => ({
        ...g,
        winRate: g.plays > 0 ? Math.round((g.wins / g.plays) * 1000) / 10 : 0,
      }));

      const eventBreakdown = Object.values(eventMap).map(e => ({
        ...e,
        winRate: e.plays > 0 ? Math.round((e.wins / e.plays) * 1000) / 10 : 0,
      }));

      res.json({
        overview: {
          totalGamesPlayed,
          totalGameRevenue,
          totalWins,
          totalLosses,
          winRate,
          totalRewardsIssued,
          estimatedRewardValue,
        },
        gameBreakdown,
        eventBreakdown,
      });
    } catch (error) {
      console.error('Fetch game analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch game analytics' });
    }
  }
);

// GET /api/games/sessions: Paginated game sessions ledger
router.get(
  '/sessions',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        gameId,
        eventId,
        result,
        paymentMethod,
        search,
        page: rawPage,
        pageSize: rawPageSize,
        all,
      } = req.query;

      const whereClause: any = {};

      if (gameId) whereClause.gameId = String(gameId);
      if (eventId) whereClause.eventId = String(eventId);
      if (result && (result === 'WIN' || result === 'LOSE')) {
        whereClause.result = result as GameResult;
      }
      if (paymentMethod && (paymentMethod === 'CASH' || paymentMethod === 'UPI' || paymentMethod === 'CASH_UPI')) {
        whereClause.paymentMethod = paymentMethod as PaymentMethod;
      }

      if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        const searchConditions: any[] = [
          { sessionCode: { contains: term, mode: 'insensitive' } },
          { customerName: { contains: term, mode: 'insensitive' } },
          { customerPhone: { contains: term, mode: 'insensitive' } },
          { sellerName: { contains: term, mode: 'insensitive' } },
          { sellerUsername: { contains: term, mode: 'insensitive' } },
          { game: { name: { contains: term, mode: 'insensitive' } } },
          { event: { name: { contains: term, mode: 'insensitive' } } },
          { rewardProduct: { name: { contains: term, mode: 'insensitive' } } },
        ];
        const num = parseInt(term.replace(/^#/, ''), 10);
        if (!isNaN(num)) {
          searchConditions.push({ receiptNumber: num });
        }
        whereClause.AND = whereClause.AND ? [...whereClause.AND, { OR: searchConditions }] : [{ OR: searchConditions }];
      }

      // Member sees only their sessions
      if (req.user?.role === Role.MEMBER) {
        whereClause.sellerId = req.user.id;
      }

      const isAll = all === 'true' || all === '1';
      const page = Math.max(1, parseInt(String(rawPage || '1'), 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(String(rawPageSize || '10'), 10) || 10));
      const skip = isAll ? undefined : (page - 1) * pageSize;
      const take = isAll ? undefined : pageSize;

      const [totalRecords, sessions, summaryRevenue] = await Promise.all([
        prisma.gameSession.count({ where: whereClause }),
        prisma.gameSession.findMany({
          where: whereClause,
          include: {
            game: {
              include: { project: true },
            },
            event: {
              select: { id: true, name: true, location: true },
            },
            rewardProduct: {
              select: { id: true, name: true, projectId: true },
            },
            seller: {
              select: { id: true, name: true, username: true, department: true },
            },
          },
          orderBy: [{ receiptNumber: 'desc' }, { createdAt: 'desc' }],
          skip,
          take,
        }),
        prisma.gameSession.aggregate({
          where: whereClause,
          _sum: { entryFee: true, rewardQuantity: true },
        }),
      ]);

      const formatted = sessions.map(s => ({
        id: s.id,
        sessionCode: s.sessionCode,
        receiptNumber: s.receiptNumber,
        gameId: s.gameId,
        gameName: s.game.name,
        projectId: s.game.projectId,
        projectName: s.game.project?.name || '',
        eventId: s.eventId,
        eventName: s.event.name,
        sellerId: s.sellerId,
        sellerName: s.sellerName || s.seller?.name || 'Unknown Member',
        sellerUsername: s.sellerUsername || s.seller?.username || '',
        entryFee: Number(s.entryFee),
        paymentMethod: s.paymentMethod,
        cashAmount: s.cashAmount !== null ? Number(s.cashAmount) : s.paymentMethod === 'CASH' ? Number(s.entryFee) : 0,
        upiAmount: s.upiAmount !== null ? Number(s.upiAmount) : s.paymentMethod === 'UPI' ? Number(s.entryFee) : 0,
        result: s.result,
        rewardProductId: s.rewardProductId,
        rewardProductName: s.rewardProduct.name,
        rewardQuantity: s.rewardQuantity,
        rewardDescription: `${s.rewardProduct.name} × ${s.rewardQuantity}`,
        customerName: s.customerName,
        customerPhone: s.customerPhone,
        status: s.status,
        createdAt: s.createdAt,
      }));

      const totalPages = isAll ? 1 : Math.ceil(totalRecords / pageSize);

      res.json({
        sessions: formatted,
        pagination: {
          page,
          pageSize,
          totalRecords,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        summary: {
          totalRevenue: Number(summaryRevenue._sum.entryFee || 0),
          totalRewardsIssued: Number(summaryRevenue._sum.rewardQuantity || 0),
        },
      });
    } catch (error) {
      console.error('Fetch game sessions error:', error);
      res.status(500).json({ error: 'Failed to fetch game sessions' });
    }
  }
);

// GET /api/games/:id: Single game details with recent activity
router.get(
  '/:id',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const game = await prisma.game.findUnique({
        where: { id },
        include: {
          project: true,
          event: true,
          winRewardProduct: {
            include: { inventory: true },
          },
          loseRewardProduct: {
            include: { inventory: true },
          },
          sessions: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            include: {
              rewardProduct: true,
              seller: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!game) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }

      const totalPlays = await prisma.gameSession.count({
        where: { gameId: id, status: GameSessionStatus.COMPLETED },
      });
      const wins = await prisma.gameSession.count({
        where: { gameId: id, result: GameResult.WIN, status: GameSessionStatus.COMPLETED },
      });
      const losses = await prisma.gameSession.count({
        where: { gameId: id, result: GameResult.LOSE, status: GameSessionStatus.COMPLETED },
      });
      const revAgg = await prisma.gameSession.aggregate({
        where: { gameId: id, status: GameSessionStatus.COMPLETED },
        _sum: { entryFee: true, rewardQuantity: true },
      });

      const winStock = game.winRewardProduct.inventory?.quantityOnHand ?? 0;
      const loseStock = game.loseRewardProduct?.inventory?.quantityOnHand ?? 0;

      res.json({
        game: {
          id: game.id,
          name: game.name,
          description: game.description,
          projectId: game.projectId,
          projectName: game.project?.name,
          eventId: game.eventId,
          eventName: game.event?.name,
          entryFee: Number(game.entryFee),
          status: game.status,
          winReward: {
            productId: game.winRewardProductId,
            productName: game.winRewardProduct.name,
            quantity: game.winRewardQuantity,
            availableStock: winStock,
            isLowStock: winStock > 0 && winStock <= 5,
            isOutOfStock: winStock <= 0,
          },
          loseReward: game.loseRewardProduct
            ? {
                productId: game.loseRewardProductId,
                productName: game.loseRewardProduct.name,
                quantity: game.loseRewardQuantity,
                availableStock: loseStock,
                isLowStock: loseStock > 0 && loseStock <= 5,
                isOutOfStock: loseStock <= 0,
              }
            : null,
          stats: {
            totalPlays,
            wins,
            losses,
            winRate: totalPlays > 0 ? Math.round((wins / totalPlays) * 1000) / 10 : 0,
            revenue: Number(revAgg._sum.entryFee || 0),
            rewardsIssued: Number(revAgg._sum.rewardQuantity || 0),
          },
          recentSessions: game.sessions.map(s => ({
            id: s.id,
            sessionCode: s.sessionCode,
            receiptNumber: s.receiptNumber,
            result: s.result,
            rewardDescription: `${s.rewardProduct.name} × ${s.rewardQuantity}`,
            entryFee: Number(s.entryFee),
            paymentMethod: s.paymentMethod,
            sellerName: s.sellerName || s.seller?.name || 'Member',
            customerName: s.customerName,
            createdAt: s.createdAt,
          })),
          createdAt: game.createdAt,
          updatedAt: game.updatedAt,
        },
      });
    } catch (error) {
      console.error('Fetch game details error:', error);
      res.status(500).json({ error: 'Failed to fetch game details' });
    }
  }
);

// POST /api/games: Create a new game configuration (ADMIN / DEVELOPER)
router.post(
  '/',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        name,
        description,
        projectId,
        eventId,
        entryFee,
        status,
        winRewardProductId,
        winRewardQuantity,
        loseRewardProductId,
        loseRewardQuantity,
      } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Game name is required' });
        return;
      }

      const fee = parseFloat(String(entryFee));
      if (isNaN(fee) || fee < 0) {
        res.status(400).json({ error: 'Entry fee must be a non-negative number' });
        return;
      }

      if (!winRewardProductId) {
        res.status(400).json({ error: 'Win reward product is required' });
        return;
      }

      const winProduct = await prisma.product.findUnique({
        where: { id: winRewardProductId },
      });
      if (!winProduct || winProduct.isDeleted) {
        res.status(400).json({ error: `Win reward product (${winRewardProductId}) not found` });
        return;
      }

      const winQty = parseInt(String(winRewardQuantity || '1'), 10);
      if (isNaN(winQty) || winQty <= 0) {
        res.status(400).json({ error: 'Win reward quantity must be a positive integer' });
        return;
      }

      let loseProdId = loseRewardProductId ? String(loseRewardProductId).trim() : null;
      let loseQty = 1;
      if (loseProdId) {
        const loseProduct = await prisma.product.findUnique({
          where: { id: loseProdId },
        });
        if (!loseProduct || loseProduct.isDeleted) {
          res.status(400).json({ error: `Lose reward product (${loseProdId}) not found` });
          return;
        }
        loseQty = parseInt(String(loseRewardQuantity || '1'), 10);
        if (isNaN(loseQty) || loseQty <= 0) {
          res.status(400).json({ error: 'Lose reward quantity must be a positive integer' });
          return;
        }
      } else {
        loseProdId = null;
      }

      let resolvedProjectId = projectId ? String(projectId) : winProduct.projectId;

      const newGame = await prisma.game.create({
        data: {
          name: name.trim(),
          description: description ? String(description).trim() : null,
          projectId: resolvedProjectId,
          eventId: eventId ? String(eventId) : null,
          entryFee: fee,
          status: status === 'INACTIVE' ? GameStatus.INACTIVE : GameStatus.ACTIVE,
          winRewardProductId,
          winRewardQuantity: winQty,
          loseRewardProductId: loseProdId,
          loseRewardQuantity: loseQty,
        },
        include: {
          project: true,
          event: true,
          winRewardProduct: true,
          loseRewardProduct: true,
        },
      });

      broadcast('game:updated', { action: 'created', gameId: newGame.id });

      res.status(201).json({
        message: 'Game created successfully',
        game: newGame,
      });
    } catch (error) {
      console.error('Create game error:', error);
      res.status(500).json({ error: 'Failed to create game' });
    }
  }
);

// PUT /api/games/:id: Edit game configuration (ADMIN / DEVELOPER)
router.put(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        projectId,
        eventId,
        entryFee,
        status,
        winRewardProductId,
        winRewardQuantity,
        loseRewardProductId,
        loseRewardQuantity,
      } = req.body;

      const existing = await prisma.game.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }

      const updateData: any = {};

      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          res.status(400).json({ error: 'Game name cannot be empty' });
          return;
        }
        updateData.name = name.trim();
      }

      if (description !== undefined) {
        updateData.description = description ? String(description).trim() : null;
      }

      if (entryFee !== undefined) {
        const fee = parseFloat(String(entryFee));
        if (isNaN(fee) || fee < 0) {
          res.status(400).json({ error: 'Entry fee must be a non-negative number' });
          return;
        }
        updateData.entryFee = fee;
      }

      if (status !== undefined) {
        updateData.status = status === 'INACTIVE' ? GameStatus.INACTIVE : GameStatus.ACTIVE;
      }

      if (projectId !== undefined) {
        updateData.projectId = projectId ? String(projectId) : null;
      }

      if (eventId !== undefined) {
        updateData.eventId = eventId ? String(eventId) : null;
      }

      if (winRewardProductId !== undefined) {
        const winProduct = await prisma.product.findUnique({
          where: { id: winRewardProductId },
        });
        if (!winProduct || winProduct.isDeleted) {
          res.status(400).json({ error: `Win reward product (${winRewardProductId}) not found` });
          return;
        }
        updateData.winRewardProductId = winRewardProductId;
      }

      if (winRewardQuantity !== undefined) {
        const winQty = parseInt(String(winRewardQuantity), 10);
        if (isNaN(winQty) || winQty <= 0) {
          res.status(400).json({ error: 'Win reward quantity must be positive' });
          return;
        }
        updateData.winRewardQuantity = winQty;
      }

      if (loseRewardProductId !== undefined) {
        if (loseRewardProductId) {
          const loseProduct = await prisma.product.findUnique({
            where: { id: loseRewardProductId },
          });
          if (!loseProduct || loseProduct.isDeleted) {
            res.status(400).json({ error: `Lose reward product (${loseRewardProductId}) not found` });
            return;
          }
          updateData.loseRewardProductId = loseRewardProductId;
        } else {
          updateData.loseRewardProductId = null;
        }
      }

      if (loseRewardQuantity !== undefined) {
        const loseQty = parseInt(String(loseRewardQuantity), 10);
        if (isNaN(loseQty) || loseQty <= 0) {
          res.status(400).json({ error: 'Lose reward quantity must be positive' });
          return;
        }
        updateData.loseRewardQuantity = loseQty;
      }

      const updated = await prisma.game.update({
        where: { id },
        data: updateData,
        include: {
          project: true,
          event: true,
          winRewardProduct: true,
          loseRewardProduct: true,
        },
      });

      broadcast('game:updated', { action: 'updated', gameId: updated.id });

      res.json({
        message: 'Game updated successfully',
        game: updated,
      });
    } catch (error) {
      console.error('Update game error:', error);
      res.status(500).json({ error: 'Failed to update game' });
    }
  }
);

// PATCH /api/games/:id/status: Toggle status between ACTIVE and INACTIVE
router.patch(
  '/:id/status',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const existing = await prisma.game.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }

      const targetStatus = status
        ? (status.toUpperCase() as GameStatus)
        : existing.status === GameStatus.ACTIVE
        ? GameStatus.INACTIVE
        : GameStatus.ACTIVE;

      const updated = await prisma.game.update({
        where: { id },
        data: { status: targetStatus },
      });

      broadcast('game:updated', { action: 'status_changed', gameId: updated.id, status: targetStatus });

      res.json({
        message: `Game status changed to ${targetStatus}`,
        game: updated,
      });
    } catch (error) {
      console.error('Change game status error:', error);
      res.status(500).json({ error: 'Failed to change game status' });
    }
  }
);

// DELETE /api/games/:id: Safe delete (DEVELOPER ONLY) — blocks if historical sessions exist
router.delete(
  '/:id',
  authenticateToken,
  requireRoles(Role.DEVELOPER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const existing = await prisma.game.findUnique({
        where: { id },
        include: { sessions: true },
      });

      if (!existing) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }

      if (existing.sessions.length > 0) {
        res.status(400).json({
          error: `Cannot delete game "${existing.name}" because it has ${existing.sessions.length} historical game play record(s). Deactivate the game instead to preserve audit logs.`,
        });
        return;
      }

      await prisma.game.delete({ where: { id } });
      broadcast('game:updated', { action: 'deleted', gameId: id });

      res.json({ message: `Game "${existing.name}" deleted successfully` });
    } catch (error) {
      console.error('Delete game error:', error);
      res.status(500).json({ error: 'Failed to delete game' });
    }
  }
);

// POST /api/games/play: Atomic transaction for game play, result, inventory deduction, and receipt generation
// Accessible by: DEVELOPER, ADMIN, HEAD, MEMBER
router.post(
  '/play',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        gameId,
        eventId,
        result,
        paymentMethod,
        cashAmount,
        upiAmount,
        customerName,
        customerPhone,
        clientTxId,
      } = req.body;

      if (!gameId) {
        res.status(400).json({ error: 'Game ID is required' });
        return;
      }

      if (!eventId) {
        res.status(400).json({ error: 'Event / Stall ID is required' });
        return;
      }

      const normResult = String(result).toUpperCase();
      if (normResult !== 'WIN' && normResult !== 'LOSE') {
        res.status(400).json({ error: 'Game result must be WIN or LOSE' });
        return;
      }

      // Check payment method
      const rawMethod = String(paymentMethod || '').toUpperCase().replace(/[\s\+]/g, '_');
      let normMethod: PaymentMethod;
      if (rawMethod === 'CASH') {
        normMethod = PaymentMethod.CASH;
      } else if (rawMethod === 'UPI') {
        normMethod = PaymentMethod.UPI;
      } else if (rawMethod === 'CASH_UPI' || rawMethod === 'CASH_AND_UPI' || rawMethod === 'SPLIT') {
        normMethod = PaymentMethod.CASH_UPI;
      } else {
        res.status(400).json({ error: 'Payment method must be CASH, UPI, or CASH + UPI' });
        return;
      }

      // Fetch game and event
      const game = await prisma.game.findUnique({
        where: { id: gameId },
        include: {
          project: true,
          winRewardProduct: { include: { inventory: true } },
          loseRewardProduct: { include: { inventory: true } },
        },
      });

      if (!game) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }

      if (game.status === GameStatus.INACTIVE) {
        res.status(400).json({ error: `Game "${game.name}" is currently INACTIVE. Please contact the administrator.` });
        return;
      }

      const event = await prisma.event.findUnique({
        where: { id: eventId },
      });

      if (!event || event.isDeleted) {
        res.status(404).json({ error: 'Event not found or inactive' });
        return;
      }

      const eventStatus = computeEventStatus(event.startDatetime, event.endDatetime, event.status);
      const isPastEnd = new Date().getTime() >= new Date(event.endDatetime).getTime();

      if (eventStatus === 'ENDED' || event.status === 'ENDED' || isPastEnd) {
        if (!event.reconciledAt) {
          reconcileSingleEvent(event.id).catch(err =>
            console.error('Failed to reconcile ended event on game play:', err)
          );
        }
        res.status(400).json({ error: 'This event has ended and is no longer accepting transactions.' });
        return;
      }

      if (eventStatus === 'UPCOMING' || new Date().getTime() < new Date(event.startDatetime).getTime()) {
        res.status(400).json({ error: 'This event has not started yet.' });
        return;
      }

      // Determine Reward
      let rewardProductId: string;
      let rewardQuantity: number;
      let rewardProductObj: any;

      if (normResult === 'WIN') {
        rewardProductId = game.winRewardProductId;
        rewardQuantity = game.winRewardQuantity;
        rewardProductObj = game.winRewardProduct;
      } else {
        if (game.loseRewardProductId && game.loseRewardProduct) {
          rewardProductId = game.loseRewardProductId;
          rewardQuantity = game.loseRewardQuantity;
          rewardProductObj = game.loseRewardProduct;
        } else {
          // If no lose reward configured, use win product or 0
          rewardProductId = game.winRewardProductId;
          rewardQuantity = 0;
          rewardProductObj = game.winRewardProduct;
        }
      }

      // Check Inventory Stock
      if (rewardQuantity > 0) {
        const currentInv = await prisma.inventory.findUnique({
          where: { productId: rewardProductId },
          include: { product: true },
        });

        const stockOnHand = currentInv?.quantityOnHand ?? 0;
        if (stockOnHand < rewardQuantity) {
          res.status(400).json({
            error: `Reward stock unavailable: ${rewardProductObj.name} is OUT OF STOCK (${stockOnHand} available, ${rewardQuantity} required). Inventory cannot become negative. Please reconfigure game rewards or restock inventory.`,
            productId: rewardProductId,
            productName: rewardProductObj.name,
            availableStock: stockOnHand,
          });
          return;
        }
      }

      const entryFeeNum = Number(game.entryFee);

      // Validate payment split
      let resolvedCashAmount: number;
      let resolvedUpiAmount: number;

      if (normMethod === PaymentMethod.CASH_UPI) {
        const cashVal = parseFloat(String(cashAmount ?? ''));
        const upiVal = parseFloat(String(upiAmount ?? ''));

        if (isNaN(cashVal) || isNaN(upiVal) || cashVal < 0 || upiVal < 0) {
          res.status(400).json({
            error: 'Cash and UPI amounts must be non-negative numbers for split payment',
          });
          return;
        }

        const totalSplitCents = Math.round((cashVal + upiVal) * 100);
        const grandTotalCents = Math.round(entryFeeNum * 100);

        if (totalSplitCents !== grandTotalCents) {
          res.status(400).json({
            error: `Split payment total (₹${(totalSplitCents / 100).toFixed(2)}) must exactly match entry fee (₹${(grandTotalCents / 100).toFixed(2)})`,
            cashAmount: cashVal,
            upiAmount: upiVal,
            billTotal: entryFeeNum,
          });
          return;
        }

        resolvedCashAmount = Math.round(cashVal * 100) / 100;
        resolvedUpiAmount = Math.round(upiVal * 100) / 100;
      } else if (normMethod === PaymentMethod.CASH) {
        resolvedCashAmount = entryFeeNum;
        resolvedUpiAmount = 0;
      } else {
        resolvedCashAmount = 0;
        resolvedUpiAmount = entryFeeNum;
      }

      // Execute in atomic Prisma transaction
      const transactionResult = await prisma.$transaction(async tx => {
        // Idempotency check if clientTxId supplied
        if (clientTxId) {
          const existingSession = await tx.gameSession.findFirst({
            where: {
              sale: { clientTxId: String(clientTxId) },
            },
            include: {
              game: true,
              event: true,
              rewardProduct: true,
              sale: true,
            },
          });
          if (existingSession) {
            return {
              isDuplicate: true,
              gameSession: existingSession,
              sale: existingSession.sale,
              rewardProduct: existingSession.rewardProduct,
            };
          }
        }

        // 1. Deduct Reward from Inventory atomically
        if (rewardQuantity > 0) {
          const updatedInv = await tx.inventory.update({
            where: { productId: rewardProductId },
            data: {
              quantityOnHand: { decrement: rewardQuantity },
              lastUpdated: new Date(),
              notes: `Reward issued for game "${game.name}" (${normResult})`,
            },
          });

          if (updatedInv.quantityOnHand < 0) {
            throw new Error(`Insufficient stock for ${rewardProductObj.name}. Inventory cannot become negative.`);
          }
        }

        // 2. Allocate next canonical sequential receipt number
        const [{ nextVal }] = await tx.$queryRaw<[{ nextVal: bigint | number }]>`
          SELECT nextval('receipt_number_seq')::bigint as "nextVal"
        `;
        const receiptNumber = Number(nextVal);

        // 3. Allocate next unique Game Session code (e.g. GS-000001)
        const [{ nextCode }] = await tx.$queryRaw<[{ nextCode: bigint | number }]>`
          SELECT nextval('game_session_code_seq')::bigint as "nextCode"
        `;
        const sessionCode = `GS-${String(Number(nextCode)).padStart(6, '0')}`;

        // 4. Create Sale Record in sales table
        const newSale = await tx.sale.create({
          data: {
            receiptNumber,
            transactionType: TransactionType.GAME,
            gameId: game.id,
            clientTxId: clientTxId ? String(clientTxId) : null,
            eventId,
            memberId: req.user!.id,
            sellerUserIdAtSale: req.user!.id,
            sellerUsernameAtSale: req.user!.username,
            sellerNameAtSale: req.user!.name,
            totalAmount: entryFeeNum,
            paymentMethod: normMethod,
            cashAmount: resolvedCashAmount,
            upiAmount: resolvedUpiAmount,
            customerName: customerName ? String(customerName).trim() : null,
            customerPhone: customerPhone ? String(customerPhone).trim() : null,
            saleTime: new Date(),
            items: rewardQuantity > 0
              ? {
                  create: [
                    {
                      productId: rewardProductId,
                      quantity: rewardQuantity,
                      unitPrice: 0,
                      lineTotal: 0,
                    },
                  ],
                }
              : undefined,
          },
          include: {
            event: true,
            member: true,
            items: {
              include: { product: { include: { project: true } } },
            },
          },
        });

        // 5. Create GameSession Record
        const newSession = await tx.gameSession.create({
          data: {
            sessionCode,
            gameId: game.id,
            eventId,
            sellerId: req.user!.id,
            sellerName: req.user!.name,
            sellerUsername: req.user!.username,
            saleId: newSale.id,
            receiptNumber,
            paymentMethod: normMethod,
            entryFee: entryFeeNum,
            cashAmount: resolvedCashAmount,
            upiAmount: resolvedUpiAmount,
            result: normResult as GameResult,
            rewardProductId,
            rewardQuantity,
            customerName: customerName ? String(customerName).trim() : null,
            customerPhone: customerPhone ? String(customerPhone).trim() : null,
            status: GameSessionStatus.COMPLETED,
          },
          include: {
            game: { include: { project: true } },
            event: true,
            rewardProduct: true,
          },
        });

        return {
          isDuplicate: false,
          gameSession: newSession,
          sale: newSale,
          rewardProduct: rewardProductObj,
        };
      });

      const { gameSession, sale, isDuplicate } = transactionResult;

      // Broadcast WebSocket updates
      if (!isDuplicate) {
        broadcast('sale:created', {
          id: sale?.id,
          receiptNumber: gameSession.receiptNumber,
          transactionType: 'GAME',
          gameName: game.name,
          totalAmount: entryFeeNum,
          timestamp: new Date().toISOString(),
        });

        broadcast('inventory:updated', {
          action: 'reward_issued',
          productId: rewardProductId,
          gameId: game.id,
          result: normResult,
          timestamp: new Date().toISOString(),
        });

        broadcast('game:played', {
          gameId: game.id,
          sessionCode: gameSession.sessionCode,
          result: normResult,
          receiptNumber: gameSession.receiptNumber,
        });
      }

      // Fetch remaining stock of the reward product
      const remainingInv = await prisma.inventory.findUnique({
        where: { productId: rewardProductId },
      });

      res.status(isDuplicate ? 200 : 201).json({
        message: isDuplicate ? 'Game session already recorded (idempotent)' : 'Game played and reward issued successfully!',
        receipt: {
          receiptNumber: gameSession.receiptNumber,
          receiptId: `#${gameSession.receiptNumber}`,
          sessionCode: gameSession.sessionCode,
          gameName: game.name,
          result: gameSession.result,
          rewardProductName: rewardProductObj.name,
          rewardQuantity,
          rewardDescription: `${rewardProductObj.name} × ${rewardQuantity}`,
          amountPaid: Number(gameSession.entryFee),
          paymentMethod: gameSession.paymentMethod,
          cashAmount: gameSession.cashAmount ? Number(gameSession.cashAmount) : 0,
          upiAmount: gameSession.upiAmount ? Number(gameSession.upiAmount) : 0,
          eventName: event.name,
          sellerName: req.user!.name,
          customerName: gameSession.customerName || 'Walk-in Player',
          customerPhone: gameSession.customerPhone || null,
          remainingRewardStock: remainingInv?.quantityOnHand ?? 0,
          timestamp: gameSession.createdAt,
        },
        session: gameSession,
      });
    } catch (error: any) {
      console.error('Play game error:', error);
      res.status(500).json({ error: error.message || 'Failed to process game play' });
    }
  }
);

export default router;
