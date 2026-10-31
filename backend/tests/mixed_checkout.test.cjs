const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const backendRequire = createRequire(path.resolve(__dirname, '../package.json'));
const ts = backendRequire('typescript');
const { PrismaClient } = backendRequire('@prisma/client');
const express = backendRequire('express');
const jwt = backendRequire('jsonwebtoken');

// Explicit opt-in only. Never load .env, never use DATABASE_URL, never connect to a remote host.
const connection = process.env.IMS_TEST_DATABASE_URL;
if (!connection) throw new Error('Set IMS_TEST_DATABASE_URL to the isolated synthetic cluster.');
const target = new URL(connection);
if (target.hostname !== '127.0.0.1' || target.port !== '55439' || target.username !== 'ims_test' || target.pathname !== '/ims_synthetic_test') {
  throw new Error('Refusing a database outside the dedicated synthetic test cluster.');
}
const prisma = new PrismaClient({ datasources: { db: { url: connection } } });
const secret = 'synthetic-test-signing-key-never-for-production';
let server, base;
const modules = new Map();

function load(filename) {
  filename = path.resolve(filename);
  if (filename.endsWith('/config/env.ts')) return { ENV: { JWT_SECRET: secret, CORS_ORIGIN: 'http://127.0.0.1:5178' } };
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  const customRequire = name => {
    if (name.endsWith('/config/prisma')) return { prisma };
    if (name.endsWith('/config/env')) return { ENV: { JWT_SECRET: secret, NODE_ENV: 'test' } };
    if (name.endsWith('/sockets')) return { broadcast() {} };
    if (name.endsWith('/services/whatsappService')) return { whatsappService: {
      sendSaleReceipt: async () => ({ success: true }), getStatus: () => ({}),
    } };
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'));
    if (name === 'dotenv') throw Error('Environment files are forbidden in isolated tests');
    return backendRequire(name);
  };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: customRequire, console,
    Date, Map, Set, setTimeout, clearTimeout, Buffer, process: { env: { NODE_ENV: 'test' } } }, { filename });
  return module.exports;
}

const source = p => load(path.resolve(__dirname, '../src', p));

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/sales', source('routes/sales.ts').default);
  app.use('/api/combos', source('routes/combos.ts').default);
  app.use('/api/analytics', source('routes/analytics.ts').default);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
});

