import { prisma } from '../config/prisma';
import type { SaleReceiptPayload } from './whatsappService';

function getWhatsAppService(): any {
  try {
    return require('./whatsappService').whatsappService;
  } catch {
    return null;
  }
}

export interface WhatsAppQueueConfig {
  autoSendEnabled: boolean;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  randomDelayEnabled: boolean;
  maxWindowMessages: number;
  windowMinutes: number;
  maxDailyBudget: number;
  maxRetries: number;
  retryBackoffMinutes: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // e.g. "23:00"
  quietHoursEnd: string;   // e.g. "08:00"
  isPaused: boolean;
  pauseReason: string | null;
  circuitBreakerTripped: boolean;
  consecutiveFailures: number;
}

export interface EnqueueReceiptParams {
  saleId?: number;
  receiptNumber: number;
  customerName?: string;
  customerPhone: string;
  eventName?: string;
  eventLocation?: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  totalAmount: number;
  paymentMethod: string;
  cashAmount?: number | null;
  upiAmount?: number | null;
  sellerName?: string;
  saleTime?: Date | string;
}

class WhatsAppQueueService {
  private isProcessing = false;
  private nextDispatchAllowedAt: number = 0;
  private workerInterval: NodeJS.Timeout | null = null;

  constructor() {
    if (typeof setInterval !== 'undefined' && process.env.NODE_ENV !== 'test') {
      this.startWorker();
    }
  }

  public startWorker(): void {
    if (this.workerInterval || typeof setInterval === 'undefined') return;
    this.workerInterval = setInterval(() => {
      this.tick().catch(err => console.error('[WhatsAppQueue] Worker tick error:', err));
    }, 4000);
    if (this.workerInterval && typeof this.workerInterval.unref === 'function') {
      this.workerInterval.unref();
    }
  }

  public stopWorker(): void {
    if (this.workerInterval && typeof clearInterval !== 'undefined') {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }
  }

  /**
   * Fetch current queue configuration from DB (or create defaults)
   */
  public async getConfig(): Promise<WhatsAppQueueConfig> {
    try {
      const row = await prisma.whatsAppConfig.findUnique({
        where: { id: 'default' },
      });
      if (row) {
        return {
          autoSendEnabled: row.autoSendEnabled,
          minIntervalSeconds: row.minIntervalSeconds,
          maxIntervalSeconds: row.maxIntervalSeconds,
          randomDelayEnabled: row.randomDelayEnabled,
          maxWindowMessages: row.maxWindowMessages,
          windowMinutes: row.windowMinutes,
          maxDailyBudget: row.maxDailyBudget,
          maxRetries: row.maxRetries,
          retryBackoffMinutes: row.retryBackoffMinutes,
          quietHoursEnabled: row.quietHoursEnabled,
          quietHoursStart: row.quietHoursStart,
          quietHoursEnd: row.quietHoursEnd,
          isPaused: row.isPaused,
          pauseReason: row.pauseReason,
          circuitBreakerTripped: row.circuitBreakerTripped,
          consecutiveFailures: row.consecutiveFailures,
        };
      }

      // Create initial default configuration row
      const created = await prisma.whatsAppConfig.create({
        data: {
          id: 'default',
          autoSendEnabled: true,
          minIntervalSeconds: 15,
          maxIntervalSeconds: 35,
          randomDelayEnabled: true,
          maxWindowMessages: 20,
          windowMinutes: 10,
          maxDailyBudget: 200,
          maxRetries: 3,
          retryBackoffMinutes: 5,
          quietHoursEnabled: false,
          quietHoursStart: '23:00',
          quietHoursEnd: '08:00',
          isPaused: false,
          circuitBreakerTripped: false,
          consecutiveFailures: 0,
        },
      });

      return {
        autoSendEnabled: created.autoSendEnabled,
        minIntervalSeconds: created.minIntervalSeconds,
        maxIntervalSeconds: created.maxIntervalSeconds,
        randomDelayEnabled: created.randomDelayEnabled,
        maxWindowMessages: created.maxWindowMessages,
        windowMinutes: created.windowMinutes,
        maxDailyBudget: created.maxDailyBudget,
        maxRetries: created.maxRetries,
        retryBackoffMinutes: created.retryBackoffMinutes,
        quietHoursEnabled: created.quietHoursEnabled,
        quietHoursStart: created.quietHoursStart,
        quietHoursEnd: created.quietHoursEnd,
        isPaused: created.isPaused,
        pauseReason: created.pauseReason,
        circuitBreakerTripped: created.circuitBreakerTripped,
        consecutiveFailures: created.consecutiveFailures,
      };
    } catch {
      // Fallback in-memory defaults if DB unreachable
      return {
        autoSendEnabled: true,
        minIntervalSeconds: 15,
        maxIntervalSeconds: 35,
        randomDelayEnabled: true,
        maxWindowMessages: 20,
        windowMinutes: 10,
        maxDailyBudget: 200,
        maxRetries: 3,
        retryBackoffMinutes: 5,
        quietHoursEnabled: false,
        quietHoursStart: '23:00',
        quietHoursEnd: '08:00',
        isPaused: false,
        pauseReason: null,
        circuitBreakerTripped: false,
        consecutiveFailures: 0,
      };
    }
  }

