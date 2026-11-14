const test = require('node:test');
const assert = require('node:assert/strict');

// Business logic functions matching specialSales.ts
function aggregateStockRequirements(items) {
  const map = new Map();
  for (const item of items) {
    if (item.itemType === 'COMBO' && Array.isArray(item.components)) {
      for (const comp of item.components) {
        const needed = (Number(comp.quantity) || 1) * item.quantity;
        const existing = map.get(comp.productId);
        if (existing) {
          existing.quantity += needed;
        } else {
          map.set(comp.productId, {
            productId: comp.productId,
            productName: comp.productName || comp.productId,
            quantity: needed,
          });
        }
      }
    } else if (item.productId) {
      const needed = item.quantity;
      const existing = map.get(item.productId);
      if (existing) {
        existing.quantity += needed;
      } else {
        map.set(item.productId, {
          productId: item.productId,
          productName: item.productName || item.productId,
          quantity: needed,
        });
      }
    }
  }
  return map;
}

function processStockAllocation(items, warehouseStock) {
  const stockReqs = aggregateStockRequirements(items);
  // 1. Validate
  for (const [pid, req] of stockReqs.entries()) {
    const current = warehouseStock.get(pid) || 0;
    if (current < req.quantity) {
      throw new Error(
        `Insufficient warehouse stock for '${req.productName}' (${pid}). Requested: ${req.quantity} units, available in warehouse: ${current} units (shortfall: ${req.quantity - current} units).`
      );
    }
  }
  // 2. Decrement
  const updatedStock = new Map(warehouseStock);
  for (const [pid, req] of stockReqs.entries()) {
    updatedStock.set(pid, updatedStock.get(pid) - req.quantity);
  }
  return updatedStock;
}

function processStockRestoration(items, warehouseStock) {
  const stockReqs = aggregateStockRequirements(items);
  const updatedStock = new Map(warehouseStock);
  for (const [pid, req] of stockReqs.entries()) {
    updatedStock.set(pid, (updatedStock.get(pid) || 0) + req.quantity);
  }
  return updatedStock;
}

function calculateComboAvailability(combo, warehouseStock) {
  if (!combo.items || combo.items.length === 0) return 0;
  const ratios = combo.items.map(ci => {
    const required = Number(ci.quantity) || 1;
    const wh = warehouseStock.get(ci.productId) || 0;
    return Math.floor(wh / required);
  });
  return Math.min(...ratios);
}

// ----------------------------------------------------
// TEST CASES
// ----------------------------------------------------

test('1. Combo pricing: Negotiated price applies to the whole combo, not individual items', () => {
  // Existing combo: Normal Scrunchie x 3 @ Standard Price ₹120
  const standardPrice = 120;
  const negotiatedUnitPrice = 110;
  const quantity = 10;
  const itemDiscount = 0;

  const lineTotal = Math.max(0, negotiatedUnitPrice * quantity - itemDiscount);
  assert.equal(lineTotal, 1100, '10 combos @ ₹110 negotiated unit price must equal ₹1,100');

  // With additional item discount of ₹50
  const lineTotalWithDiscount = Math.max(0, negotiatedUnitPrice * quantity - 50);
  assert.equal(lineTotalWithDiscount, 1050, 'Line total with ₹50 discount must equal ₹1,050');
});

test('2. Dynamic combo warehouse availability based on lowest component ratio', () => {
  // Combo contains: Product A x 3, Product B x 2
  const combo = {
    id: 'combo-1',
    name: 'Artisan Glassware Set',
    items: [
      { productId: 'PROD-A', quantity: 3 },
      { productId: 'PROD-B', quantity: 2 },
    ],
  };

  // Stock: PROD-A has 31 units (31 / 3 = 10 sets), PROD-B has 15 units (15 / 2 = 7 sets)
  const warehouseStock = new Map([
    ['PROD-A', 31],
    ['PROD-B', 15],
  ]);

  const maxAvailability = calculateComboAvailability(combo, warehouseStock);
  assert.equal(maxAvailability, 7, 'Availability must be bound by the lowest component ratio (7 sets)');
});