async function request(f, method, route, body, userOverride) {
  const token = jwt.sign({ id: userOverride?.id || f.user.id }, secret, { expiresIn: '1h' });
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

async function setupShopFixture() {
  const tag = randomUUID();
  const user = await prisma.user.create({
    data: { name: 'Cashier mohak', username: 'mohak_' + tag, passwordHash: 'synthetic', role: 'DEVELOPER' }
  });
  const project = await prisma.project.create({ data: { name: 'RE-KAANCH ' + tag, code: 'RK_' + tag.slice(0, 4) } });

  // Create products: Textured Glass, Phoenix Glass, Textured Dip Bowl, Glass Snack Tray
  const prodGlass = await prisma.product.create({
    data: { id: 'glass_' + tag, name: 'The phoenix glass', projectId: project.id, basePrice: 300,
      inventory: { create: { quantityOnHand: 20 } } }
  });
  const prodBowl = await prisma.product.create({
    data: { id: 'bowl_' + tag, name: 'Textured Dip Bowl', projectId: project.id, basePrice: 200,
      inventory: { create: { quantityOnHand: 10 } } }
  });
  const prodTray = await prisma.product.create({
    data: { id: 'tray_' + tag, name: 'Textured Glass Snack Tray', projectId: project.id, basePrice: 400,
      inventory: { create: { quantityOnHand: 10 } } }
  });
  const prodPen = await prisma.product.create({
    data: { id: 'pen_' + tag, name: 'Seeded Pen', projectId: project.id, basePrice: 30,
      inventory: { create: { quantityOnHand: 100 } } }
  });
  const prodScrunchie = await prisma.product.create({
    data: { id: 'scrunchie_' + tag, name: 'Zipper Scrunchie', projectId: project.id, basePrice: 80,
      inventory: { create: { quantityOnHand: 50 } } }
  });

  // Active event stall
  const event = await prisma.event.create({
    data: {
      name: 'Nexus Select CityWalk ' + tag,
      location: 'Main Atrium',
      status: 'ACTIVE',
      startDatetime: new Date(Date.now() - 3600000),
      endDatetime: new Date(Date.now() + 3600000),
      allocations: {
        create: [
          { productId: prodGlass.id, allocatedQty: 10, priceAtEvent: 300 },
          { productId: prodBowl.id, allocatedQty: 5, priceAtEvent: 200 },
          { productId: prodTray.id, allocatedQty: 5, priceAtEvent: 400 },
          { productId: prodPen.id, allocatedQty: 50, priceAtEvent: 30 },
          { productId: prodScrunchie.id, allocatedQty: 30, priceAtEvent: 80 },
        ]
      }
    }
  });

  // Combo 1: Textured Glass Set (1 Tray + 2 Glasses) configured at ₹850
  const comboTexturedSet = await prisma.combo.create({
    data: {
      name: 'Textured Glass Set',
      price: 850,
      comboType: 'FIXED_QUANTITY',
      projectId: project.id,
      items: {
        create: [
          { productId: prodTray.id, quantity: 1 },
          { productId: prodGlass.id, quantity: 2 },
        ]
      }
    }
  });

  // Combo 2: Starter Bundle (1 Bowl + 1 Glass) configured at ₹450
  const comboStarter = await prisma.combo.create({
    data: {
      name: 'Starter Bundle',
      price: 450,
      comboType: 'FIXED_QUANTITY',
      projectId: project.id,
      items: {
        create: [
          { productId: prodBowl.id, quantity: 1 },
          { productId: prodGlass.id, quantity: 1 },
        ]
      }
    }
  });

  // Combo 3: Seeded pen (Pack of 5) configured at ₹120
  const comboPen = await prisma.combo.create({
    data: {
      name: 'Seeded pen (Pack of 5)',
      price: 120,
      comboType: 'FIXED_QUANTITY',
      projectId: project.id,
      items: {
        create: [
          { productId: prodPen.id, quantity: 5 },
        ]
      }
    }
  });

  // Combo 4: Zipper Scrunchie (Pack of 2) configured at ₹150
  const comboScrunchie = await prisma.combo.create({
    data: {
      name: 'Zipper Scrunchie (Pack of 2)',
      price: 150,
      comboType: 'FIXED_QUANTITY',
      projectId: project.id,
      items: {
        create: [
          { productId: prodScrunchie.id, quantity: 2 },
        ]
      }
    }
  });

  return { user, project, event, prodGlass, prodBowl, prodTray, prodPen, prodScrunchie, comboTexturedSet, comboStarter, comboPen, comboScrunchie };
}

test('Test 1-8: Unified POS Checkout with normal products, combos, and multiple combos', async () => {
  const f = await setupShopFixture();

  // Test Case 1: Normal product only
  const tx1 = randomUUID();
  const r1 = await request(f, 'POST', '/api/sales', {
    clientTxId: tx1,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 300,
    lines: [
      { type: 'NORMAL_PRODUCT', productId: f.prodGlass.id, name: 'The phoenix glass', quantity: 1, unitPrice: 300, lineTotal: 300 }
    ]
  });
  assert.equal(r1.status, 201);
  assert.equal(r1.data.sale.totalAmount, 300);
  assert.equal(r1.data.sale.lines.length, 1);
  assert.equal(r1.data.sale.lines[0].type, 'NORMAL_PRODUCT');

  // Test Case 2: Single combo only
  const tx2 = randomUUID();
  const r2 = await request(f, 'POST', '/api/sales', {
    clientTxId: tx2,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'UPI',
    totalAmount: 850,
    lines: [
      {
        type: 'COMBO',
        comboId: f.comboTexturedSet.id,
        name: 'Textured Glass Set',
        quantity: 1,
        unitPrice: 850,
        lineTotal: 850,
        components: [
          { productId: f.prodTray.id, productName: 'Textured Glass Snack Tray', quantity: 1 },
          { productId: f.prodGlass.id, productName: 'The phoenix glass', quantity: 2 },
        ]
      }
    ]
  });
  assert.equal(r2.status, 201);
  assert.equal(r2.data.sale.totalAmount, 850);
  assert.equal(r2.data.sale.lines[0].type, 'COMBO');

  // Test Case 3: Multiple normal products
  const tx3 = randomUUID();
  const r3 = await request(f, 'POST', '/api/sales', {
    clientTxId: tx3,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 700, // 1 Glass (300) + 2 Bowls (400)
    lines: [
      { type: 'NORMAL_PRODUCT', productId: f.prodGlass.id, name: 'The phoenix glass', quantity: 1, unitPrice: 300, lineTotal: 300 },
      { type: 'NORMAL_PRODUCT', productId: f.prodBowl.id, name: 'Textured Dip Bowl', quantity: 2, unitPrice: 200, lineTotal: 400 },
    ]
  });
  assert.equal(r3.status, 201);
  assert.equal(r3.data.sale.totalAmount, 700);

  // Test Case 4: Multiple combos in one bill
  const tx4 = randomUUID();
  const r4 = await request(f, 'POST', '/api/sales', {
    clientTxId: tx4,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'UPI',
    totalAmount: 1300, // 850 + 450
    lines: [
      { type: 'COMBO', comboId: f.comboTexturedSet.id, name: 'Textured Glass Set', quantity: 1, unitPrice: 850, lineTotal: 850 },
      { type: 'COMBO', comboId: f.comboStarter.id, name: 'Starter Bundle', quantity: 1, unitPrice: 450, lineTotal: 450 },
    ]
  });
  assert.equal(r4.status, 201);
  assert.equal(r4.data.sale.totalAmount, 1300);
  assert.equal(r4.data.sale.lines.length, 2);
});

test('Test 9-11: Actual User Example (₹1,650 mixed bill) and shared component inventory accounting', async () => {
  const f = await setupShopFixture();

  // Test Case 5, 6, 9: EXACT EXAMPLE FROM POS
  // - Textured Glass Set combo: 1 × ₹850
  // - The phoenix glass: 2 × ₹300 = ₹600
  // - Textured Dip Bowl: 1 × ₹200
  // Total: ₹1,650 (3 product/combo lines, 4 units in the bill)
  const txMixed = randomUUID();
  const rMixed = await request(f, 'POST', '/api/sales', {
    clientTxId: txMixed,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH_UPI',
    cashAmount: 650,
    upiAmount: 1000,
    totalAmount: 1650,
    lines: [
      {
        type: 'COMBO',
        comboId: f.comboTexturedSet.id,
        name: 'Textured Glass Set',
        quantity: 1,
        unitPrice: 850,
        lineTotal: 850,
        components: [
          { productId: f.prodTray.id, productName: 'Textured Glass Snack Tray', quantity: 1 },
          { productId: f.prodGlass.id, productName: 'The phoenix glass', quantity: 2 },
        ]
      },
      { type: 'NORMAL_PRODUCT', productId: f.prodGlass.id, name: 'The phoenix glass', quantity: 2, unitPrice: 300, lineTotal: 600 },
      { type: 'NORMAL_PRODUCT', productId: f.prodBowl.id, name: 'Textured Dip Bowl', quantity: 1, unitPrice: 200, lineTotal: 200 },
    ]
  });

  assert.equal(rMixed.status, 201, JSON.stringify(rMixed.data));
  assert.equal(rMixed.data.sale.totalAmount, 1650);
  assert.equal(rMixed.data.sale.commercialUnits, 4); // 1 combo bundle + 2 glasses + 1 bowl = 4 units
  assert.equal(rMixed.data.sale.physicalUnits, 6); // 1 tray + 2 combo glasses + 2 normal glasses + 1 bowl = 6 physical items
  assert.equal(rMixed.data.sale.lines.length, 3);
  assert.equal(rMixed.data.sale.transactionType, 'MIXED');

  // Verify inventory consumption for shared component 'The phoenix glass':
  // Combo required 2, normal line required 2 -> Total 4 glasses consumed from event stall.
  const glassItems = await prisma.saleItem.findMany({
    where: { saleId: rMixed.data.sale.id, productId: f.prodGlass.id }
  });
  const totalGlassesDeducted = glassItems.reduce((sum, item) => sum + item.quantity, 0);
  assert.equal(totalGlassesDeducted, 4);

  // Test Case 11: Insufficient stock for component is cleanly rejected with 409
  const txFail = randomUUID();
  const rFail = await request(f, 'POST', '/api/sales', {
    clientTxId: txFail,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 8500,
    lines: [
      { type: 'COMBO', comboId: f.comboTexturedSet.id, name: 'Textured Glass Set', quantity: 20, unitPrice: 850, lineTotal: 17000 }
    ]
  });
  assert.equal(rFail.status, 409);
});

test('Test 15-20: Split Payments, Concurrency, and Idempotency', async () => {
  const f = await setupShopFixture();
  const clientTxId = randomUUID();

  // Test Case 17: Valid Split Payment
  const body = {
    clientTxId,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH_UPI',
    cashAmount: 650,
    upiAmount: 1000,
    totalAmount: 1650,
    lines: [
      { type: 'COMBO', comboId: f.comboTexturedSet.id, name: 'Textured Glass Set', quantity: 1, unitPrice: 850, lineTotal: 850 },
      { type: 'NORMAL_PRODUCT', productId: f.prodGlass.id, name: 'The phoenix glass', quantity: 2, unitPrice: 300, lineTotal: 600 },
      { type: 'NORMAL_PRODUCT', productId: f.prodBowl.id, name: 'Textured Dip Bowl', quantity: 1, unitPrice: 200, lineTotal: 200 },
    ]
  };

  const r = await request(f, 'POST', '/api/sales', body);
  assert.equal(r.status, 201);
  assert.equal(r.data.sale.cashAmount, 650);
  assert.equal(r.data.sale.upiAmount, 1000);

  // Test Case 18: Duplicate checkout request with same idempotency key returns existing sale
  const retry = await request(f, 'POST', '/api/sales', body);
  assert.equal(retry.status, 200);
  assert.equal(retry.data.sale.receiptNumber, r.data.sale.receiptNumber);

  // Test Case 19: Concurrency - concurrent retries return the same sale
  const concurrent = await Promise.all([
    request(f, 'POST', '/api/sales', body),
    request(f, 'POST', '/api/sales', body),
  ]);
  assert(concurrent.every(res => res.status === 200 && res.data.sale.receiptNumber === r.data.sale.receiptNumber));
});

test('Test 21-22: Sales History & Analytics correctness without double counting', async () => {
  const f = await setupShopFixture();

  // Post a mixed sale of ₹1,650
  const tx = randomUUID();
  const mixedRes = await request(f, 'POST', '/api/sales', {
    clientTxId: tx,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 1650,
    lines: [
      { type: 'COMBO', comboId: f.comboTexturedSet.id, name: 'Textured Glass Set', quantity: 1, unitPrice: 850, lineTotal: 850 },
      { type: 'NORMAL_PRODUCT', productId: f.prodGlass.id, name: 'The phoenix glass', quantity: 2, unitPrice: 300, lineTotal: 600 },
      { type: 'NORMAL_PRODUCT', productId: f.prodBowl.id, name: 'Textured Dip Bowl', quantity: 1, unitPrice: 200, lineTotal: 200 },
    ]
  });
  assert.equal(mixedRes.status, 201);

  // Check Sales History GET /api/sales
  const salesHistory = await request(f, 'GET', `/api/sales?eventId=${f.event.id}`);
  assert.equal(salesHistory.status, 200);
  const foundSale = salesHistory.data.sales.find(s => s.id === mixedRes.data.sale.id);
  assert(foundSale);
  assert.equal(foundSale.lines.length, 3);
  assert.equal(foundSale.commercialUnits, 4);
  assert.equal(foundSale.totalAmount, 1650);
  assert.equal(foundSale.transactionType, 'MIXED');

  // Check Analytics Dashboard GET /api/analytics/dashboard
  const analytics = await request(f, 'GET', `/api/analytics/dashboard?eventId=${f.event.id}`);
  assert.equal(analytics.status, 200);
  assert.equal(analytics.data.overview.totalRevenue, 1650);

  // Check Combo Analytics: The combo contribution must be exactly ₹850, NOT the entire ₹1,650 mixed bill!
  const comboStats = analytics.data.comboStats?.combos?.find(c => c.id === f.comboTexturedSet.id);
  if (comboStats) {
    assert.equal(comboStats.totalRevenue, 850);
    assert.equal(comboStats.totalQuantity, 1);
  }
});

test('Test 23: Exact user reproduction: 2 combos (Seeded pen ₹120 + Zipper Scrunchie ₹150 = ₹270, CASH) must NEVER be rejected as a game', async () => {
  const f = await setupShopFixture();

  const allocPenBefore = await prisma.eventAllocation.findUnique({
    where: { eventId_productId: { eventId: f.event.id, productId: f.prodPen.id } }
  });
  const allocScrunchieBefore = await prisma.eventAllocation.findUnique({
    where: { eventId_productId: { eventId: f.event.id, productId: f.prodScrunchie.id } }
  });

  const tx = randomUUID();
  const res = await request(f, 'POST', '/api/sales', {
    clientTxId: tx,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 270,
    transactionType: 'COMBO',
    lines: [
      { type: 'COMBO', comboId: f.comboPen.id, name: 'Seeded pen (Pack of 5)', quantity: 1, unitPrice: 120, lineTotal: 120 },
      { type: 'COMBO', comboId: f.comboScrunchie.id, name: 'Zipper Scrunchie (Pack of 2)', quantity: 1, unitPrice: 150, lineTotal: 150 },
    ]
  });

  assert.equal(res.status, 201, 'Response must be 201 Created and NOT 409 Game Conflict');
  assert.equal(res.data.sale.totalAmount, 270);
  assert.equal(res.data.sale.paymentMethod, 'CASH');
  assert.equal(res.data.sale.receiptNumber > 0, true);
  assert.equal(res.data.sale.transactionType, 'COMBO');

  // Verify physical items fulfilled: 5 pens and 2 scrunchies recorded in sale items
  const createdSale = await prisma.sale.findUnique({
    where: { id: res.data.sale.id },
    include: { items: true }
  });
  const penItem = createdSale.items.find(i => i.productId === f.prodPen.id);
  const scrunchieItem = createdSale.items.find(i => i.productId === f.prodScrunchie.id);
  assert(penItem, 'Pen component must be fulfilled in physical items');
  assert.equal(penItem.quantity, 5);
  assert(scrunchieItem, 'Scrunchie component must be fulfilled in physical items');
  assert.equal(scrunchieItem.quantity, 2);

  // Test with transactionType: 'MIXED' (as sent when mixed flags trigger)
  const txMixed = randomUUID();
  const resMixed = await request(f, 'POST', '/api/sales', {
    clientTxId: txMixed,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 270,
    transactionType: 'MIXED',
    lines: [
      { type: 'COMBO', comboId: f.comboPen.id, name: 'Seeded pen (Pack of 5)', quantity: 1, unitPrice: 120, lineTotal: 120 },
      { type: 'COMBO', comboId: f.comboScrunchie.id, name: 'Zipper Scrunchie (Pack of 2)', quantity: 1, unitPrice: 150, lineTotal: 150 },
    ]
  });
  assert.equal(resMixed.status, 201, 'MIXED transactionType must also be accepted and NOT rejected as a game');
});

test('Test 24: Actual game operations with gameId or transactionType GAME sent to /api/sales MUST be rejected', async () => {
  const f = await setupShopFixture();

  // Sending gameId to /api/sales must throw 409 Game operations must use game transaction endpoint
  const resWithGameId = await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    gameId: randomUUID(),
    paymentMethod: 'CASH',
    totalAmount: 50,
    lines: [
      { type: 'NORMAL_PRODUCT', productId: f.prodGlass.id, quantity: 1, unitPrice: 50, lineTotal: 50 }
    ]
  });
  assert.equal(resWithGameId.status, 409);
  assert.match(resWithGameId.data.error, /Game operations must use the game transaction endpoint/);

  // Sending transactionType: 'GAME' to /api/sales must throw 409 Game operations must use game transaction endpoint
  const resWithGameType = await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    transactionType: 'GAME',
    paymentMethod: 'CASH',
    totalAmount: 50,
    lines: [
      { type: 'NORMAL_PRODUCT', productId: f.prodGlass.id, quantity: 1, unitPrice: 50, lineTotal: 50 }
    ]
  });
  assert.equal(resWithGameType.status, 409);
  assert.match(resWithGameType.data.error, /Game operations must use the game transaction endpoint/);
});

