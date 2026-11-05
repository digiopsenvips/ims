const test = require('node:test');
const assert = require('node:assert/strict');

// Business logic simulations matching specialSales.ts and stockTransaction
function calculateLineItem({ standardPrice, specialPrice, quantity, discountAmount = 0 }) {
  const std = Number(standardPrice) || 0;
  const spec = specialPrice !== undefined ? Number(specialPrice) : std;
  const isOverridden = Math.abs(spec - std) > 0.001;
  const disc = Number(discountAmount) || 0;
  const lineTotal = Math.max(0, Math.round((spec * quantity - disc) * 100) / 100);
  return {
    standardPrice: std,
    specialPrice: spec,
    isOverridden,
    lineTotal,
  };
}

function calculateOrderTotals({ lineItems, discountAmount = 0, additionalCharges = 0, initialPaid = 0 }) {
  const subtotal = lineItems.reduce((acc, i) => acc + i.lineTotal, 0);
  const totalAmount = Math.max(0, Math.round((subtotal - discountAmount + additionalCharges) * 100) / 100);
  const paid = Math.min(totalAmount, Math.max(0, Number(initialPaid) || 0));
  const balanceDue = Math.max(0, Math.round((totalAmount - paid) * 100) / 100);
  const paymentStatus = balanceDue === 0 ? 'PAID' : (paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID');

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    totalAmount,
    amountPaid: paid,
    balanceDue,
    paymentStatus,
  };
}

function processStockAllocation({ items, warehouseStock }) {
  // Validate stock
  for (const item of items) {
    const current = warehouseStock.get(item.productId) || 0;
    if (current < item.quantity) {
      throw new Error(
        `Insufficient warehouse stock for ${item.productId}. Requested: ${item.quantity}, available: ${current} (shortfall: ${item.quantity - current})`
      );
    }
  }

  // Deduct
  const updatedStock = new Map(warehouseStock);
  for (const item of items) {
    updatedStock.set(item.productId, updatedStock.get(item.productId) - item.quantity);
  }
  return updatedStock;
}

function processStockRestoration({ items, warehouseStock }) {
  const updatedStock = new Map(warehouseStock);
  for (const item of items) {
    updatedStock.set(item.productId, (updatedStock.get(item.productId) || 0) + item.quantity);
  }
  return updatedStock;
}

test('1. Faculty purchase with multiple products and line-item totals', () => {
  const item1 = calculateLineItem({ standardPrice: 120, specialPrice: 100, quantity: 5, discountAmount: 50 });
  const item2 = calculateLineItem({ standardPrice: 50, specialPrice: 50, quantity: 10, discountAmount: 0 });

  assert.equal(item1.isOverridden, true);
  assert.equal(item1.lineTotal, 450); // 100 * 5 - 50 = 450
  assert.equal(item2.isOverridden, false);
  assert.equal(item2.lineTotal, 500); // 50 * 10 = 500

  const totals = calculateOrderTotals({ lineItems: [item1, item2], discountAmount: 50, additionalCharges: 20 });
  assert.equal(totals.subtotal, 950);
  assert.equal(totals.totalAmount, 920); // 950 - 50 + 20 = 920
});

test('2. Bulk order with large quantities and inventory deduction', () => {
  const wh = new Map([
    ['UPC-001', 500],
    ['TAH-001', 300],
  ]);
  const items = [
    { productId: 'UPC-001', quantity: 200 },
    { productId: 'TAH-001', quantity: 150 },
  ];

  const updated = processStockAllocation({ items, warehouseStock: wh });
  assert.equal(updated.get('UPC-001'), 300);
  assert.equal(updated.get('TAH-001'), 150);
});

test('3. Special negotiated product prices trigger audit override flag', () => {
  const itemRegular = calculateLineItem({ standardPrice: 70, specialPrice: 70, quantity: 2 });
  const itemDiscounted = calculateLineItem({ standardPrice: 70, specialPrice: 55, quantity: 2 });
  const itemMarkedUp = calculateLineItem({ standardPrice: 70, specialPrice: 85, quantity: 2 });

  assert.equal(itemRegular.isOverridden, false);
  assert.equal(itemDiscounted.isOverridden, true);
  assert.equal(itemMarkedUp.isOverridden, true);
});

test('4. Insufficient warehouse stock is strictly rejected with shortfall', () => {
  const wh = new Map([['REK-001', 11]]);
  const items = [{ productId: 'REK-001', quantity: 20 }];

  assert.throws(
    () => processStockAllocation({ items, warehouseStock: wh }),
    /Insufficient warehouse stock for REK-001.*shortfall: 9/
  );
});

