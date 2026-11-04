import { Prisma } from '@prisma/client';

export interface RevenueBreakdown {
  totalRevenue: number;
  productRevenue: number;
  gameRevenue: number;
  cashRevenue: number;
  upiRevenue: number;
  totalTransactions: number;
  productSalesCount: number;
  gameSalesCount: number;
}

export interface RevenueSaleInput {
  id?: number | string;
  totalAmount: Prisma.Decimal | number | string;
  status?: string | null;
  transactionType?: string | null;
  cashAmount?: Prisma.Decimal | number | string | null;
  upiAmount?: Prisma.Decimal | number | string | null;
}

export interface RevenueGameSessionInput {
  id?: string;
  entryFee: Prisma.Decimal | number | string;
  status?: string | null;
}

/**
 * Authoritative single revenue calculation method for events, stalls, and analytics.
 *
 * Rules:
 * 1. Cancelled/voided transactions (status === 'CANCELLED') are excluded from revenue.
 * 2. Sales with transactionType === 'GAME' represent collected game entry fees.
 * 3. Sales with transactionType !== 'GAME' (e.g. 'SALE', 'COMBO') represent product and combo sales.
 * 4. Total Revenue = productRevenue + gameRevenue.
 * 5. Game entry fees must never be counted twice:
 *    When a game is recorded, a Sale record (transactionType: 'GAME') and a GameSession record are created.
 *    Adding both would double-count the fee. Game session fees are only used as fallback if game sales are absent.
 * 6. Decimal/currency arithmetic is computed in cents (x100 integer) to eliminate IEEE-754 floating-point inaccuracies.
 */
export function calculateEventRevenue(
  sales: RevenueSaleInput[],
  gameSessions?: RevenueGameSessionInput[]
): RevenueBreakdown {
  let productRevenueCents = 0;
  let gameRevenueCents = 0;
  let cashRevenueCents = 0;
  let upiRevenueCents = 0;
  let totalTransactions = 0;
  let productSalesCount = 0;
  let gameSalesCount = 0;

  for (const s of sales) {
    if (s.status === 'CANCELLED') continue;

    const totalAmt = Number(s.totalAmount) || 0;
    const totalCents = Math.round(totalAmt * 100);

    const cashAmt = Number(s.cashAmount) || 0;
    const upiAmt = Number(s.upiAmount) || 0;
    cashRevenueCents += Math.round(cashAmt * 100);
    upiRevenueCents += Math.round(upiAmt * 100);

    totalTransactions++;

    if (s.transactionType === 'GAME') {
      gameRevenueCents += totalCents;
      gameSalesCount++;
    } else {
      productRevenueCents += totalCents;
      productSalesCount++;
    }
  }

  // Fallback: If no game sales exist in the sales table but completed gameSessions exist
  // (e.g. legacy/unlinked sessions), use gameSessions to account for game revenue without double-counting.
  if (gameRevenueCents === 0 && gameSessions && gameSessions.length > 0) {
    for (const gs of gameSessions) {
      if (gs.status === 'CANCELLED') continue;
      const feeCents = Math.round((Number(gs.entryFee) || 0) * 100);
      gameRevenueCents += feeCents;
      gameSalesCount++;
    }
  }

  const totalRevenueCents = productRevenueCents + gameRevenueCents;

  return {
    totalRevenue: totalRevenueCents / 100,
    productRevenue: productRevenueCents / 100,
    gameRevenue: gameRevenueCents / 100,
    cashRevenue: cashRevenueCents / 100,
    upiRevenue: upiRevenueCents / 100,
    totalTransactions,
    productSalesCount,
    gameSalesCount,
  };
}