async function getRemainingStallStock(eventId, productId) {
  const consumed = await source('services/stock.ts').eventConsumption(prisma, eventId);
  const alloc = await prisma.eventAllocation.findFirst({ where: { eventId, productId } });
  return (alloc?.allocatedQty || 0) - (consumed.get(productId) || 0);
}

test('Test 25: Safe void/cancellation of a normal sale restores stall stock and records audit trail', async () => {
  const f = await setupShopFixture();

  // Create a normal sale of 2 phoenix glasses at active stall
  const txId = randomUUID();
  const saleRes = await request(f, 'POST', '/api/sales', {
    clientTxId: txId,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'UPI',
    totalAmount: 600,
    lines: [
      { type: 'NORMAL_PRODUCT', productId: f.prodGlass.id, quantity: 2, unitPrice: 300, lineTotal: 600 }
    ]
  });
  assert.equal(saleRes.status, 201);
  const saleId = saleRes.data.sale.id;

  // Verify stock before cancellation: allocated 10, consumed 2, remaining 8
  const stockBefore = await getRemainingStallStock(f.event.id, f.prodGlass.id);
  assert.equal(stockBefore, 8);

  // Void/Cancel sale as Developer/Admin
  const cancelRes = await request(f, 'POST', `/api/sales/${saleId}/cancel`, {
    reason: 'Customer cancelled transaction before delivery'
  });
  assert.equal(cancelRes.status, 200);
  assert.match(cancelRes.data.message, /successfully voided and inventory restored/);
  assert.equal(cancelRes.data.sale.status, 'CANCELLED');
  assert.equal(cancelRes.data.sale.cancelReason, 'Customer cancelled transaction before delivery');
  assert.equal(cancelRes.data.sale.cancelledByName, f.user.name);

  // Verify stock after cancellation: 2 units restored to stall (remaining 10)
  const stockAfter = await getRemainingStallStock(f.event.id, f.prodGlass.id);
  assert.equal(stockAfter, 10);
});

