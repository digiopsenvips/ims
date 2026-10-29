import { Router, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';
import { whatsappService } from '../services/whatsappService';
import { prisma } from '../config/prisma';

const router = Router();

// GET /api/whatsapp/status - Check connection status and QR code
router.get(
  '/status',
  authenticateToken,
  requireRoles(Role.DEVELOPER, Role.ADMIN),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const status = whatsappService.getStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to get WhatsApp status' });
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
        customerName: '',
        receiptNumber: 'BILL-260910-2588',
        eventName: 'VIPS Recruitment Stall',
        eventLocation: '',
        items: [
          {
            productName: 'Seeded Pen',
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
        res.json({ message: 'Test message sent successfully!', messageId: result.messageId });
      } else {
        res.status(400).json({ error: result.error || 'Failed to send test message' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to send test message' });
    }
  }
);

// Dispatch only an authorized stored receipt to its recorded recipient.
router.post('/send-receipt', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const receiptNumber = Number(req.body.receiptNumber);
  if (!Number.isSafeInteger(receiptNumber) || receiptNumber < 1) {
    res.status(400).json({ error: 'A stored receipt number is required.' }); return;
  }
  try {
    const sale = await prisma.sale.findUnique({ where: { receiptNumber }, include: {
      event: true, items: { include: { product: true } },
    } });
    const elevated = req.user?.role === Role.DEVELOPER || req.user?.role === Role.ADMIN;
    if (!sale || (!elevated && (sale.sellerUserIdAtSale || sale.memberId) !== req.user?.id)) {
      res.status(403).json({ error: 'Receipt access denied.' }); return;
    }
    if (!sale.customerPhone || (req.body.phone && req.body.phone !== sale.customerPhone)) {
      res.status(400).json({ error: 'Receipt can only be sent to its recorded recipient.' }); return;
    }
    const result = await whatsappService.sendSaleReceipt({
      phone: sale.customerPhone, customerName: sale.customerName || undefined, receiptNumber,
      eventName: sale.event.name, eventLocation: sale.event.location,
      items: sale.items.map(item => ({ productName: item.product.name, quantity: item.quantity,
        unitPrice: Number(item.unitPrice), lineTotal: Number(item.lineTotal) })),
      totalAmount: Number(sale.totalAmount), paymentMethod: sale.paymentMethod,
      cashAmount: sale.cashAmount === null ? null : Number(sale.cashAmount),
      upiAmount: sale.upiAmount === null ? null : Number(sale.upiAmount),
      sellerName: sale.sellerNameAtSale || undefined, saleTime: sale.saleTime,
    });
    res.json(result);
  } catch { res.status(500).json({ error: 'Receipt dispatch failed.' }); }
});
export default router;
