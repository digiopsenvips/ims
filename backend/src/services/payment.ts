import { PaymentMethod } from '@prisma/client';

export class InputError extends Error { readonly status = 400; }
export class OwnerConflict extends Error { readonly status = 409; }

export function positiveInteger(value: unknown, label: string): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^[1-9]\d*$/.test(String(value))) {
    throw new InputError(`${label} must be a positive whole number.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new InputError(`${label} is too large.`);
  return parsed;
}

export function nonnegativeInteger(value: unknown, label: string): number {
  if (value === 0 || value === '0') return 0;
  return positiveInteger(value, label);
}

export function moneyCents(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new InputError('Amounts must be non-negative numbers with at most two decimal places.');
  }
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || cents > 9999999999) throw new InputError('Amount is out of range.');
  return cents;
}

export function paymentMethod(value: unknown): PaymentMethod {
  const method = String(value || '').toUpperCase().replace(/[\s+]+/g, '_');
  if (method === 'CASH' || method === 'UPI') return method;
  if (['CASH_UPI', 'CASH_AND_UPI', 'SPLIT'].includes(method)) return PaymentMethod.CASH_UPI;
  throw new InputError('Payment method must be CASH, UPI, or CASH + UPI.');
}

export function paymentAmounts(method: PaymentMethod, cash: unknown, upi: unknown, total: number) {
  const totalCents = moneyCents(total.toFixed(2));
  if (method === 'CASH') return { cash: totalCents / 100, upi: 0 };
  if (method === 'UPI') return { cash: 0, upi: totalCents / 100 };
  const cashCents = moneyCents(cash), upiCents = moneyCents(upi);
  if (cashCents + upiCents !== totalCents) throw new InputError('Cash and UPI amounts must exactly match the bill total.');
  return { cash: cashCents / 100, upi: upiCents / 100 };
}

export function validateOperation(body: any, userId: string) {
  if (!body || typeof body.clientTxId !== 'string' || !body.clientTxId.trim() || body.clientTxId.length > 128) {
    throw new InputError('A stable clientTxId is required. Preserve and reuse it when retrying.');
  }
  if (typeof body.ownerUserId !== 'string' || body.ownerUserId !== userId) {
    throw new OwnerConflict('Original seller is missing or differs from this session. Preserve this operation for reconciliation.');
  }
  if (typeof body.eventId !== 'string' || !body.eventId) throw new InputError('Event ID is required.');
  paymentMethod(body.paymentMethod);
  if (body.comboQuantity !== undefined) positiveInteger(body.comboQuantity, 'Combo quantity');
  if (body.quantity !== undefined) positiveInteger(body.quantity, 'Quantity');
  if (body.saleTime && !Number.isFinite(new Date(body.saleTime).getTime())) throw new InputError('Invalid sale timestamp.');
  if (body.items !== undefined && (!Array.isArray(body.items) || body.items.length > 200)) throw new InputError('Invalid item list.');
  if (body.selectedItems !== undefined && !Array.isArray(body.selectedItems)) throw new InputError('Invalid selected item list.');
  for (const item of [...(body.items || []), ...(body.selectedItems || [])]) {
    if (!item || typeof item.productId !== 'string' || !item.productId) throw new InputError('Product ID is required.');
    positiveInteger(item.quantity, 'Quantity');
  }
}