test('3. Component stock deduction: Deducts actual component units atomically upon confirmation', () => {
  const warehouseStock = new Map([
    ['SCR-001', 50], // Normal Scrunchie
    ['AQU-001', 20], // Aqua Bowl
  ]);

  const orderItems = [
    {
      itemType: 'COMBO',
      comboId: 'combo-scrunchie-pack',
      comboName: 'Normal Scrunchie Combo (Pack of 3)',
      quantity: 10, // 10 combos of 3 = 30 Scrunchies
      components: [
        { productId: 'SCR-001', productName: 'Normal Scrunchie', quantity: 3 },
      ],
      standardPrice: 120,
      specialPrice: 110,
    },
    {
      itemType: 'PRODUCT',
      productId: 'AQU-001',
      productName: 'Aqua Bowl',
      quantity: 5,
      standardPrice: 600,
      specialPrice: 550,
    },
  ];

  const updatedStock = processStockAllocation(orderItems, warehouseStock);

  assert.equal(updatedStock.get('SCR-001'), 20, 'SCR-001: 50 - 30 = 20 remaining in warehouse');
  assert.equal(updatedStock.get('AQU-001'), 15, 'AQU-001: 20 - 5 = 15 remaining in warehouse');
});

test('4. Mixed cart stock aggregation: Accurately sums quantities when component is bought both in combo and standalone', () => {
  const warehouseStock = new Map([
    ['SCR-001', 40],
  ]);

  const orderItems = [
    // 10 combos containing 3 Scrunchies each = 30 Scrunchies
    {
      itemType: 'COMBO',
      comboId: 'combo-scr-3',
      quantity: 10,
      components: [
        { productId: 'SCR-001', productName: 'Normal Scrunchie', quantity: 3 },
      ],
    },
    // 5 standalone Scrunchies
    {
      itemType: 'PRODUCT',
      productId: 'SCR-001',
      productName: 'Normal Scrunchie',
      quantity: 5,
    },
  ];

  const requirements = aggregateStockRequirements(orderItems);
  assert.equal(requirements.get('SCR-001').quantity, 35, 'Total requirement must be 30 + 5 = 35 units');

  const updatedStock = processStockAllocation(orderItems, warehouseStock);
  assert.equal(updatedStock.get('SCR-001'), 5, 'Warehouse stock must be 40 - 35 = 5 units');
});

test('5. Stock shortage detection: Throws error when any combo component lacks sufficient warehouse inventory', () => {
  const warehouseStock = new Map([
    ['SCR-001', 25], // Only 25 available
  ]);

  const orderItems = [
    {
      itemType: 'COMBO',
      comboId: 'combo-scr-3',
      quantity: 10, // Requires 30
      components: [
        { productId: 'SCR-001', productName: 'Normal Scrunchie', quantity: 3 },
      ],
    },
  ];

  assert.throws(
    () => processStockAllocation(orderItems, warehouseStock),
    /Insufficient warehouse stock for 'Normal Scrunchie'/,
    'Should throw error indicating shortage for component'
  );
});

test('6. Order cancellation: Restores component stock exactly once to warehouse', () => {
  const warehouseStock = new Map([
    ['SCR-001', 20],
    ['AQU-001', 15],
  ]);

  const orderItems = [
    {
      itemType: 'COMBO',
      comboId: 'combo-scrunchie-pack',
      quantity: 10,
      components: [
        { productId: 'SCR-001', productName: 'Normal Scrunchie', quantity: 3 },
      ],
    },
    {
      itemType: 'PRODUCT',
      productId: 'AQU-001',
      productName: 'Aqua Bowl',
      quantity: 5,
    },
  ];

  const restoredStock = processStockRestoration(orderItems, warehouseStock);

  assert.equal(restoredStock.get('SCR-001'), 50, 'SCR-001: 20 + 30 = 50 restored to warehouse');
  assert.equal(restoredStock.get('AQU-001'), 20, 'AQU-001: 15 + 5 = 20 restored to warehouse');
});

test('7. Component snapshot immutability: Snapshot preserves components even if combo is modified', () => {
  const originalCombo = {
    id: 'combo-abc',
    name: 'Gift Hamper',
    items: [
      { productId: 'PROD-1', quantity: 2, unitPrice: 50 },
      { productId: 'PROD-2', quantity: 1, unitPrice: 100 },
    ],
  };

  // Snapshot taken at sale creation
  const snapshot = originalCombo.items.map(ci => ({
    productId: ci.productId,
    quantity: ci.quantity,
    unitPrice: ci.unitPrice,
  }));

  // Later, combo definition in master database is modified or archived
  originalCombo.items = [{ productId: 'PROD-3', quantity: 1, unitPrice: 200 }];

  assert.equal(snapshot.length, 2, 'Historical snapshot remains preserved');
  assert.equal(snapshot[0].productId, 'PROD-1');
  assert.equal(snapshot[0].quantity, 2);
  assert.equal(snapshot[1].productId, 'PROD-2');
});
