import { Prisma } from '@prisma/client';
import { StockConflict } from './stock';
import { moneyCents, paymentMethod } from './payment';

export async function existingSaleAcknowledgement(
  db: Pick<Prisma.TransactionClient, 'sale'>, body: any, sellerId: string,
) {
  const sale = await db.sale.findUnique({
    where: { clientTxId: body.clientTxId },
    select: {
      id: true, receiptNumber: true, clientTxId: true, eventId: true,
      memberId: true, sellerUserIdAtSale: true, comboId: true, gameId: true,
      customerName: true, customerPhone: true, saleTime: true, paymentMethod: true, cashAmount: true, upiAmount: true, totalAmount: true,
      items: { select: { productId: true, quantity: true } },
      gameSession: { select: {
        sessionCode: true, result: true, rewardQuantity: true, entryFee: true,
        createdAt: true, sellerName: true, rewardProduct: { select: { name: true } },
      } },
      event: { select: { name: true } }, game: { select: { name: true } },
    },
  });
  if (!sale) return null;
  const owner = sale.sellerUserIdAtSale || sale.memberId;
  if (owner !== sellerId || sale.eventId !== body.eventId || (sale.comboId || null) !== (body.comboId || null) ||
      (sale.gameId || null) !== (body.gameId || null) || sale.paymentMethod !== paymentMethod(body.paymentMethod)) {
    throw new StockConflict('Operation key belongs to a different seller, event or transaction. Preserve the original payload.');
  }
  if ((body.customerName !== undefined && String(body.customerName || '').trim() !== (sale.customerName || '')) ||
      (body.customerPhone !== undefined && String(body.customerPhone || '').trim() !== (sale.customerPhone || ''))) {
    throw new StockConflict('Operation key was reused with different customer details.');
  }
  if (body.totalAmount !== undefined && moneyCents(body.totalAmount) !== moneyCents(sale.totalAmount.toString())) {
    throw new StockConflict('Operation key was reused with a different total.');
  }
  if (sale.paymentMethod === 'CASH_UPI' &&
      (moneyCents(body.cashAmount) !== moneyCents(sale.cashAmount?.toString()) ||
       moneyCents(body.upiAmount) !== moneyCents(sale.upiAmount?.toString()))) {
    throw new StockConflict('Operation key was reused with different payment details.');
  }
  if (sale.gameSession && sale.gameSession.result !== String(body.result).toUpperCase()) {
    throw new StockConflict('Operation key was reused with a different game result.');
  }
  if (!sale.gameId) {
    const requested = new Map<string, number>();
    for (const item of body.items || (body.productId ? [{ productId: body.productId, quantity: body.quantity }] : [])) {
      requested.set(item.productId, (requested.get(item.productId) || 0) + Number(item.quantity));
    }
    const stored = new Map<string, number>();
    for (const item of sale.items) stored.set(item.productId, (stored.get(item.productId) || 0) + item.quantity);
    if (requested.size && (requested.size !== stored.size || [...requested].some(([id, qty]) => stored.get(id) !== qty))) {
      throw new StockConflict('Operation key was reused with different line items.');
    }
  }
  // Explicit response projection; never return user hashes or other users' records.
  return {
    id: sale.id, receiptNumber: sale.receiptNumber, clientTxId: sale.clientTxId,
    eventId: sale.eventId, totalAmount: Number(sale.totalAmount), paymentMethod: sale.paymentMethod,
    receipt: sale.gameSession ? {
      receiptNumber: sale.receiptNumber, receiptId: `#${sale.receiptNumber}`,
      sessionCode: sale.gameSession.sessionCode, gameName: sale.game?.name,
      result: sale.gameSession.result, rewardQuantity: sale.gameSession.rewardQuantity,
      rewardProductName: sale.gameSession.rewardProduct.name,
      rewardDescription: `${sale.gameSession.rewardProduct.name} × ${sale.gameSession.rewardQuantity}`,
      amountPaid: Number(sale.gameSession.entryFee), paymentMethod: sale.paymentMethod,
      cashAmount: Number(sale.cashAmount || 0), upiAmount: Number(sale.upiAmount || 0),
      eventName: sale.event.name, sellerName: sale.gameSession.sellerName,
      timestamp: sale.gameSession.createdAt,
    } : undefined,
  };
}
