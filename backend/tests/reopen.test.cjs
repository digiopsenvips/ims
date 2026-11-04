// Test suite for Reopening Ended Stalls with Reviewed Inventory Allocations
const test = require('node:test');
const assert = require('node:assert/strict');

// Pure simulation functions matching eventLifecycle.ts logic
function calculateReopeningAllocations({
  allocations, // requested reviewed allocations [{ productId, allocatedQty }]
  previousAllocations, // [{ productId, allocatedQty }]
  consumed, // Map<productId, soldQty>
  warehouseStock, // Map<productId, quantityOnHand>
}) {
  const result = {
    updatedAllocations: [],
    warehouseDeltas: new Map(),
    errors: [],
  };

  const seenIds = new Set();
  for (const a of allocations) {
    if (!a.productId) throw new Error('Product ID required');
    if (seenIds.has(a.productId)) throw new Error(`Duplicate product: ${a.productId}`);
    seenIds.add(a.productId);

    const soldQty = consumed.get(a.productId) || 0;
    const newAllocatedQty = Math.floor(Number(a.allocatedQty) || 0);

    if (newAllocatedQty < soldQty) {
      throw new Error(`Cannot allocate ${newAllocatedQty}: below historical sales (${soldQty})`);
    }

    const neededAtStall = newAllocatedQty - soldQty;
    const currentWh = warehouseStock.get(a.productId) || 0;

    if (currentWh < neededAtStall) {
      const shortfall = neededAtStall - currentWh;
      throw new Error(`Insufficient warehouse stock for ${a.productId}: needed ${neededAtStall}, available ${currentWh} (shortfall: ${shortfall})`);
    }

    result.warehouseDeltas.set(a.productId, neededAtStall > 0 ? -neededAtStall : 0);
    result.updatedAllocations.push({
      productId: a.productId,
      allocatedQty: newAllocatedQty,
    });
  }

  // Previous allocations not included in reviewed list are clamped to historical sales
  for (const prev of previousAllocations) {
    if (!seenIds.has(prev.productId)) {
      const soldQty = consumed.get(prev.productId) || 0;
      result.updatedAllocations.push({
        productId: prev.productId,
        allocatedQty: soldQty,
      });
      result.warehouseDeltas.set(prev.productId, 0);
    }
  }

  return result;
}

function calculateSubsequentClosure({
  allocations, // [{ productId, allocatedQty }]
  consumed, // Map<productId, totalSoldQty>
}) {
  const returnedToWarehouse = new Map();
  for (const alloc of allocations) {
    const totalSold = consumed.get(alloc.productId) || 0;
    const unsold = Math.max(0, alloc.allocatedQty - totalSold);
    returnedToWarehouse.set(alloc.productId, unsold);
  }
  return returnedToWarehouse;
}

test('1. Seeded Pencil 41 vs 44: Requesting 197 (156 sold + 41 available) succeeds', () => {
  const consumed = new Map([['UPC-001', 156]]);
  const warehouse = new Map([['UPC-001', 41]]);
  const prevAlloc = [{ productId: 'UPC-001', allocatedQty: 200 }];

  const outcome = calculateReopeningAllocations({
    allocations: [{ productId: 'UPC-001', allocatedQty: 197 }],
    previousAllocations: prevAlloc,
    consumed,
    warehouseStock: warehouse,
  });

  assert.equal(outcome.updatedAllocations[0].allocatedQty, 197);
  assert.equal(outcome.warehouseDeltas.get('UPC-001'), -41);
});

test('2. Seeded Pencil 41 vs 44: Requesting old 200 (needs 44, only 41 available) throws shortfall error', () => {
  const consumed = new Map([['UPC-001', 156]]);
  const warehouse = new Map([['UPC-001', 41]]);
  const prevAlloc = [{ productId: 'UPC-001', allocatedQty: 200 }];

  assert.throws(
    () => {
      calculateReopeningAllocations({
        allocations: [{ productId: 'UPC-001', allocatedQty: 200 }],
        previousAllocations: prevAlloc,
        consumed,
        warehouseStock: warehouse,
      });
    },
    /shortfall: 3/
  );
});

test('3. Allocating 0 active units (allocatedQty = soldQty) pulls 0 from warehouse', () => {
  const consumed = new Map([['UPC-001', 156]]);
  const warehouse = new Map([['UPC-001', 41]]);
  const prevAlloc = [{ productId: 'UPC-001', allocatedQty: 200 }];

  const outcome = calculateReopeningAllocations({
    allocations: [{ productId: 'UPC-001', allocatedQty: 156 }],
    previousAllocations: prevAlloc,
    consumed,
    warehouseStock: warehouse,
  });

  assert.equal(outcome.updatedAllocations[0].allocatedQty, 156);
  assert.equal(outcome.warehouseDeltas.get('UPC-001'), 0);
});

test('4. Attempting to allocate less than historical sales is strictly blocked', () => {
  const consumed = new Map([['UPC-001', 156]]);
  const warehouse = new Map([['UPC-001', 41]]);
  const prevAlloc = [{ productId: 'UPC-001', allocatedQty: 200 }];

  assert.throws(
    () => {
      calculateReopeningAllocations({
        allocations: [{ productId: 'UPC-001', allocatedQty: 100 }],
        previousAllocations: prevAlloc,
        consumed,
        warehouseStock: warehouse,
      });
    },
    /below historical sales \(156\)/
  );
});

test('5. Reopening with new product added to stall pulls from warehouse', () => {
  const consumed = new Map();
  const warehouse = new Map([['NEW-001', 50]]);
  const prevAlloc = [];

  const outcome = calculateReopeningAllocations({
    allocations: [{ productId: 'NEW-001', allocatedQty: 20 }],
    previousAllocations: prevAlloc,
    consumed,
    warehouseStock: warehouse,
  });

  assert.equal(outcome.updatedAllocations[0].allocatedQty, 20);
  assert.equal(outcome.warehouseDeltas.get('NEW-001'), -20);
});

test('6. Subsequent stall closure returns only remaining unsold active stock', () => {
  // Nexus reopened with 197. Sold 156 previously.
  // During reopened period, 10 more were sold (total 166).
  const allocations = [{ productId: 'UPC-001', allocatedQty: 197 }];
  const consumedAfterReopen = new Map([['UPC-001', 166]]);

  const returns = calculateSubsequentClosure({
    allocations,
    consumed: consumedAfterReopen,
  });

  // Remaining active stock returned to warehouse: 197 - 166 = 31
  assert.equal(returns.get('UPC-001'), 31);
});
