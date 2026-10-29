import { AuthUserPayload } from '../types';
import { Role } from '@prisma/client';

export const sanitizeSaleForUser = (sale: any, user?: AuthUserPayload) => {
  const isHead = user?.role === Role.HEAD;
  const ownSale = user?.role === Role.MEMBER && (sale.memberId === user.id || sale.sellerUserIdAtSale === user.id);
  const elevated = user?.role === Role.ADMIN || user?.role === Role.DEVELOPER;
  const canViewPII = elevated || ownSale || (isHead && !!user?.permissions?.['view_customer_pii']);
  const canViewRevenue = elevated || ownSale || (isHead && !!user?.permissions?.['view_revenue']);

  const sanitized = { ...sale };

  if (!canViewPII) {
    if (sanitized.customerName) sanitized.customerName = 'Confidential';
    if (sanitized.customerPhone) sanitized.customerPhone = 'XXXXXXXXXX';
  }

  if (!canViewRevenue) {
    delete sanitized.unitPrice;
    delete sanitized.totalAmount;
    sanitized.unitPrice = null;
    sanitized.totalAmount = null;
    sanitized.cashAmount = null;
    sanitized.upiAmount = null;
    sanitized.totalOrderAmount = null;
    if (Array.isArray(sanitized.items)) {
      sanitized.items = sanitized.items.map((i: any) => ({
        ...i,
        unitPrice: null,
        lineTotal: null,
      }));
    }
  }

  return sanitized;
};

export const sanitizeSalesListForUser = (sales: any[], user?: AuthUserPayload) => {
  return sales.map(s => sanitizeSaleForUser(s, user));
};