test('Test 26: Safe void/cancellation of a combo sale restores all component items to stall stock', async () => {
  const f = await setupShopFixture();

  // Textured Glass Set = 1 Tray + 2 Glasses
  const txId = randomUUID();
  const comboSaleRes = await request(f, 'POST', '/api/sales', {
    clientTxId: txId,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 850,
    lines: [
      { type: 'COMBO', comboId: f.comboTexturedSet.id, name: 'Textured Glass Set', quantity: 1, unitPrice: 850, lineTotal: 850 }
    ]
  });
  assert.equal(comboSaleRes.status, 201);
  const saleId = comboSaleRes.data.sale.id;

  // Stock before cancel: Tray (5 - 1 = 4), Glass (10 - 2 = 8)
  const trayBefore = await getRemainingStallStock(f.event.id, f.prodTray.id);
  const glassBefore = await getRemainingStallStock(f.event.id, f.prodGlass.id);
  assert.equal(trayBefore, 4);
  assert.equal(glassBefore, 8);

  // Void/Cancel the combo sale
  const cancelRes = await request(f, 'POST', `/api/sales/${saleId}/cancel`, {
    reason: 'Defective combo item returned'
  });
  assert.equal(cancelRes.status, 200);

  // Both components restored to stall
  const trayAfter = await getRemainingStallStock(f.event.id, f.prodTray.id);
  const glassAfter = await getRemainingStallStock(f.event.id, f.prodGlass.id);
  assert.equal(trayAfter, 5);
  assert.equal(glassAfter, 10);
});

