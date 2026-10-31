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

  return { user, project, event, prodGlass, prodBowl, prodTray, comboTexturedSet, comboStarter };
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
