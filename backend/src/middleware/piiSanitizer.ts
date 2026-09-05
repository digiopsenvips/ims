import { AuthUserPayload } from '../types';
import { Role } from '@prisma/client';

export const sanitizeSaleForUser = (sale: any, user?: AuthUserPayload) => {
  const isHead = user?.role === Role.HEAD;
  const canViewPII = !isHead || !!user?.permissions?.['view_customer_pii'];
  const canViewRevenue = !isHead || !!user?.permissions?.['view_revenue'];

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
  }

  return sanitized;
};

export const sanitizeSalesListForUser = (sales: any[], user?: AuthUserPayload) => {
  return sales.map(s => sanitizeSaleForUser(s, user));
};