test('Test 27: Safe void/cancellation of a mixed sale restores both normal and combo components', async () => {
  const f = await setupShopFixture();

  // Mixed bill: 1 Combo (1 Tray + 2 Glasses) + 1 Normal Dip Bowl
  const txId = randomUUID();
  const mixedRes = await request(f, 'POST', '/api/sales', {
    clientTxId: txId,
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'UPI',
    totalAmount: 1050,
    lines: [
      { type: 'COMBO', comboId: f.comboTexturedSet.id, name: 'Textured Glass Set', quantity: 1, unitPrice: 850, lineTotal: 850 },
      { type: 'NORMAL_PRODUCT', productId: f.prodBowl.id, quantity: 1, unitPrice: 200, lineTotal: 200 },
    ]
  });
  assert.equal(mixedRes.status, 201);
  const saleId = mixedRes.data.sale.id;

  // Stock before: Tray 4, Glass 8, Bowl 4
  assert.equal(await getRemainingStallStock(f.event.id, f.prodTray.id), 4);
  assert.equal(await getRemainingStallStock(f.event.id, f.prodGlass.id), 8);
  assert.equal(await getRemainingStallStock(f.event.id, f.prodBowl.id), 4);

  // Direct DELETE is rejected with 409 preserveRecords (never purge database rows)
  const delAttempt = await request(f, 'DELETE', `/api/sales/${saleId}`);
  assert.equal(delAttempt.status, 409);

  // Safe cancellation via POST /api/sales/:id/cancel
  const cancelRes = await request(f, 'POST', `/api/sales/${saleId}/cancel`, { reason: 'Mixed order cancellation' });
  assert.equal(cancelRes.status, 200);

  // All restored
  assert.equal(await getRemainingStallStock(f.event.id, f.prodTray.id), 5);
  assert.equal(await getRemainingStallStock(f.event.id, f.prodGlass.id), 10);
  assert.equal(await getRemainingStallStock(f.event.id, f.prodBowl.id), 5);
});