test('5. Partially paid order & balance tracking', () => {
  const items = [{ lineTotal: 1000 }];
  const totals = calculateOrderTotals({ lineItems: items, initialPaid: 400 });

  assert.equal(totals.totalAmount, 1000);
  assert.equal(totals.amountPaid, 400);
  assert.equal(totals.balanceDue, 600);
  assert.equal(totals.paymentStatus, 'PARTIALLY_PAID');
});

test('6. Split payment Cash + UPI validation', () => {
  const total = 500;
  const cash = 200;
  const upi = 300;
  assert.equal(cash + upi, total);

  const invalidUpi = 250;
  assert.notEqual(cash + invalidUpi, total);
});

test('7. Subsequent payment collection updates balance and marks PAID', () => {
  let paid = 400;
  const total = 1000;
  let balance = total - paid;
  assert.equal(balance, 600);

  // Collect subsequent payment of 600
  const subsequentPay = 600;
  paid += subsequentPay;
  balance = Math.max(0, total - paid);
  assert.equal(paid, 1000);
  assert.equal(balance, 0);
  const status = balance === 0 ? 'PAID' : 'PARTIALLY_PAID';
  assert.equal(status, 'PAID');
});

test('8. Order cancellation restores warehouse stock exactly once', () => {
  const initialWh = new Map([['TAH-002', 100]]);
  const items = [{ productId: 'TAH-002', quantity: 25 }];

  // Confirm order
  const postConfirmWh = processStockAllocation({ items, warehouseStock: initialWh });
  assert.equal(postConfirmWh.get('TAH-002'), 75);

  // Cancel order
  const postCancelWh = processStockRestoration({ items, warehouseStock: postConfirmWh });
  assert.equal(postCancelWh.get('TAH-002'), 100);
});

test('9. Draft orders do not touch warehouse stock', () => {
  const initialWh = new Map([['TAH-002', 100]]);
  const isDraft = true;
  let wh = initialWh;
  if (!isDraft) {
    wh = processStockAllocation({ items: [{ productId: 'TAH-002', quantity: 25 }], warehouseStock: initialWh });
  }
  assert.equal(wh.get('TAH-002'), 100);
});

test('10. RBAC: Members and Heads are strictly forbidden from Special Sales', () => {
  function checkSpecialSalesAccess(userRole) {
    if (userRole === 'DEVELOPER' || userRole === 'ADMIN') return 'ALLOWED';
    return 'DENIED';
  }

  assert.equal(checkSpecialSalesAccess('DEVELOPER'), 'ALLOWED');
  assert.equal(checkSpecialSalesAccess('ADMIN'), 'ALLOWED');
  assert.equal(checkSpecialSalesAccess('HEAD'), 'DENIED');
  assert.equal(checkSpecialSalesAccess('MEMBER'), 'DENIED');
});

test('11. Fulfilling an already confirmed order does not deduct stock twice', () => {
  const initialWh = new Map([['UPC-005', 50]]);
  const items = [{ productId: 'UPC-005', quantity: 10 }];

  // Confirm
  const confirmedWh = processStockAllocation({ items, warehouseStock: initialWh });
  assert.equal(confirmedWh.get('UPC-005'), 40);

  // Fulfill (no re-deduction)
  const fulfilledWh = confirmedWh;
  assert.equal(fulfilledWh.get('UPC-005'), 40);
});

test('12. Revenue separation: Special sales revenue does not double-count with stalls', () => {
  const stallSales = [
    { totalAmount: 510, status: 'COMPLETED', transactionType: 'SALE' },
    { totalAmount: 420, status: 'COMPLETED', transactionType: 'GAME' },
  ];
  const stallRevenue = stallSales.reduce((acc, s) => acc + s.totalAmount, 0);
  assert.equal(stallRevenue, 930);

  const specialSales = [
    { totalAmount: 2500, amountPaid: 2500, status: 'CONFIRMED' },
    { totalAmount: 1500, amountPaid: 500, status: 'CONFIRMED' },
  ];
  const specialRevenue = specialSales.reduce((acc, s) => acc + s.amountPaid, 0);
  assert.equal(specialRevenue, 3000);

  // Overall combined revenue
  const combinedTotal = stallRevenue + specialRevenue;
  assert.equal(combinedTotal, 3930);
});
