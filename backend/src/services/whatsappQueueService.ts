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

export interface ReconciliationItem {
  receiptNumber: number;
  saleId?: number | null;
  customerName: string | null;
  customerPhone: string;
  totalAmount: number;
  transactionType: string;
  saleTime: Date | string;
  eventName?: string;
  status: 'DELIVERED' | 'QUEUED' | 'SKIPPED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
  reason: string;
  suggestedAction?: string;
}

export interface ReconciliationReport {
  scanned: number;
  checkpointReceipt: number;
  scannedAfterCheckpoint: number;
  queuedUnsent: number;
  alreadyDelivered: number;
  flaggedUnknown: number;
  skippedIneligible: number;
  failedInvalid: number;
  cancelled: number;
  skippedAlreadyTracked: number;
  items: ReconciliationItem[];
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
    const hasPhone = rawPhone.length > 0;

    const idempotencyKey = `sale_${params.saleId ?? 'standalone'}_rcpt_${params.receiptNumber}_bill`;
    const initialStatus = isValidPhone ? 'QUEUED' : (!hasPhone ? 'SKIPPED' : 'FAILED');
    const lastError = isValidPhone
      ? null
      : (!hasPhone ? 'No customer phone provided at checkout' : 'Invalid customer phone number format');

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
          : (!hasPhone ? 'Bill skipped: no customer phone number provided.' : 'Bill rejected: invalid phone number format.'),
      },
    ];

    const existingRecord = await prisma.whatsAppDelivery.findUnique({
      where: { idempotencyKey },
    });

    if (existingRecord) {
      // Do not overwrite delivered or sent bills
      if (['DELIVERED', 'SENT', 'SENDING'].includes(existingRecord.status)) {
        return { id: existingRecord.id, status: existingRecord.status };
      }

      // If it was skipped or failed and now has valid phone, promote to QUEUED
      const nextStatus = isValidPhone ? 'QUEUED' : (!hasPhone ? 'SKIPPED' : 'FAILED');
      const audit = Array.isArray(existingRecord.auditLog) ? (existingRecord.auditLog as any[]) : [];
      audit.push({
        timestamp: new Date().toISOString(),
        action: 'UPDATED',
        status: nextStatus,
        details: 'Delivery details updated.',
      });

      const updated = await prisma.whatsAppDelivery.update({
        where: { id: existingRecord.id },
        data: {
          customerPhone: rawPhone,
          customerName: params.customerName || existingRecord.customerName,
          billSnapshot: deliveryPayload as any,
          status: nextStatus,
          nextAttemptAt: isValidPhone ? new Date() : null,
          lastError,
          auditLog: audit as any,
        },
      });

      return { id: updated.id, status: updated.status };
    }

    const record = await prisma.whatsAppDelivery.create({
      data: {
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
   * Helper to extract canonical commercial items for WhatsApp receipts
   */
  public extractBillItems(sale: any): Array<{ productName: string; quantity: number; unitPrice: number; lineTotal: number }> {
    // 1. If cartSnapshot exists and is non-empty, use canonical commercial items
    if (Array.isArray(sale.cartSnapshot) && sale.cartSnapshot.length > 0) {
      return sale.cartSnapshot.map((item: any) => ({
        productName: item.type === 'COMBO' ? `[Combo] ${item.name}` : item.name,
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || 0,
        lineTotal: Number(item.lineTotal) || 0,
      }));
    }

    // 2. Physical items from sale.items
    if (Array.isArray(sale.items) && sale.items.length > 0) {
      return sale.items.map((i: any) => ({
        productName: i.product?.name || i.productId,
        quantity: Number(i.quantity) || 1,
        unitPrice: Number(i.unitPrice) || 0,
        lineTotal: Number(i.lineTotal) || 0,
      }));
    }

    // 3. Fallback for Game transactions
    if (sale.transactionType === 'GAME') {
      return [{
        productName: sale.game?.name ? `Game: ${sale.game.name}` : 'Game Session',
        quantity: 1,
        unitPrice: Number(sale.totalAmount) || 0,
        lineTotal: Number(sale.totalAmount) || 0,
      }];
    }

    // 4. Default single-item fallback
    return [{
      productName: sale.comboName || 'Products',
      quantity: sale.quantity || 1,
      unitPrice: Number(sale.unitPrice || sale.totalAmount) || 0,
      lineTotal: Number(sale.totalAmount) || 0,
    }];
  }

  /**
   * Preview historical bill recovery without modifying database
   */
  public async previewHistoricalReconciliation(checkpointReceipt: number = 355): Promise<ReconciliationReport> {
    const ws = getWhatsAppService();
    const allSales = await prisma.sale.findMany({
      include: {
        event: true,
        items: { include: { product: true } },
        whatsappDelivery: true,
      },
      orderBy: { receiptNumber: 'asc' },
    });

    const items: ReconciliationItem[] = [];
    let queuedUnsent = 0;
    let alreadyDelivered = 0;
    let flaggedUnknown = 0;
    let skippedIneligible = 0;
    let failedInvalid = 0;
    let cancelled = 0;
    let skippedAlreadyTracked = 0;
    let scannedAfterCheckpoint = 0;

    for (const s of allSales) {
      const isPostCheckpoint = s.receiptNumber > checkpointReceipt;
      const isCheckpoint = s.receiptNumber === checkpointReceipt;

      if (isPostCheckpoint) {
        scannedAfterCheckpoint++;
      }

      // Check if already tracked in WhatsAppDelivery
      if (s.whatsappDelivery) {
        skippedAlreadyTracked++;
        items.push({
          receiptNumber: s.receiptNumber,
          saleId: s.id,
          customerName: s.customerName,
          customerPhone: s.customerPhone || '',
          totalAmount: Number(s.totalAmount),
          transactionType: s.transactionType,
          saleTime: s.saleTime || s.createdAt,
          eventName: s.event?.name,
          status: s.whatsappDelivery.status as any,
          reason: `Already tracked in queue with status ${s.whatsappDelivery.status}`,
        });
        continue;
      }

      // Checkpoint receipt #355
      if (isCheckpoint) {
        alreadyDelivered++;
        items.push({
          receiptNumber: s.receiptNumber,
          saleId: s.id,
          customerName: s.customerName,
          customerPhone: s.customerPhone || '',
          totalAmount: Number(s.totalAmount),
          transactionType: s.transactionType,
          saleTime: s.saleTime || s.createdAt,
          eventName: s.event?.name,
          status: 'DELIVERED',
          reason: 'Historical checkpoint #355: confirmed successfully sent.',
        });
        continue;
      }

      // Post-checkpoint sales (> 355)
      if (isPostCheckpoint) {
        if (s.status === 'CANCELLED') {
          cancelled++;
          items.push({
            receiptNumber: s.receiptNumber,
            saleId: s.id,
            customerName: s.customerName,
            customerPhone: s.customerPhone || '',
            totalAmount: Number(s.totalAmount),
            transactionType: s.transactionType,
            saleTime: s.saleTime || s.createdAt,
            eventName: s.event?.name,
            status: 'CANCELLED',
            reason: 'Sale voided / cancelled. Will not be sent.',
          });
          continue;
        }

        const rawPhone = (s.customerPhone || '').trim();
        if (!rawPhone) {
          skippedIneligible++;
          items.push({
            receiptNumber: s.receiptNumber,
            saleId: s.id,
            customerName: s.customerName,
            customerPhone: '',
            totalAmount: Number(s.totalAmount),
            transactionType: s.transactionType,
            saleTime: s.saleTime || s.createdAt,
            eventName: s.event?.name,
            status: 'SKIPPED',
            reason: 'Missing customer phone number at checkout.',
            suggestedAction: 'Collect phone number from customer to enable sending.',
          });
          continue;
        }

        const jid = typeof ws?.formatPhoneToJid === 'function'
          ? ws.formatPhoneToJid(rawPhone)
          : (rawPhone.replace(/\D/g, '').length >= 10 ? `${rawPhone}@s.whatsapp.net` : null);

        if (jid) {
          queuedUnsent++;
          items.push({
            receiptNumber: s.receiptNumber,
            saleId: s.id,
            customerName: s.customerName,
            customerPhone: rawPhone,
            totalAmount: Number(s.totalAmount),
            transactionType: s.transactionType,
            saleTime: s.saleTime || s.createdAt,
            eventName: s.event?.name,
            status: 'QUEUED',
            reason: 'Eligible bill after checkpoint #355. Ready for automated delivery.',
          });
        } else {
          failedInvalid++;
          // Detect swapped name/phone (e.g. #386)
          const nameLooksLikePhone = typeof ws?.formatPhoneToJid === 'function'
            ? Boolean(ws.formatPhoneToJid(s.customerName || ''))
            : (s.customerName || '').replace(/\D/g, '').length === 10;

          const swapHint = nameLooksLikePhone
            ? ` Note: Customer name "${s.customerName}" appears to be a valid phone number.`
            : '';

          items.push({
            receiptNumber: s.receiptNumber,
            saleId: s.id,
            customerName: s.customerName,
            customerPhone: rawPhone,
            totalAmount: Number(s.totalAmount),
            transactionType: s.transactionType,
            saleTime: s.saleTime || s.createdAt,
            eventName: s.event?.name,
            status: 'FAILED',
            reason: `Invalid phone number format "${rawPhone}".${swapHint}`,
            suggestedAction: nameLooksLikePhone
              ? `Swap customer name "${s.customerName}" and phone "${rawPhone}" to queue.`
              : 'Correct phone number format to retry.',
          });
        }
        continue;
      }

      // Pre-checkpoint sales (< 355)
      const rawPhone = (s.customerPhone || '').trim();
      if (rawPhone) {
        flaggedUnknown++;
        items.push({
          receiptNumber: s.receiptNumber,
          saleId: s.id,
          customerName: s.customerName,
          customerPhone: rawPhone,
          totalAmount: Number(s.totalAmount),
          transactionType: s.transactionType,
          saleTime: s.saleTime || s.createdAt,
          eventName: s.event?.name,
          status: 'UNKNOWN',
          reason: 'Pre-checkpoint transaction. Recorded as UNKNOWN for safe audit review.',
          suggestedAction: 'Review delivery status manually. Never auto-sent.',
        });
      }
    }

    return {
      scanned: allSales.length,
      checkpointReceipt,
      scannedAfterCheckpoint,
      queuedUnsent,
      alreadyDelivered,
      flaggedUnknown,
      skippedIneligible,
      failedInvalid,
      cancelled,
      skippedAlreadyTracked,
      items,
    };
  }

  /**
   * Reconcile historical bills idempotently
   */
  public async reconcileHistoricalBills(
    options?: { checkpointReceipt?: number; includePreCheckpointAsUnknown?: boolean } | Date
  ): Promise<{
    scanned: number;
    checkpointReceipt: number;
    queuedUnsent: number;
    alreadyDelivered: number;
    flaggedUnknown: number;
    skippedIneligible: number;
    failedInvalid: number;
    cancelled: number;
    skippedAlreadyTracked: number;
  }> {
    const checkpointReceipt = typeof options === 'object' && options && 'checkpointReceipt' in options
      ? (options.checkpointReceipt || 355)
      : 355;
    const includePre = typeof options === 'object' && options && 'includePreCheckpointAsUnknown' in options
      ? options.includePreCheckpointAsUnknown !== false
      : true;

    const ws = getWhatsAppService();
    const allSales = await prisma.sale.findMany({
      include: {
        event: true,
        items: { include: { product: true } },
        whatsappDelivery: true,
      },
      orderBy: { receiptNumber: 'asc' },
    });

    let queuedUnsent = 0;
    let alreadyDelivered = 0;
    let flaggedUnknown = 0;
    let skippedIneligible = 0;
    let failedInvalid = 0;
    let cancelled = 0;
    let skippedAlreadyTracked = 0;

    for (const s of allSales) {
      const isPostCheckpoint = s.receiptNumber > checkpointReceipt;
      const isCheckpoint = s.receiptNumber === checkpointReceipt;

      // Skip already tracked delivery records to prevent any modification of delivered/sent jobs
      if (s.whatsappDelivery) {
        skippedAlreadyTracked++;
        continue;
      }

      const rawPhone = (s.customerPhone || '').trim();
      const items = this.extractBillItems(s);
      const deliveryPayload: SaleReceiptPayload = {
        phone: rawPhone,
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
        saleTime: s.saleTime || s.createdAt,
      };

      const idempotencyKey = `sale_${s.id}_rcpt_${s.receiptNumber}_bill`;

      // 1. Checkpoint bill #355: confirmed successfully sent
      if (isCheckpoint) {
        await prisma.whatsAppDelivery.create({
          data: {
            receiptNumber: s.receiptNumber,
            saleId: s.id,
            customerName: s.customerName,
            customerPhone: rawPhone,
            billSnapshot: deliveryPayload as any,
            messageType: 'SALE_RECEIPT',
            status: 'DELIVERED',
            sentAt: s.saleTime || s.createdAt,
            deliveredAt: s.saleTime || s.createdAt,
            attemptCount: 1,
            idempotencyKey,
            auditLog: [
              {
                timestamp: new Date().toISOString(),
                action: 'CHECKPOINT_RECORD',
                status: 'DELIVERED',
                details: `Historical checkpoint bill #${s.receiptNumber}: confirmed sent via WhatsApp.`,
              },
            ] as any,
          },
        });
        alreadyDelivered++;
        continue;
      }

      // 2. Post-checkpoint sales (> 355)
      if (isPostCheckpoint) {
        if (s.status === 'CANCELLED') {
          await prisma.whatsAppDelivery.create({
            data: {
              receiptNumber: s.receiptNumber,
              saleId: s.id,
              customerName: s.customerName,
              customerPhone: rawPhone,
              billSnapshot: deliveryPayload as any,
              messageType: 'SALE_RECEIPT',
              status: 'CANCELLED',
              lastError: 'Underlying sale was cancelled / voided',
              idempotencyKey,
              auditLog: [
                {
                  timestamp: new Date().toISOString(),
                  action: 'HISTORICAL_RECONCILIATION',
                  status: 'CANCELLED',
                  details: 'Sale was cancelled. Bill delivery omitted.',
                },
              ] as any,
            },
          });
          cancelled++;
          continue;
        }

        if (!rawPhone) {
          await prisma.whatsAppDelivery.create({
            data: {
              receiptNumber: s.receiptNumber,
              saleId: s.id,
              customerName: s.customerName,
              customerPhone: '',
              billSnapshot: deliveryPayload as any,
              messageType: 'SALE_RECEIPT',
              status: 'SKIPPED',
              lastError: 'Missing customer phone number at checkout',
              idempotencyKey,
              auditLog: [
                {
                  timestamp: new Date().toISOString(),
                  action: 'HISTORICAL_RECONCILIATION',
                  status: 'SKIPPED',
                  details: 'Ineligible: customer phone number was not provided at checkout.',
                },
              ] as any,
            },
          });
          skippedIneligible++;
          continue;
        }

        const jid = typeof ws?.formatPhoneToJid === 'function'
          ? ws.formatPhoneToJid(rawPhone)
          : (rawPhone.replace(/\D/g, '').length >= 10 ? `${rawPhone}@s.whatsapp.net` : null);

        if (jid) {
          await prisma.whatsAppDelivery.create({
            data: {
              receiptNumber: s.receiptNumber,
              saleId: s.id,
              customerName: s.customerName,
              customerPhone: rawPhone,
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
                  details: `Unsent bill after checkpoint #${checkpointReceipt} recovered. Queued for controlled delivery.`,
                },
              ] as any,
            },
          });
          queuedUnsent++;
        } else {
          const nameLooksLikePhone = (s.customerName || '').replace(/\D/g, '').length === 10;
          const swapHint = nameLooksLikePhone
            ? ` Note: Customer name "${s.customerName}" appears to be a phone number.`
            : '';

          await prisma.whatsAppDelivery.create({
            data: {
              receiptNumber: s.receiptNumber,
              saleId: s.id,
              customerName: s.customerName,
              customerPhone: rawPhone,
              billSnapshot: deliveryPayload as any,
              messageType: 'SALE_RECEIPT',
              status: 'FAILED',
              lastError: `Invalid customer phone format: "${rawPhone}".${swapHint}`,
              idempotencyKey,
              auditLog: [
                {
                  timestamp: new Date().toISOString(),
                  action: 'HISTORICAL_RECONCILIATION',
                  status: 'FAILED',
                  details: `Bill delivery rejected due to invalid phone number format: "${rawPhone}".${swapHint}`,
                },
              ] as any,
            },
          });
          failedInvalid++;
        }
        continue;
      }

      // 3. Pre-checkpoint sales (< 355) with customer phone
      if (includePre && rawPhone) {
        await prisma.whatsAppDelivery.create({
          data: {
            receiptNumber: s.receiptNumber,
            saleId: s.id,
            customerName: s.customerName,
            customerPhone: rawPhone,
            billSnapshot: deliveryPayload as any,
            messageType: 'SALE_RECEIPT',
            status: 'UNKNOWN',
            idempotencyKey,
            auditLog: [
              {
                timestamp: new Date().toISOString(),
                action: 'HISTORICAL_RECONCILIATION',
                status: 'UNKNOWN',
                details: `Sale completed prior to checkpoint #${checkpointReceipt}. Flagged for review; duplicate dispatch prohibited.`,
              },
            ] as any,
          },
        });
        flaggedUnknown++;
      }
    }

    return {
      scanned: allSales.length,
      checkpointReceipt,
      queuedUnsent,
      alreadyDelivered,
      flaggedUnknown,
      skippedIneligible,
      failedInvalid,
      cancelled,
      skippedAlreadyTracked,
    };
  }

  /**
   * Edit customer phone number for a delivery and queue it
   */
  public async editDeliveryPhone(
    deliveryId: string,
    newPhone: string,
    newCustomerName?: string
  ): Promise<boolean> {
    const delivery = await prisma.whatsAppDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) return false;

    if (delivery.status === 'DELIVERED') {
      throw new Error('Cannot edit phone number for a bill that is already delivered.');
    }

    const ws = getWhatsAppService();
    const formattedJid = typeof ws?.formatPhoneToJid === 'function'
      ? ws.formatPhoneToJid(newPhone)
      : (newPhone.replace(/\D/g, '').length >= 10 ? `${newPhone}@s.whatsapp.net` : null);

    if (!formattedJid) {
      throw new Error(`Invalid phone number format: "${newPhone}". Must be a valid 10-15 digit phone number.`);
    }

    const rawPhone = newPhone.trim();
    const customerName = newCustomerName !== undefined ? newCustomerName.trim() : delivery.customerName;

    const currentSnapshot = (delivery.billSnapshot as any) || {};
    const updatedSnapshot = {
      ...currentSnapshot,
      phone: rawPhone,
      customerName: customerName || undefined,
    };

    const audit = Array.isArray(delivery.auditLog) ? (delivery.auditLog as any[]) : [];
    audit.push({
      timestamp: new Date().toISOString(),
      action: 'OPERATOR_PHONE_UPDATE',
      details: `Phone updated from "${delivery.customerPhone}" to "${rawPhone}" by operator. Queued for delivery.`,
    });

    await prisma.whatsAppDelivery.update({
      where: { id: deliveryId },
      data: {
        customerPhone: rawPhone,
        customerName: customerName || null,
        billSnapshot: updatedSnapshot as any,
        status: 'QUEUED',
        nextAttemptAt: new Date(),
        lastError: null,
        auditLog: audit as any,
      },
    });

    if (delivery.saleId) {
      try {
        await prisma.sale.update({
          where: { id: delivery.saleId },
          data: {
            customerPhone: rawPhone,
            customerName: customerName || undefined,
          },
        });
      } catch (e) {
        console.warn('[WhatsAppQueue] Note: Could not update underlying sale customerPhone:', e);
      }
    }

    return true;
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

    // Efficient single groupBy query to avoid exhausting connection pool
    const statusGroups = await prisma.whatsAppDelivery.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const byStatus: Record<string, number> = {
      PENDING: 0,
      QUEUED: 0,
      SENDING: 0,
      SENT: 0,
      DELIVERED: 0,
      FAILED: 0,
      UNKNOWN: 0,
      CANCELLED: 0,
      SKIPPED: 0,
    };

    let total = 0;
    for (const g of statusGroups) {
      const count = g._count.id;
      byStatus[g.status] = count;
      total += count;
    }

    const [sentToday, lastDeliveryRow, lastErrorRow] = await Promise.all([
      prisma.whatsAppDelivery.count({
        where: {
          status: { in: ['SENT', 'DELIVERED'] },
          sentAt: { gte: startOfToday },
        },
      }),
      prisma.whatsAppDelivery.findFirst({
        where: { status: 'DELIVERED' },
        orderBy: { deliveredAt: 'desc' },
        select: { deliveredAt: true },
      }),
      prisma.whatsAppDelivery.findFirst({
        where: { lastError: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: { lastError: true, updatedAt: true },
      }),
    ]);

    const totalPending = byStatus.PENDING || 0;
    const totalQueued = byStatus.QUEUED || 0;
    const totalSending = byStatus.SENDING || 0;
    const totalSent = byStatus.SENT || 0;
    const totalDelivered = byStatus.DELIVERED || 0;
    const totalFailed = byStatus.FAILED || 0;
    const totalUnknown = byStatus.UNKNOWN || 0;
    const totalCancelled = byStatus.CANCELLED || 0;
    const totalSkipped = byStatus.SKIPPED || 0;

    const config = await this.getConfig();
    const nextSlotInMs = Math.max(0, this.nextDispatchAllowedAt - Date.now());

    // Calculate approximate completion time
    const eligibleCount = totalPending + totalQueued;
    const avgDelaySec = (config.minIntervalSeconds + config.maxIntervalSeconds) / 2;
    const estimatedTotalSeconds = eligibleCount * avgDelaySec + Math.ceil(nextSlotInMs / 1000);

    return {
      total,
      byStatus,
      totalPending,
      totalQueued,
      totalSending,
      totalSent,
      totalDelivered,
      totalFailed,
      totalUnknown,
      totalCancelled,
      totalSkipped,
      pendingCount: totalPending + totalQueued,
      failedCount: totalFailed,
      unknownCount: totalUnknown,
      skippedCount: totalSkipped,
      todayCount: sentToday,
      todaySent: sentToday,
      sentToday,
      eligibleCount,
      nextSlotInMs,
      estimatedTotalSeconds,
      lastDeliveredAt: lastDeliveryRow?.deliveredAt || null,
      lastError: lastErrorRow?.lastError || null,
      checkpointReceipt: 355,
      config,
    };
  }
}

export const whatsappQueueService = new WhatsAppQueueService();