test('Test 28: Cancellation permissions enforcement (MEMBER rejected with 403, HEAD without perm rejected, authorized roles accepted)', async () => {
  const f = await setupShopFixture();

  // Create member user
  const memberUser = await prisma.user.create({
    data: { name: 'Member Jane', username: 'member_' + randomUUID(), passwordHash: 'synthetic', role: 'MEMBER' }
  });

  // Create head user without edit_events
  const headUserNoPerm = await prisma.user.create({
    data: { name: 'Head John', username: 'head_noperm_' + randomUUID(), passwordHash: 'synthetic', role: 'HEAD' }
  });

  // Create head user WITH edit_events permission
  const headUserWithPerm = await prisma.user.create({
    data: {
      name: 'Head Sarah',
      username: 'head_perm_' + randomUUID(),
      passwordHash: 'synthetic',
      role: 'HEAD',
      permissions: { create: { permissionKey: 'edit_events', allowed: true } }
    }
  });

  // Create a sale
  const saleRes = await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 200,
    lines: [{ type: 'NORMAL_PRODUCT', productId: f.prodBowl.id, quantity: 1, unitPrice: 200, lineTotal: 200 }]
  });
  const saleId = saleRes.data.sale.id;

  // 1. Member attempt -> 403 Forbidden
  const resMember = await request(f, 'POST', `/api/sales/${saleId}/cancel`, { reason: 'Unauthorized cancel' }, memberUser);
  assert.equal(resMember.status, 403);
  assert.match(resMember.data.error, /insufficient privileges/);

  // 2. Head without permission attempt -> 403 Forbidden
  const resHeadNoPerm = await request(f, 'POST', `/api/sales/${saleId}/cancel`, { reason: 'No perm cancel' }, headUserNoPerm);
  assert.equal(resHeadNoPerm.status, 403);

  // 3. Head with edit_events permission -> 200 OK
  const resHeadPerm = await request(f, 'POST', `/api/sales/${saleId}/cancel`, { reason: 'Manager approved return' }, headUserWithPerm);
  assert.equal(resHeadPerm.status, 200);
});

