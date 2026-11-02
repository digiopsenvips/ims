import { Router, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';
import { whatsappService } from '../services/whatsappService';
import { whatsappQueueService } from '../services/whatsappQueueService';
import { prisma } from '../config/prisma';

const router = Router();

// GET /api/whatsapp/status - Check connection status and QR code
router.get(
  '/status',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const status = whatsappService.getStatus();
      const config = await whatsappQueueService.getConfig();
      const summary = await whatsappQueueService.getSummaryStats();
      res.json({
        ...status,
        queueConfig: {
          isPaused: config.isPaused,
          circuitBreakerTripped: config.circuitBreakerTripped,
          pauseReason: config.pauseReason,
          autoSendEnabled: config.autoSendEnabled,
          minIntervalSeconds: config.minIntervalSeconds,
          maxIntervalSeconds: config.maxIntervalSeconds,
          maxDailyBudget: config.maxDailyBudget,
        },
        pendingCount: summary.pendingCount,
        nextSlotInMs: summary.nextSlotInMs,
        lastDeliveredAt: summary.lastDeliveredAt,
        checkpointReceipt: summary.checkpointReceipt,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to get WhatsApp status' });
    }
  }
);

// GET /api/whatsapp/queue/summary - Summary metrics for dashboard
router.get(
  '/queue/summary',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const summary = await whatsappQueueService.getSummaryStats();
      const gwStatus = whatsappService.getStatus();
      res.json({
        ...summary,
        gateway: gwStatus,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to fetch queue summary' });
    }
  }
);

// GET /api/whatsapp/queue - Paginated, filtered list of bill deliveries
router.get(
  '/queue',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const {
      page: rawPage,
      pageSize: rawPageSize,
      status,
      search,
      startDate,
      endDate,
    } = req.query;

    try {
      const page = Math.max(1, parseInt(String(rawPage || '1'), 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(String(rawPageSize || '20'), 10) || 20));
      const skip = (page - 1) * pageSize;

      const whereClause: any = {};

      if (status && typeof status === 'string' && status !== 'ALL') {
        whereClause.status = status;
      }

      if (search && typeof search === 'string' && search.trim() !== '') {
        const term = search.trim();
        const searchConditions: any[] = [
          { customerName: { contains: term, mode: 'insensitive' } },
          { customerPhone: { contains: term, mode: 'insensitive' } },
        ];
        const num = parseInt(term.replace(/^#/, ''), 10);
        if (!isNaN(num)) {
          searchConditions.push({ receiptNumber: num });
          searchConditions.push({ saleId: num });
        }
        whereClause.AND = whereClause.AND ? [...whereClause.AND, { OR: searchConditions }] : [{ OR: searchConditions }];
      }

      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) whereClause.createdAt.gte = new Date(String(startDate));
        if (endDate) whereClause.createdAt.lte = new Date(String(endDate));
      }

      const [totalRecords, deliveries] = await Promise.all([
        prisma.whatsAppDelivery.count({ where: whereClause }),
        prisma.whatsAppDelivery.findMany({
          where: whereClause,
          include: {
            sale: {
              select: {
                id: true,
                receiptNumber: true,
                totalAmount: true,
                paymentMethod: true,
                saleTime: true,
                event: {
                  select: {
                    id: true,
                    name: true,
                    location: true,
                  },
                },
              },
            },
          },
          orderBy: [
            { createdAt: 'desc' },
            { receiptNumber: 'desc' },
          ],
          skip,
          take: pageSize,
        }),
      ]);

      const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

      res.json({
        deliveries,
        total: totalRecords,
        pagination: {
          page,
          pageSize,
          totalRecords,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (error: any) {
      console.error('[WhatsAppQueue] Fetch deliveries error:', error);
      res.status(500).json({ error: error?.message || 'Failed to fetch deliveries' });
    }
  }
);

// GET /api/whatsapp/config - Get current queue pacing configuration
router.get(
  '/config',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const config = await whatsappQueueService.getConfig();
      res.json(config);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to fetch queue config' });
    }
  }
);

// PUT /api/whatsapp/config - Update queue pacing configuration
router.put(
  '/config',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        autoSendEnabled,
        minIntervalSeconds,
        maxIntervalSeconds,
        randomDelayEnabled,
        maxWindowMessages,
        windowMinutes,
        maxDailyBudget,
        maxRetries,
        retryBackoffMinutes,
        quietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
      } = req.body;

      const updates: any = {};
      if (typeof autoSendEnabled === 'boolean') updates.autoSendEnabled = autoSendEnabled;
      if (typeof minIntervalSeconds === 'number' && minIntervalSeconds >= 5) updates.minIntervalSeconds = minIntervalSeconds;
      if (typeof maxIntervalSeconds === 'number' && maxIntervalSeconds >= (updates.minIntervalSeconds || 10)) updates.maxIntervalSeconds = maxIntervalSeconds;
      if (typeof randomDelayEnabled === 'boolean') updates.randomDelayEnabled = randomDelayEnabled;
      if (typeof maxWindowMessages === 'number' && maxWindowMessages > 0) updates.maxWindowMessages = maxWindowMessages;
      if (typeof windowMinutes === 'number' && windowMinutes > 0) updates.windowMinutes = windowMinutes;
      if (typeof maxDailyBudget === 'number' && maxDailyBudget > 0) updates.maxDailyBudget = maxDailyBudget;
      if (typeof maxRetries === 'number' && maxRetries >= 1) updates.maxRetries = maxRetries;
      if (typeof retryBackoffMinutes === 'number' && retryBackoffMinutes >= 1) updates.retryBackoffMinutes = retryBackoffMinutes;
      if (typeof quietHoursEnabled === 'boolean') updates.quietHoursEnabled = quietHoursEnabled;
      if (typeof quietHoursStart === 'string') updates.quietHoursStart = quietHoursStart;
      if (typeof quietHoursEnd === 'string') updates.quietHoursEnd = quietHoursEnd;

      const updated = await whatsappQueueService.updateConfig(updates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to update queue config' });
    }
  }
);