  /**
   * Update queue configuration
   */
  public async updateConfig(updates: Partial<WhatsAppQueueConfig>): Promise<WhatsAppQueueConfig> {
    await prisma.whatsAppConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...updates },
      update: { ...updates },
    });
    return this.getConfig();
  }

  /**
   * Check if current IST time falls within quiet hours
   */
  public isQuietHours(startStr: string, endStr: string): boolean {
    try {
      const now = new Date();
      // Format current time in Asia/Kolkata
      const kolkataTimeStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now);

      const [curH, curM] = kolkataTimeStr.split(':').map(Number);
      const [startH, startM] = startStr.split(':').map(Number);
      const [endH, endM] = endStr.split(':').map(Number);

      const curMins = curH * 60 + curM;
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;

      if (startMins <= endMins) {
        return curMins >= startMins && curMins < endMins;
      } else {
        // Overnight window e.g. 23:00 to 08:00
        return curMins >= startMins || curMins < endMins;
      }
    } catch {
      return false;
    }
  }

  /**
   * Enqueue a receipt for WhatsApp delivery
   */
  public async enqueueBill(params: EnqueueReceiptParams): Promise<{ id: string; status: string }> {
    const rawPhone = (params.customerPhone || '').trim();
    let formattedJid: string | null = null;
    const ws = getWhatsAppService();
    if (typeof ws?.formatPhoneToJid === 'function') {
      formattedJid = ws.formatPhoneToJid(rawPhone);
    } else {
      let cleaned = rawPhone.replace(/\D/g, '');
      if (cleaned.length === 10) cleaned = '91' + cleaned;
      formattedJid = (cleaned.length >= 10 && cleaned.length <= 15) ? `${cleaned}@s.whatsapp.net` : null;
    }
    const isValidPhone = Boolean(formattedJid);

    const idempotencyKey = `sale_${params.saleId ?? 'standalone'}_rcpt_${params.receiptNumber}_bill`;
    const initialStatus = isValidPhone ? 'QUEUED' : 'FAILED';
    const lastError = isValidPhone ? null : 'Invalid customer phone number format';

    const deliveryPayload: SaleReceiptPayload = {
      phone: rawPhone,
      customerName: params.customerName,
      receiptNumber: params.receiptNumber,
      eventName: params.eventName,
      eventLocation: params.eventLocation,
      items: params.items,
      totalAmount: params.totalAmount,
      paymentMethod: params.paymentMethod,
      cashAmount: params.cashAmount,
      upiAmount: params.upiAmount,
      sellerName: params.sellerName,
      saleTime: params.saleTime,
    };

    const initialAudit = [
      {
        timestamp: new Date().toISOString(),
        action: 'ENQUEUED',
        status: initialStatus,
        details: isValidPhone
          ? 'Bill queued for automated delivery.'
          : 'Bill delivery rejected: phone format invalid.',
      },
    ];

    const record = await prisma.whatsAppDelivery.upsert({
      where: { idempotencyKey },
      create: {
        receiptNumber: params.receiptNumber,
        saleId: params.saleId,
        customerName: params.customerName,
        customerPhone: rawPhone,
        billSnapshot: deliveryPayload as any,
        messageType: 'SALE_RECEIPT',
        status: initialStatus,
        nextAttemptAt: isValidPhone ? new Date() : null,
        lastError,
        idempotencyKey,
        auditLog: initialAudit as any,
      },
      update: {
        // If it was failed due to missing phone and updated, preserve existing record
        customerPhone: rawPhone,
        billSnapshot: deliveryPayload as any,
      },
    });

    return { id: record.id, status: record.status };
  }

  /**
   * Notify queue of gateway state changes
   */
  public notifyGatewayState(state: 'CONNECTED' | 'DISCONNECTED', number: string | null, error?: string | null): void {
    if (state === 'CONNECTED') {
      console.log(`[WhatsAppQueue] Gateway connected (+${number}). Queue dispatch eligible.`);
    } else {
      console.log(`[WhatsAppQueue] Gateway disconnected: ${error || 'Unknown'}`);
    }
  }

  /**
   * Trip the circuit breaker on severe error or restriction
   */
  public async tripCircuitBreaker(reason: string): Promise<void> {
    console.warn(`[WhatsAppQueue] ⚠️ Circuit breaker tripped: ${reason}`);
    try {
      await prisma.whatsAppConfig.upsert({
        where: { id: 'default' },
        create: {
          id: 'default',
          circuitBreakerTripped: true,
          isPaused: true,
          pauseReason: reason,
        },
        update: {
          circuitBreakerTripped: true,
          isPaused: true,
          pauseReason: reason,
        },
      });
    } catch (e) {
      console.error('[WhatsAppQueue] Error updating circuit breaker:', e);
    }
  }

  /**
   * Reset circuit breaker when operator resumes or tests connection
   */
  public async resetCircuitBreaker(): Promise<void> {
    await prisma.whatsAppConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', circuitBreakerTripped: false, consecutiveFailures: 0, isPaused: false, pauseReason: null },
      update: { circuitBreakerTripped: false, consecutiveFailures: 0, isPaused: false, pauseReason: null },
    });
  }

  /**
   * Periodic dispatch loop (Worker Tick)
   */
  public async tick(): Promise<void> {
    if (this.isProcessing) return;

    // Throttle check: ensure minimum server-side interval has elapsed
    if (Date.now() < this.nextDispatchAllowedAt) {
      return;
    }

    const config = await this.getConfig();

    // 1. Check if queue is paused or disabled
    if (config.isPaused || config.circuitBreakerTripped || !config.autoSendEnabled) {
      return;
    }

    // 2. Check quiet hours
    if (config.quietHoursEnabled && this.isQuietHours(config.quietHoursStart, config.quietHoursEnd)) {
      return;
    }

    // 3. Check WhatsApp gateway readiness
    const ws = getWhatsAppService();
    const gwStatus = ws?.getStatus() || { isConnected: false, status: 'DISCONNECTED', connectedNumber: null, qrDataUrl: null, lastError: null, storage: 'LOCAL' };
    if (!gwStatus.isConnected || gwStatus.status !== 'CONNECTED') {
      return;
    }

    // 4. Rate-limit budget checks: Daily Budget
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const sentTodayCount = await prisma.whatsAppDelivery.count({
      where: {
        status: { in: ['SENT', 'DELIVERED'] },
        sentAt: { gte: startOfToday },
      },
    });

    if (sentTodayCount >= config.maxDailyBudget) {
      console.log(`[WhatsAppQueue] Daily budget reached (${sentTodayCount}/${config.maxDailyBudget}). Pausing dispatch until tomorrow.`);
      return;
    }

    // 5. Rate-limit budget checks: Window Budget (e.g. 20 msgs / 10 mins)
    const windowStart = new Date(Date.now() - config.windowMinutes * 60 * 1000);
    const sentInWindowCount = await prisma.whatsAppDelivery.count({
      where: {
        status: { in: ['SENT', 'DELIVERED'] },
        sentAt: { gte: windowStart },
      },
    });

    if (sentInWindowCount >= config.maxWindowMessages) {
      this.nextDispatchAllowedAt = Date.now() + 60 * 1000; // wait 1 minute before rechecking window
      return;
    }

    // 6. Claim 1 eligible delivery atomically
    this.isProcessing = true;
    try {
      const now = new Date();
      const candidate = await prisma.whatsAppDelivery.findFirst({
        where: {
          status: { in: ['QUEUED', 'RETRY_WAIT', 'PENDING'] },
          OR: [
            { nextAttemptAt: null },
            { nextAttemptAt: { lte: now } },
          ],
        },
        orderBy: [
          { receiptNumber: 'asc' },
          { createdAt: 'asc' },
        ],
      });

      if (!candidate) {
        return;
      }

      // Atomically transition candidate to 'SENDING'
      const updated = await prisma.whatsAppDelivery.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
        },
        data: {
          status: 'SENDING',
          lastAttemptAt: now,
          attemptCount: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        // Concurrently claimed by another tick
        return;
      }

      console.log(`[WhatsAppQueue] Dispatching bill #${candidate.receiptNumber} to ${candidate.customerPhone} (Attempt ${candidate.attemptCount + 1})...`);

      // 7. Dispatch message via Baileys WhatsApp Gateway
      const payload = candidate.billSnapshot as any as SaleReceiptPayload;
      if (!ws) throw new Error('WhatsApp service unavailable');
      const sendResult = await ws.sendSaleReceipt(payload);

      // Compute randomized interval for next message (e.g. 15-35s)
      let intervalSec = config.minIntervalSeconds;
      if (config.randomDelayEnabled && config.maxIntervalSeconds > config.minIntervalSeconds) {
        intervalSec = Math.floor(
          config.minIntervalSeconds + Math.random() * (config.maxIntervalSeconds - config.minIntervalSeconds)
        );
      }
      this.nextDispatchAllowedAt = Date.now() + intervalSec * 1000;

      const existingAudit = Array.isArray(candidate.auditLog) ? (candidate.auditLog as any[]) : [];

      if (sendResult.success) {
        // Successfully accepted by WhatsApp server
        existingAudit.push({
          timestamp: new Date().toISOString(),
          action: 'SENT',
          providerMessageId: sendResult.messageId,
          details: `Accepted by WhatsApp server. Next message slot in ${intervalSec}s.`,
        });

        await prisma.whatsAppDelivery.update({
          where: { id: candidate.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            providerMessageId: sendResult.messageId,
            gatewaySession: gwStatus.connectedNumber,
            lastError: null,
            auditLog: existingAudit as any,
          },
        });

        // Reset consecutive failures
        if (config.consecutiveFailures > 0) {
          await prisma.whatsAppConfig.update({
            where: { id: 'default' },
            data: { consecutiveFailures: 0 },
          });
        }
      } else {
        // Failure handling
        const errText = sendResult.error || 'Message dispatch failed';
        const isAuthOrRestriction =
          errText.includes('not connected') ||
          errText.includes('logged out') ||
          errText.includes('restricted') ||
          errText.includes('401') ||
          errText.includes('403');

        if (isAuthOrRestriction) {
          existingAudit.push({
            timestamp: new Date().toISOString(),
            action: 'ERROR_PAUSE',
            error: errText,
            details: 'WhatsApp session restricted or disconnected. Tripping circuit breaker.',
          });

          await prisma.whatsAppDelivery.update({
            where: { id: candidate.id },
            data: {
              status: 'RETRY_WAIT',
              lastError: errText,
              auditLog: existingAudit as any,
            },
          });

          await this.tripCircuitBreaker(errText);
          return;
        }

        const newAttempts = candidate.attemptCount + 1;
        const canRetry = newAttempts < config.maxRetries;

        existingAudit.push({
          timestamp: new Date().toISOString(),
          action: canRetry ? 'RETRY_SCHEDULED' : 'FAILED',
          error: errText,
          attempt: newAttempts,
          details: canRetry
            ? `Retry #${newAttempts} scheduled in ${config.retryBackoffMinutes}m.`
            : `Max retries (${config.maxRetries}) exhausted. Marked FAILED.`,
        });

        const nextRetry = canRetry
          ? new Date(Date.now() + config.retryBackoffMinutes * 60 * 1000)
          : null;

        await prisma.whatsAppDelivery.update({
          where: { id: candidate.id },
          data: {
            status: canRetry ? 'RETRY_WAIT' : 'FAILED',
            lastError: errText,
            nextAttemptAt: nextRetry,
            auditLog: existingAudit as any,
          },
        });

        // Increment consecutive failure counter
        const newConsecutive = config.consecutiveFailures + 1;
        await prisma.whatsAppConfig.update({
          where: { id: 'default' },
          data: { consecutiveFailures: newConsecutive },
        });

        if (newConsecutive >= 5) {
          await this.tripCircuitBreaker('5 consecutive delivery failures detected. Circuit breaker engaged.');
        }
      }
    } catch (error: any) {
      console.error('[WhatsAppQueue] Processing error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Handle real-time delivery acknowledgement from WhatsApp (DELIVERY_ACK / READ)
   */
  public async handleDeliveryAck(providerMessageId: string, ackType: 'DELIVERED' | 'READ'): Promise<void> {
    try {
      const delivery = await prisma.whatsAppDelivery.findFirst({
        where: { providerMessageId },
      });

      if (!delivery) return;

      const existingAudit = Array.isArray(delivery.auditLog) ? (delivery.auditLog as any[]) : [];
      existingAudit.push({
        timestamp: new Date().toISOString(),
        action: ackType,
        details: `Confirmed ${ackType === 'READ' ? 'read receipt' : 'device delivery receipt'} from WhatsApp network.`,
      });

      await prisma.whatsAppDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: delivery.deliveredAt || new Date(),
          auditLog: existingAudit as any,
        },
      });

      console.log(`[WhatsAppQueue] 📲 Receipt #${delivery.receiptNumber} marked DELIVERED (Msg ID: ${providerMessageId})`);
    } catch (err) {
      console.error('[WhatsAppQueue] Error processing delivery ACK:', err);
    }
  }

  /**
   * Reconcile historical bills
   */
  public async reconcileHistoricalBills(cutoff: Date = new Date('2026-11-01T17:22:00+05:30')): Promise<{
    scanned: number;
    queuedUnsent: number;
    flaggedUnknown: number;
    skippedAlreadyTracked: number;
  }> {
    const salesWithPhone = await prisma.sale.findMany({
      where: {
        customerPhone: { not: null },
      },
      include: {
        event: true,
        items: { include: { product: true } },
        whatsappDelivery: true,
      },
      orderBy: { receiptNumber: 'asc' },
    });

    let queuedUnsent = 0;
    let flaggedUnknown = 0;
    let skippedAlreadyTracked = 0;

    for (const s of salesWithPhone) {
      const phone = (s.customerPhone || '').trim();
      if (!phone) continue;

      if (s.whatsappDelivery) {
        skippedAlreadyTracked++;
        continue;
      }

      const saleTime = new Date(s.saleTime || s.createdAt);
      const isAfterCutoff = saleTime.getTime() > cutoff.getTime();

      const items = (s.items && s.items.length > 0)
        ? s.items.map(i => ({
            productName: i.product?.name || i.productId,
            quantity: i.quantity,
            unitPrice: Number(i.unitPrice),
            lineTotal: Number(i.lineTotal),
          }))
        : [{
            productName: s.comboName || 'Products',
            quantity: s.quantity || 1,
            unitPrice: Number(s.unitPrice || s.totalAmount),
            lineTotal: Number(s.totalAmount),
          }];

      const deliveryPayload: SaleReceiptPayload = {
        phone,
        customerName: s.customerName || undefined,
        receiptNumber: s.receiptNumber,
        eventName: s.event?.name || 'Enactus Event',
        eventLocation: s.event?.location || '',
        items,
        totalAmount: Number(s.totalAmount),
        paymentMethod: s.paymentMethod,
        cashAmount: s.cashAmount ? Number(s.cashAmount) : null,
        upiAmount: s.upiAmount ? Number(s.upiAmount) : null,
        sellerName: s.sellerNameAtSale || undefined,
        saleTime,
      };

      const idempotencyKey = `sale_${s.id}_rcpt_${s.receiptNumber}_bill`;

      if (isAfterCutoff) {
        // Occurred after WhatsApp disconnected at 5:22 PM: reliably unattempted
        await prisma.whatsAppDelivery.create({
          data: {
            receiptNumber: s.receiptNumber,
            saleId: s.id,
            customerName: s.customerName,
            customerPhone: phone,
            billSnapshot: deliveryPayload as any,
            messageType: 'SALE_RECEIPT',
            status: 'QUEUED',
            nextAttemptAt: new Date(),
            idempotencyKey,
            auditLog: [
              {
                timestamp: new Date().toISOString(),
                action: 'HISTORICAL_RECONCILIATION',
                status: 'QUEUED',
                details: 'Sale created after WhatsApp disconnect on Nov 1 ~5:22 PM. Queued for delivery.',
              },
            ] as any,
          },
        });
        queuedUnsent++;
      } else {
        // Occurred before cutoff: may have already been delivered or attempted
        // Mark as UNKNOWN so operator can review and resolve without risk of duplicate sending
        await prisma.whatsAppDelivery.create({
          data: {
            receiptNumber: s.receiptNumber,
            saleId: s.id,
            customerName: s.customerName,
            customerPhone: phone,
            billSnapshot: deliveryPayload as any,
            messageType: 'SALE_RECEIPT',
            status: 'UNKNOWN',
            idempotencyKey,
            auditLog: [
              {
                timestamp: new Date().toISOString(),
                action: 'HISTORICAL_RECONCILIATION',
                status: 'UNKNOWN',
                details: 'Sale occurred prior to disconnect. Marked UNKNOWN for safe audit review.',
              },
            ] as any,
          },
        });
        flaggedUnknown++;
      }
    }

    return {
      scanned: salesWithPhone.length,
      queuedUnsent,
      flaggedUnknown,
      skippedAlreadyTracked,
    };
  }

  /**
   * Retry a failed or pending delivery
   */
  public async retryDelivery(deliveryId: string): Promise<boolean> {
    const delivery = await prisma.whatsAppDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) return false;

    // Never re-send a confirmed DELIVERED message
    if (delivery.status === 'DELIVERED') {
      throw new Error('This bill is already confirmed delivered to the customer. Duplicate sends are prohibited.');
    }

    const audit = Array.isArray(delivery.auditLog) ? (delivery.auditLog as any[]) : [];
    audit.push({
      timestamp: new Date().toISOString(),
      action: 'OPERATOR_RETRY',
      details: 'Authorized operator manually requested queue retry.',
    });

    await prisma.whatsAppDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'QUEUED',
        nextAttemptAt: new Date(),
        lastError: null,
        auditLog: audit as any,
      },
    });

    return true;
  }

  /**
   * Cancel an eligible pending delivery
   */
  public async cancelDelivery(deliveryId: string, reason: string): Promise<boolean> {
    const delivery = await prisma.whatsAppDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) return false;

    if (delivery.status === 'DELIVERED' || delivery.status === 'SENT') {
      throw new Error('Cannot cancel a bill that has already been dispatched or delivered.');
    }

    const audit = Array.isArray(delivery.auditLog) ? (delivery.auditLog as any[]) : [];
    audit.push({
      timestamp: new Date().toISOString(),
      action: 'OPERATOR_CANCEL',
      details: `Authorized operator cancelled delivery: ${reason}`,
    });

    await prisma.whatsAppDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'CANCELLED',
        lastError: reason,
        nextAttemptAt: null,
        auditLog: audit as any,
      },
    });

    return true;
  }

  /**
   * Resolve an UNKNOWN delivery status
   */
  public async resolveUnknown(
    deliveryId: string,
    action: 'MARK_DELIVERED' | 'MARK_FAILED' | 'RETRY_SEND',
    note?: string
  ): Promise<boolean> {
    const delivery = await prisma.whatsAppDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== 'UNKNOWN') return false;

    const audit = Array.isArray(delivery.auditLog) ? (delivery.auditLog as any[]) : [];

    if (action === 'MARK_DELIVERED') {
      audit.push({
        timestamp: new Date().toISOString(),
        action: 'MANUAL_RECONCILIATION',
        details: `Operator confirmed customer received bill: ${note || 'Verified'}`,
      });
      await prisma.whatsAppDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          auditLog: audit as any,
        },
      });
    } else if (action === 'MARK_FAILED') {
      audit.push({
        timestamp: new Date().toISOString(),
        action: 'MANUAL_RECONCILIATION',
        details: `Operator marked delivery failed: ${note || 'Cancelled'}`,
      });
      await prisma.whatsAppDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'FAILED',
          lastError: note || 'Marked failed during reconciliation',
          auditLog: audit as any,
        },
      });
    } else if (action === 'RETRY_SEND') {
      audit.push({
        timestamp: new Date().toISOString(),
        action: 'MANUAL_RECONCILIATION_RETRY',
        details: `Operator queued for send: ${note || 'Confirmed not received'}`,
      });
      await prisma.whatsAppDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'QUEUED',
          nextAttemptAt: new Date(),
          auditLog: audit as any,
        },
      });
    }

    return true;
  }

  /**
   * Get delivery statistics and summary counts
   */
  public async getSummaryStats() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      totalPending,
      totalQueued,
      totalSending,
      totalSent,
      totalDelivered,
      totalFailed,
      totalUnknown,
      totalCancelled,
      sentToday,
    ] = await Promise.all([
      prisma.whatsAppDelivery.count({ where: { status: 'PENDING' } }),
      prisma.whatsAppDelivery.count({ where: { status: 'QUEUED' } }),
      prisma.whatsAppDelivery.count({ where: { status: 'SENDING' } }),
      prisma.whatsAppDelivery.count({ where: { status: 'SENT' } }),
      prisma.whatsAppDelivery.count({ where: { status: 'DELIVERED' } }),
      prisma.whatsAppDelivery.count({ where: { status: 'FAILED' } }),
      prisma.whatsAppDelivery.count({ where: { status: 'UNKNOWN' } }),
      prisma.whatsAppDelivery.count({ where: { status: 'CANCELLED' } }),
      prisma.whatsAppDelivery.count({
        where: {
          status: { in: ['SENT', 'DELIVERED'] },
          sentAt: { gte: startOfToday },
        },
      }),
    ]);

    const config = await this.getConfig();
    const nextSlotInMs = Math.max(0, this.nextDispatchAllowedAt - Date.now());

    // Calculate approximate completion time
    const eligibleCount = totalPending + totalQueued;
    const avgDelaySec = (config.minIntervalSeconds + config.maxIntervalSeconds) / 2;
    const estimatedTotalSeconds = eligibleCount * avgDelaySec + Math.ceil(nextSlotInMs / 1000);

    return {
      totalPending,
      totalQueued,
      totalSending,
      totalSent,
      totalDelivered,
      totalFailed,
      totalUnknown,
      totalCancelled,
      sentToday,
      eligibleCount,
      nextSlotInMs,
      estimatedTotalSeconds,
      config,
    };
  }
}

export const whatsappQueueService = new WhatsAppQueueService();