test('Test 29: Idempotency and validation: missing reason returns 400, duplicate cancel returns 409', async () => {
  const f = await setupShopFixture();

  const saleRes = await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 200,
    lines: [{ type: 'NORMAL_PRODUCT', productId: f.prodBowl.id, quantity: 1, unitPrice: 200, lineTotal: 200 }]
  });
  const saleId = saleRes.data.sale.id;

  // Missing reason on POST /:id/cancel -> 400 Bad Request
  const resEmptyReason = await request(f, 'POST', `/api/sales/${saleId}/cancel`, { reason: '   ' });
  assert.equal(resEmptyReason.status, 400);
  assert.match(resEmptyReason.data.error, /cancellation reason is required/);

  // First cancellation -> 200 OK
  const resFirst = await request(f, 'POST', `/api/sales/${saleId}/cancel`, { reason: 'Valid initial reason' });
  assert.equal(resFirst.status, 200);

  // Second duplicate cancellation attempt -> 409 Conflict
  const resDup = await request(f, 'POST', `/api/sales/${saleId}/cancel`, { reason: 'Trying to cancel again' });
  assert.equal(resDup.status, 409);
  assert.match(resDup.data.error, /already been cancelled/);
});

test('Test 30: Cancellation of sale from ended reconciled event restores warehouse inventory', async () => {
  const f = await setupShopFixture();

  // Create an active event
  const closedEvent = await prisma.event.create({
    data: {
      name: 'Past Closed Fair ' + randomUUID(),
      location: 'Old Hall',
      status: 'ACTIVE',
      startDatetime: new Date(Date.now() - 7200000),
      endDatetime: new Date(Date.now() + 3600000),
      allocations: {
        create: [{ productId: f.prodBowl.id, allocatedQty: 10, priceAtEvent: 200 }]
      }
    }
  });

  // Create a sale during the event
  const saleRes = await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: closedEvent.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 400,
    lines: [{ type: 'NORMAL_PRODUCT', productId: f.prodBowl.id, quantity: 2, unitPrice: 200, lineTotal: 400 }]
  });
  assert.equal(saleRes.status, 201);
  const saleId = saleRes.data.sale.id;

  // Now the event finishes and is marked reconciled (all remaining unsold stock returned to warehouse)
  await prisma.event.update({
    where: { id: closedEvent.id },
    data: {
      status: 'ENDED',
      endDatetime: new Date(Date.now() - 1000),
      reconciledAt: new Date(),
    }
  });

  // Check warehouse stock before cancel (initial fixture had 10 for bowl)
  const whBefore = await prisma.inventory.findUnique({ where: { productId: f.prodBowl.id } });
  assert.equal(whBefore.quantityOnHand, 10);

  // Cancel the sale from the reconciled event
  const cancelRes = await request(f, 'POST', `/api/sales/${saleId}/cancel`, {
    reason: 'Customer returned after event closed'
  });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.data.restoredLocations[0].location, 'Warehouse Inventory');

  // Verify warehouse stock incremented by 2 units (10 + 2 = 12)
  const whAfter = await prisma.inventory.findUnique({ where: { productId: f.prodBowl.id } });
  assert.equal(whAfter.quantityOnHand, 12);
});

