import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  WASocket,
  ConnectionState,
  initAuthCreds,
  BufferJSON,
  proto,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { prisma } from '../config/prisma';

export interface SaleReceiptPayload {
  phone: string;
  customerName?: string;
  receiptNumber: number | string;
  eventName?: string;
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

export interface WhatsAppStatus {
  isConnected: boolean;
  status: 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTING' | 'CONNECTED';
  connectedNumber: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
  storage: 'SUPABASE' | 'LOCAL';
}

class WhatsAppService {
  private sock: WASocket | null = null;
  private authDir: string;
  private isConnected = false;
  private status: 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTING' | 'CONNECTED' = 'DISCONNECTED';
  private currentQr: string | null = null;
  private currentQrDataUrl: string | null = null;
  private connectedNumber: string | null = null;
  private lastError: string | null = null;
  private isInitializing = false;
  private activeStorage: 'SUPABASE' | 'LOCAL' = 'LOCAL';

  constructor() {
    this.authDir = path.resolve(__dirname, '../../whatsapp-auth');
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
  }

  /**
   * Database-backed session store for Render + Supabase deployments.
   * Ensures WhatsApp authentication keys survive Render container restarts and redeployments.
   */
  private async getAuthState() {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS whatsapp_sessions (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);

      const credsRow = await prisma.$queryRaw<Array<{ value: string }>>`
        SELECT value FROM whatsapp_sessions WHERE key = 'creds' LIMIT 1
      `;

      let creds =
        credsRow && credsRow.length > 0 && credsRow[0].value
          ? JSON.parse(credsRow[0].value, BufferJSON.reviver)
          : initAuthCreds();

      this.activeStorage = 'SUPABASE';
      console.log('[WhatsApp] Using persistent Supabase database storage for session.');

      return {
        state: {
          creds,
          keys: {
            get: async (type: string, ids: string[]) => {
              const data: { [key: string]: any } = {};
              await Promise.all(
                ids.map(async (id) => {
                  const fullKey = `${type}-${id}`;
                  try {
                    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
                      SELECT value FROM whatsapp_sessions WHERE key = ${fullKey} LIMIT 1
                    `;
                    if (rows && rows.length > 0) {
                      let val = JSON.parse(rows[0].value, BufferJSON.reviver);
                      if (type === 'app-state-sync-key' && val) {
                        val = proto.Message.AppStateSyncKeyData.fromObject(val);
                      }
                      data[id] = val;
                    }
                  } catch {
                    // ignore key read errors
                  }
                })
              );
              return data;
            },
            set: async (data: any) => {
              for (const category in data) {
                for (const id in data[category]) {
                  const val = data[category][id];
                  const fullKey = `${category}-${id}`;
                  try {
                    if (val) {
                      const str = JSON.stringify(val, BufferJSON.replacer);
                      await prisma.$executeRawUnsafe(
                        `INSERT INTO whatsapp_sessions (key, value, updated_at) VALUES ($1, $2, NOW())
                         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
                        fullKey,
                        str
                      );
                    } else {
                      await prisma.$executeRawUnsafe(
                        `DELETE FROM whatsapp_sessions WHERE key = $1`,
                        fullKey
                      );
                    }
                  } catch (e) {
                    // ignore key save errors
                  }
                }
              }
            },
          },
        },
        saveCreds: async () => {
          try {
            const str = JSON.stringify(creds, BufferJSON.replacer);
            await prisma.$executeRawUnsafe(
              `INSERT INTO whatsapp_sessions (key, value, updated_at) VALUES ($1, $2, NOW())
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
              'creds',
              str
            );
          } catch (err) {
            console.error('[WhatsApp] Error saving creds to Supabase:', err);
          }
        },
        clearCreds: async () => {
          try {
            await prisma.$executeRawUnsafe(`DELETE FROM whatsapp_sessions;`);
          } catch (err) {
            console.error('[WhatsApp] Error clearing Supabase session table:', err);
          }
        },
      };
    } catch (err) {
      console.warn('[WhatsApp] Supabase database session not available, falling back to local files:', err);
      this.activeStorage = 'LOCAL';
      const fileAuth = await useMultiFileAuthState(this.authDir);
      return {
        state: fileAuth.state,
        saveCreds: fileAuth.saveCreds,
        clearCreds: async () => {
          try {
            fs.rmSync(this.authDir, { recursive: true, force: true });
            fs.mkdirSync(this.authDir, { recursive: true });
          } catch (e) {
            console.error('[WhatsApp] Error resetting local auth folder:', e);
          }
        },
      };
    }
  }

  public async initialize(): Promise<void> {
    if (this.isInitializing) return;
    this.isInitializing = true;
    this.status = 'CONNECTING';

    try {
      const auth = await this.getAuthState();
      const { version } = await fetchLatestBaileysVersion();

      console.log(`[WhatsApp] Initializing Baileys WhatsApp Gateway (v${version.join('.')}) [Storage: ${this.activeStorage}]...`);

      this.sock = makeWASocket({
        version,
        auth: auth.state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Enactus VIPS IMS', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
      });

      this.sock.ev.on('creds.update', auth.saveCreds);

      this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.currentQr = qr;
          this.status = 'SCAN_QR';
          this.isConnected = false;

          try {
            this.currentQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
          } catch (err) {
            console.error('[WhatsApp] Error generating QR Data URL:', err);
          }

          console.log('\n======================================================');
          console.log('📲 ENACTUS VIPS WHATSAPP GATEWAY: SCAN TO LINK DEVICE');
          console.log('Open WhatsApp > Linked Devices > Link a Device');
          console.log('======================================================\n');
          qrcodeTerminal.generate(qr, { small: true });
          console.log('======================================================\n');
        }

        if (connection === 'close') {
          this.isConnected = false;
          this.connectedNumber = null;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[WhatsApp] Connection closed (code: ${statusCode}). Reconnect: ${shouldReconnect}`);
          this.lastError = lastDisconnect?.error ? String(lastDisconnect.error) : 'Connection closed';

          if (statusCode === DisconnectReason.loggedOut) {
            this.status = 'DISCONNECTED';
            this.currentQr = null;
            this.currentQrDataUrl = null;
            console.log('[WhatsApp] Device was unlinked/logged out. Clearing stored session...');
            await auth.clearCreds();
            this.isInitializing = false;
            setTimeout(() => this.initialize(), 3000);
          } else if (shouldReconnect) {
            this.status = 'CONNECTING';
            this.isInitializing = false;
            setTimeout(() => this.initialize(), 5000);
          } else {
            this.status = 'DISCONNECTED';
            this.isInitializing = false;
          }
        } else if (connection === 'open') {
          this.isConnected = true;
          this.status = 'CONNECTED';
          this.currentQr = null;
          this.currentQrDataUrl = null;
          this.lastError = null;

          const rawId = this.sock?.user?.id || '';
          this.connectedNumber = rawId.split(':')[0] || rawId.split('@')[0] || 'Connected';
          console.log(`✅ [WhatsApp] Enactus VIPS WhatsApp connected successfully! Number: +${this.connectedNumber}`);
          this.isInitializing = false;
        }
      });
    } catch (error: any) {
      console.error('[WhatsApp] Initialization failed:', error);
      this.status = 'DISCONNECTED';
      this.lastError = error?.message || 'Initialization failed';
      this.isInitializing = false;
    }
  }

  public getStatus(): WhatsAppStatus {
    return {
      isConnected: this.isConnected,
      status: this.status,
      connectedNumber: this.connectedNumber,
      qrDataUrl: this.currentQrDataUrl,
      lastError: this.lastError,
      storage: this.activeStorage,
    };
  }

  public formatPhoneToJid(phone: string): string | null {
    if (!phone) return null;
    let cleaned = phone.trim().replace(/\D/g, '');

    if (cleaned.length === 10) {
      cleaned = '91' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
      cleaned = '91' + cleaned.slice(1);
    } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
      // standard 91XXXXXXXXXX
    }

    if (cleaned.length < 10 || cleaned.length > 15) {
      return null;
    }

    return `${cleaned}@s.whatsapp.net`;
  }

  public formatReceiptText(payload: SaleReceiptPayload): string {
    const saleDate = payload.saleTime ? new Date(payload.saleTime) : new Date();
    const formattedDate = saleDate.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    let paymentMethodDisplay = payload.paymentMethod;
    if (payload.paymentMethod === 'CASH_UPI') {
      paymentMethodDisplay = `Cash + UPI (Cash: ₹${(payload.cashAmount ?? 0).toFixed(2)} | UPI: ₹${(payload.upiAmount ?? 0).toFixed(2)})`;
    }

    const itemsFormatted = payload.items
      .map((item) => `▸ *${item.productName}*\n   ${item.quantity} unit(s) × ₹${item.unitPrice.toFixed(2)}  ➔  *₹${item.lineTotal.toFixed(2)}*`)
      .join('\n\n');

    return [
      `═════════════════════════`,
      `       *ENACTUS VIPS-TC*`,
      ` _Vivekananda Institute of Professional Studies_`,
      `   *OFFICIAL SALES INVOICE & RECEIPT*`,
      `═════════════════════════`,
      `🧾 *Invoice Ref:* #${payload.receiptNumber}`,
      `📅 *Issued On:* ${formattedDate}`,
      `🎪 *Initiative / Stall:* ${payload.eventName || 'Enactus Campus Enterprise'}`,
      `👤 *Billed To:* ${payload.customerName || 'Valued Supporter'}`,
      `─────────────────────────`,
      `📦 *PURCHASE DETAILS*`,
      `─────────────────────────`,
      itemsFormatted || '▸ *Products*',
      `─────────────────────────`,
      `💰 *Total Amount Paid:* *₹${payload.totalAmount.toFixed(2)}* (Net)`,
      `💳 *Payment Mode:* ${paymentMethodDisplay}`,
      payload.sellerName ? `👨‍💼 *Desk Associate:* ${payload.sellerName} (Enactus VIPS-TC)` : `👨‍💼 *Desk Associate:* Operations Team (Enactus VIPS-TC)`,
      `─────────────────────────`,
      `🌱 *YOUR SOCIAL IMPACT*`,
      `Every rupee from your purchase directly powers community empowerment initiatives under *Project Tahsin* and *Project Upcycle*, fostering self-reliance and environmental sustainability.`,
      `─────────────────────────`,
      `📸 *Instagram:* instagram.com/enactusvips`,
      `🌐 *Portal:* enactusvips.org`,
      `═════════════════════════`,
      `_This is a verified computer-generated digital receipt._`,
    ].join('\n');
  }

  public async sendSaleReceipt(
    payload: SaleReceiptPayload
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const jid = this.formatPhoneToJid(payload.phone);
    if (!jid) {
      console.warn(`[WhatsApp] Invalid phone number provided: ${payload.phone}`);
      return { success: false, error: 'Invalid phone number format' };
    }

    if (!this.isConnected || !this.sock) {
      console.warn(`[WhatsApp] Cannot send bill to ${jid}: Gateway not connected. Status: ${this.status}`);
      return { success: false, error: 'WhatsApp Gateway not connected' };
    }

    try {
      const messageText = this.formatReceiptText(payload);
      const result = await this.sock.sendMessage(jid, { text: messageText });

      console.log(`✅ [WhatsApp] Receipt #${payload.receiptNumber} sent to ${jid} (Msg ID: ${result?.key?.id})`);
      return { success: true, messageId: result?.key?.id ?? undefined };
    } catch (error: any) {
      console.error(`❌ [WhatsApp] Failed to send receipt to ${jid}:`, error);
      return { success: false, error: error?.message || 'Failed to send message' };
    }
  }

  public async logout(): Promise<void> {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (e) {
      // ignore
    }

    this.isConnected = false;
    this.status = 'DISCONNECTED';
    this.connectedNumber = null;
    this.currentQr = null;
    this.currentQrDataUrl = null;

    try {
      await prisma.$executeRawUnsafe(`DELETE FROM whatsapp_sessions;`);
    } catch (e) {
      // ignore
    }

    try {
      fs.rmSync(this.authDir, { recursive: true, force: true });
      fs.mkdirSync(this.authDir, { recursive: true });
    } catch (e) {
      // ignore
    }

    setTimeout(() => this.initialize(), 1000);
  }
}

export const whatsappService = new WhatsAppService();
