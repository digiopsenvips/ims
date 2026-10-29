import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, AuthUserPayload } from '../types';

export function allowed(user: AuthUserPayload | undefined, permission: string): boolean {
  return Boolean(user && (user.role === 'DEVELOPER' || user.role === 'ADMIN' ||
    (user.role === 'HEAD' && user.permissions?.[permission] === true)));
}

const financial = new Set(['totalRevenue', 'totalAmount', 'totalOrderAmount', 'totalGameRevenue', 'totalComboRevenue',
  'revenue', 'revenueGenerated', 'cashAmount', 'upiAmount', 'lineTotal', 'amountPaid',
  'productRevenue', 'gameRevenue', 'totalSalesRevenue', 'estimatedRewardValue']);

export function projectResponse(value: any, options: { revenue: boolean; pii: boolean; inventory: boolean; activity: boolean }): any {
  if (Array.isArray(value)) return value.map(item => projectResponse(item, options));
  if (!value || typeof value !== 'object') return value;
  const result: any = {};
  for (const [key, child] of Object.entries(value)) {
    if (['passwordHash', 'password_hash', 'access_token', 'refresh_token'].includes(key)) continue;
    if (!options.inventory && ['inventory', 'warehouseStock', 'quantityOnHand'].includes(key)) { result[key] = null; continue; }
    if (!options.activity && ['sales', 'recentSales', 'sessions', 'recentSessions', 'stallPerformance', 'eventBreakdown'].includes(key)) { result[key] = []; continue; }
    if (!options.revenue && (financial.has(key) || (key === 'entryFee' && ('receiptNumber' in value || 'sessionCode' in value)))) { result[key] = null; continue; }
    if (!options.pii && ['customerName', 'customerPhone'].includes(key)) { result[key] = null; continue; }
    result[key] = projectResponse(child, options);
  }
  return result;
}

/** Project after auth/handler completion; serialize as Express would, including Decimal and Date. */
export function responsePolicy(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const send = res.json.bind(res);
  res.json = (body: any) => {
    const ownOperation = req.method !== 'GET' || req.baseUrl.endsWith('/sales') ||
      (req.baseUrl.endsWith('/games') && req.path === '/sessions');
    const memberOwn = req.user?.role === 'MEMBER' && ownOperation;
    return send(projectResponse(JSON.parse(JSON.stringify(body)), {
      revenue: allowed(req.user, 'view_revenue') || memberOwn,
      pii: allowed(req.user, 'view_customer_pii') || memberOwn,
      inventory: allowed(req.user, 'view_inventory'),
      activity: allowed(req.user, 'view_event_breakdown') || memberOwn,
    }));
  };
  next();
}