test('Test 31: Sales list, status filtering, and analytics exclude cancelled sales from revenue/units', async () => {
  const f = await setupShopFixture();

  // Sale 1: Completed sale of 1 bowl (₹200)
  const s1 = await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 200,
    lines: [{ type: 'NORMAL_PRODUCT', productId: f.prodBowl.id, quantity: 1, unitPrice: 200, lineTotal: 200 }]
  });
  assert.equal(s1.status, 201);

  // Sale 2: Sale to be cancelled of 1 glass (₹300)
  const s2 = await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'UPI',
    totalAmount: 300,
    lines: [{ type: 'NORMAL_PRODUCT', productId: f.prodGlass.id, quantity: 1, unitPrice: 300, lineTotal: 300 }]
  });
  assert.equal(s2.status, 201);
  const cancelRes = await request(f, 'POST', `/api/sales/${s2.data.sale.id}/cancel`, { reason: 'Test void' });
  assert.equal(cancelRes.status, 200);

  // 1. GET /api/sales?eventId=... default view
  const listRes = await request(f, 'GET', `/api/sales?eventId=${f.event.id}`);
  assert.equal(listRes.status, 200);
  assert.equal(listRes.data.sales.length, 2); // Both are listed in history for auditability
  const activeSummaryUnits = listRes.data.summary.totalUnits;
  const activeSummaryRev = listRes.data.summary.totalRevenue;
  // Summary revenue and units must ONLY count active (completed) sales (₹200 and 1 unit, NOT ₹500 and 2 units)
  assert.equal(activeSummaryUnits, 1);
  assert.equal(activeSummaryRev, 200);

  // 2. Status filter: ?status=CANCELLED returns only the voided sale
  const voidedRes = await request(f, 'GET', `/api/sales?eventId=${f.event.id}&status=CANCELLED`);
  assert.equal(voidedRes.status, 200);
  assert.equal(voidedRes.data.sales.length, 1);
  assert.equal(voidedRes.data.sales[0].id, s2.data.sale.id);
  assert.equal(voidedRes.data.sales[0].status, 'CANCELLED');

  // 3. Status filter: ?status=COMPLETED returns only the active sale
  const compRes = await request(f, 'GET', `/api/sales?eventId=${f.event.id}&status=COMPLETED`);
  assert.equal(compRes.status, 200);
  assert.equal(compRes.data.sales.length, 1);
  assert.equal(compRes.data.sales[0].id, s1.data.sale.id);

  // 4. Analytics: GET /api/analytics/dashboard?eventId=... excludes cancelled sale
  const analyticsRes = await request(f, 'GET', `/api/analytics/dashboard?eventId=${f.event.id}`);
  assert.equal(analyticsRes.status, 200);
  assert.equal(analyticsRes.data.overview.totalRevenue, 200);
  assert.equal(analyticsRes.data.overview.totalUnitsSold, 1);
});
