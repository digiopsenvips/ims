import { Router, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireRoles } from '../middleware/rbac';
import { AuthenticatedRequest } from '../types';
import { Role } from '@prisma/client';
import { whatsappService } from '../services/whatsappService';

const router = Router();

// GET /api/whatsapp/status - Check connection status and QR code
router.get(
  '/status',
  authenticateToken,
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

// POST /api/whatsapp/send-receipt - Generic receipt dispatch endpoint
router.post(
  '/send-receipt',
  async (req, res): Promise<void> => {
    const { phone, customerName, receiptNumber, eventName, eventLocation, items, totalAmount, paymentMethod, cashAmount, upiAmount, sellerName, saleTime } = req.body;
    if (!phone) {
      res.status(400).json({ error: 'phone number is required' });
      return;
    }

    try {
      const result = await whatsappService.sendSaleReceipt({
        phone: String(phone),
        customerName,
        receiptNumber: receiptNumber || 'RECEIPT',
        eventName,
        eventLocation,
        items: Array.isArray(items) ? items : [],
        totalAmount: Number(totalAmount || 0),
        paymentMethod: paymentMethod || 'UPI',
        cashAmount,
        upiAmount,
        sellerName,
        saleTime,
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to send receipt' });
    }
  }
);

export default router;
