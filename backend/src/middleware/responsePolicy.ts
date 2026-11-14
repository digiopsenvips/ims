import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { hasPermission } from './rbac';

const FINANCIAL_FIELDS = new Set([
  'totalRevenue', 'totalAmount', 'totalOrderAmount', 'totalGameRevenue', 'totalComboRevenue',
  'revenue', 'revenueGenerated', 'cashAmount', 'upiAmount', 'lineTotal', 'amountPaid',
  'productRevenue', 'gameRevenue', 'totalSalesRevenue', 'estimatedRewardValue',
  'balanceDue', 'subtotal', 'discountAmount', 'additionalCharges',
  'profitMargin', 'grossProfit', 'inventoryValuation'
]);

const COST_PRICE_FIELDS = new Set([
  'costPrice', 'cost_price', 'unitCost', 'productionCost', 'manufacturingCost', 'profitMargin'
]);

export function projectResponse(
  value: any,
  options: {
    revenue: boolean;
    pii: boolean;
    inventory: boolean;
    activity: boolean;
    costPrice: boolean;
  }
): any {
  if (Array.isArray(value)) return value.map(item => projectResponse(item, options));
  if (!value || typeof value !== 'object') return value;

  const result: any = {};
  for (const [key, child] of Object.entries(value)) {
    if (['passwordHash', 'password_hash', 'access_token', 'refresh_token'].includes(key)) continue;

    // Mask warehouse/stock counts if not authorized
    if (!options.inventory && ['inventory', 'warehouseStock', 'quantityOnHand'].includes(key)) {
      result[key] = null;
      continue;
    }

    // Mask activity breakdowns if not authorized
    if (!options.activity && ['sales', 'recentSales', 'sessions', 'recentSessions', 'stallPerformance', 'eventBreakdown'].includes(key)) {
      result[key] = [];
      continue;
    }

    // Mask financial amounts if not authorized
    if (!options.revenue && (FINANCIAL_FIELDS.has(key) || (key === 'entryFee' && ('receiptNumber' in value || 'sessionCode' in value)))) {
      result[key] = null;
      continue;
    }

    // Mask cost prices & profit margins if not authorized
    if (!options.costPrice && COST_PRICE_FIELDS.has(key)) {
      result[key] = null;
      continue;
    }

    // Mask customer PII if not authorized
    if (!options.pii && ['customerName', 'customerPhone', 'phone'].includes(key)) {
      result[key] = null;
      continue;
    }

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
      revenue: hasPermission(req.user, 'dashboard.view_revenue') ||
               hasPermission(req.user, 'sales.view_revenue') ||
               hasPermission(req.user, 'events.view_revenue') ||
               hasPermission(req.user, 'special_sales.view_financials') ||
               memberOwn,
      pii: hasPermission(req.user, 'sales.view_customer_pii') ||
           hasPermission(req.user, 'whatsapp.view_customer_pii') ||
           memberOwn,
      inventory: hasPermission(req.user, 'inventory.view_warehouse') ||
                 hasPermission(req.user, 'inventory.view_stall') ||
                 hasPermission(req.user, 'inventory.view_all'),
      activity: hasPermission(req.user, 'dashboard.view_operational') ||
                hasPermission(req.user, 'events.view_sales_quantities') ||
                memberOwn,
      costPrice: hasPermission(req.user, 'products.view_cost_price'),
    }));
  };
  next();
}