// POST /api/whatsapp/queue/pause - Manually pause queue
router.post(
  '/queue/pause',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const reason = req.body.reason || 'Manually paused by operator';
      await whatsappQueueService.updateConfig({ isPaused: true, pauseReason: reason });
      res.json({ success: true, message: 'WhatsApp queue paused.' });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to pause queue' });
    }
  }
);

// POST /api/whatsapp/queue/resume - Resume queue and reset circuit breaker
router.post(
  '/queue/resume',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      await whatsappQueueService.resetCircuitBreaker();
      res.json({ success: true, message: 'WhatsApp queue resumed successfully.' });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to resume queue' });
    }
  }
);

// POST /api/whatsapp/queue/:id/retry - Re-queue a failed delivery
router.post(
  '/queue/:id/retry',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const success = await whatsappQueueService.retryDelivery(id);
      if (!success) {
        res.status(404).json({ error: 'Delivery record not found.' });
        return;
      }
      res.json({ success: true, message: 'Bill re-queued for delivery.' });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Failed to retry delivery' });
    }
  }
);

// POST /api/whatsapp/queue/:id/cancel - Cancel pending delivery
router.post(
  '/queue/:id/cancel',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const reason = req.body.reason || 'Cancelled by operator';
      const success = await whatsappQueueService.cancelDelivery(id, reason);
      if (!success) {
        res.status(404).json({ error: 'Delivery record not found.' });
        return;
      }
      res.json({ success: true, message: 'Delivery job cancelled.' });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Failed to cancel delivery' });
    }
  }
);

// POST /api/whatsapp/queue/:id/resolve - Resolve ambiguous UNKNOWN delivery
router.post(
  '/queue/:id/resolve',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { action, note } = req.body;
      if (!['MARK_DELIVERED', 'MARK_FAILED', 'RETRY_SEND'].includes(action)) {
        res.status(400).json({ error: 'Valid resolution action is required.' });
        return;
      }
      const success = await whatsappQueueService.resolveUnknown(id, action, note);
      if (!success) {
        res.status(404).json({ error: 'Unknown delivery record not found.' });
        return;
      }
      res.json({ success: true, message: `Delivery resolved: ${action}` });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Failed to resolve delivery' });
    }
  }
);

// GET /api/whatsapp/queue/reconcile-preview - Preview historical recovery
router.get(
  '/queue/reconcile-preview',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const checkpointReceipt = req.query.checkpointReceipt
        ? parseInt(String(req.query.checkpointReceipt), 10)
        : 355;
      const report = await whatsappQueueService.previewHistoricalReconciliation(checkpointReceipt);
      res.json(report);
    } catch (error: any) {
      console.error('[WhatsAppQueue] Reconciliation preview error:', error);
      res.status(500).json({ error: error?.message || 'Failed to preview reconciliation' });
    }
  }
);

// POST /api/whatsapp/queue/reconcile-historical - Reconcile historical sales
router.post(
  '/queue/reconcile-historical',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const checkpointReceipt = req.body.checkpointReceipt
        ? parseInt(String(req.body.checkpointReceipt), 10)
        : 355;
      const includePreCheckpointAsUnknown = req.body.includePreCheckpointAsUnknown !== false;

      const result = await whatsappQueueService.reconcileHistoricalBills({
        checkpointReceipt,
        includePreCheckpointAsUnknown,
      });

      res.json({
        success: true,
        message: `Historical recovery complete: ${result.queuedUnsent} bills queued for delivery, ${result.alreadyDelivered} confirmed delivered, ${result.skippedIneligible} skipped (no phone), ${result.failedInvalid} failed (invalid phone), ${result.cancelled} cancelled, ${result.flaggedUnknown} pre-checkpoint bills marked UNKNOWN.`,
        queued: result.queuedUnsent,
        queuedUnsent: result.queuedUnsent,
        delivered: result.alreadyDelivered,
        alreadyDelivered: result.alreadyDelivered,
        unknown: result.flaggedUnknown,
        flaggedUnknown: result.flaggedUnknown,
        skipped: result.skippedIneligible,
        skippedIneligible: result.skippedIneligible,
        failed: result.failedInvalid,
        failedInvalid: result.failedInvalid,
        cancelled: result.cancelled,
        alreadyTracked: result.skippedAlreadyTracked,
        skippedAlreadyTracked: result.skippedAlreadyTracked,
        details: result,
      });
    } catch (error: any) {
      console.error('[WhatsAppQueue] Reconciliation error:', error);
      res.status(500).json({ error: error?.message || 'Failed to reconcile historical bills' });
    }
  }
);

// PUT /api/whatsapp/queue/:id/phone - Update customer phone and queue bill
router.put(
  '/queue/:id/phone',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { phone, customerName } = req.body;
      if (!phone || typeof phone !== 'string' || !phone.trim()) {
        res.status(400).json({ error: 'Valid customer phone number is required.' });
        return;
      }
      const success = await whatsappQueueService.editDeliveryPhone(id, phone, customerName);
      if (!success) {
        res.status(404).json({ error: 'Delivery record not found.' });
        return;
      }
      res.json({ success: true, message: 'Phone number updated and bill queued for delivery.' });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Failed to update phone number' });
    }
  }
);

// POST /api/whatsapp/logout - Log out current WhatsApp session to link a new number
router.post(
  '/logout',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      await whatsappService.logout();
      await whatsappQueueService.tripCircuitBreaker('WhatsApp session logged out by operator.');
      res.json({ message: 'WhatsApp session cleared. Scan the new QR code to reconnect.' });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to logout WhatsApp session' });
    }
  }
);

// POST /api/whatsapp/test - Send a test WhatsApp message to verify the gateway
router.post(
  '/test',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { phone } = req.body;
    if (!phone) {
      res.status(400).json({ error: 'phone number is required' });
      return;
    }

    try {
      const result = await whatsappService.sendSaleReceipt({
        phone: String(phone),
        customerName: 'Valued Supporter',
        receiptNumber: 'TEST-PREVIEW',
        eventName: 'Enactus Gateway Test',
        eventLocation: 'Campus Stall',
        items: [
          {
            productName: 'Sample Seeded Pen',
            quantity: 1,
            unitPrice: 30,
            lineTotal: 30,
          },
        ],
        totalAmount: 30,
        paymentMethod: 'UPI',
        sellerName: req.user?.name || 'Enactus Team',
        saleTime: new Date(),
      });

      if (result.success) {
        // Reset circuit breaker on successful test
        await whatsappQueueService.resetCircuitBreaker();
        res.json({ message: 'Test message sent successfully!', messageId: result.messageId });
      } else {
        res.status(400).json({ error: result.error || 'Failed to send test message' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to send test message' });
    }
  }
);

// POST /api/whatsapp/send-receipt - Authorized re-enqueue of a stored receipt
router.post(
  '/send-receipt',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const receiptNumber = Number(req.body.receiptNumber);
    if (!Number.isSafeInteger(receiptNumber) || receiptNumber < 1) {
      res.status(400).json({ error: 'A stored receipt number is required.' });
      return;
    }
    try {
      const sale = await prisma.sale.findUnique({
        where: { receiptNumber },
        include: {
          event: true,
          items: { include: { product: true } },
          whatsappDelivery: true,
        },
      });
      const elevated = req.user?.role === Role.DEVELOPER || req.user?.role === Role.ADMIN;
      if (!sale || (!elevated && (sale.sellerUserIdAtSale || sale.memberId) !== req.user?.id)) {
        res.status(403).json({ error: 'Receipt access denied.' });
        return;
      }
      if (!sale.customerPhone || (req.body.phone && req.body.phone !== sale.customerPhone)) {
        res.status(400).json({ error: 'Receipt can only be sent to its recorded recipient.' });
        return;
      }

      // Check if already delivered
      if (sale.whatsappDelivery?.status === 'DELIVERED') {
        res.status(400).json({ error: 'This bill is already confirmed delivered to the customer.' });
        return;
      }

      const items = (sale.items && sale.items.length > 0)
        ? sale.items.map(item => ({
            productName: item.product.name,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            lineTotal: Number(item.lineTotal),
          }))
        : [{
            productName: sale.comboName || 'Products',
            quantity: sale.quantity || 1,
            unitPrice: Number(sale.unitPrice || sale.totalAmount),
            lineTotal: Number(sale.totalAmount),
          }];

      const enqueued = await whatsappQueueService.enqueueBill({
        saleId: sale.id,
        receiptNumber: sale.receiptNumber,
        customerName: sale.customerName || undefined,
        customerPhone: sale.customerPhone,
        eventName: sale.event.name,
        eventLocation: sale.event.location,
        items,
        totalAmount: Number(sale.totalAmount),
        paymentMethod: sale.paymentMethod,
        cashAmount: sale.cashAmount === null ? null : Number(sale.cashAmount),
        upiAmount: sale.upiAmount === null ? null : Number(sale.upiAmount),
        sellerName: sale.sellerNameAtSale || undefined,
        saleTime: sale.saleTime,
      });

      res.json({ success: true, message: 'Bill enqueued for WhatsApp delivery.', deliveryId: enqueued.id });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Receipt dispatch failed.' });
    }
  }
);

export default router;
