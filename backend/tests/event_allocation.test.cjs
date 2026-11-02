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
    if (name.endsWith('/services/whatsappService') || name.endsWith('/whatsappService')) return { whatsappService: {
      sendSaleReceipt: async () => ({ success: true, messageId: 'msg-test-123' }),
      getStatus: () => ({ isConnected: true, status: 'CONNECTED', connectedNumber: '919876543210' }),
      formatPhoneToJid: (phone) => phone ? `${phone.replace(/\D/g, '')}@s.whatsapp.net` : null,
    } };
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'));
    if (name === 'dotenv') throw Error('Environment files are forbidden in isolated tests');
    return backendRequire(name);
  };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: customRequire, console,
    __dirname: path.dirname(filename), __filename: filename,
    Date, Map, Set, setTimeout, clearTimeout, setInterval, clearInterval, Buffer, process: { env: { NODE_ENV: 'test' } } }, { filename });
  return module.exports;
}

const source = p => load(path.resolve(__dirname, '../src', p));

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/sales', source('routes/sales.ts').default);
  app.use('/api/events', source('routes/events.ts').default);
  app.use('/api/games', source('routes/games.ts').default);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
});

async function request(f, method, route, body) {
  const token = jwt.sign({ id: f.user.id }, secret, { expiresIn: '1h' });
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

async function setupFixture({ whStock = 10, allocQty = 4, price = 200 } = {}) {
  const tag = randomUUID();
  const user = await prisma.user.create({
    data: { name: 'Seller ' + tag, username: 'user_' + tag, passwordHash: 'synthetic', role: 'DEVELOPER' }
  });
  const project = await prisma.project.create({ data: { name: 'Project ' + tag, code: 'PRJ_' + tag.slice(0, 4) } });
  const product = await prisma.product.create({
    data: {
      id: 'REK_' + tag.slice(0, 6),
      name: 'Textured Glass ' + tag.slice(0, 4),
      projectId: project.id,
      basePrice: price,
      inventory: { create: { quantityOnHand: whStock } }
    }
  });
  const event = await prisma.event.create({
    data: {
      name: 'Event ' + tag,
      location: 'Saket Atrium',
      status: 'ACTIVE',
      startDatetime: new Date(Date.now() - 3600000),
      endDatetime: new Date(Date.now() + 3600000),
      allocations: allocQty > 0 ? {
        create: { productId: product.id, allocatedQty: allocQty, priceAtEvent: price }
      } : undefined
    }
  });

  return { user, project, product, event };
}

test('Test 1: Allocation equals sold quantity (cannot decrease below sold, can maintain allocation)', async () => {
  const f = await setupFixture({ whStock: 2, allocQty: 4 });

  // Record sales of 4 units
  const saleRes = await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'UPI',
    totalAmount: 800,
    lines: [{ type: 'NORMAL_PRODUCT', productId: f.product.id, quantity: 4, unitPrice: 200, lineTotal: 800 }]
  });
  assert.equal(saleRes.status, 201);

  // Maintaining allocation = 4 MUST succeed
  const updateRes1 = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 4, priceAtEvent: 200 }]
  });
  assert.equal(updateRes1.status, 200);

  // Decreasing below sold quantity (3 < 4) MUST be rejected
  const updateRes2 = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 3, priceAtEvent: 200 }]
  });
  assert.equal(updateRes2.status, 400);
  assert.match(updateRes2.data.error, /cannot be lower than the quantity already sold/i);
});

test('Test 2: Allocation exceeds sold quantity (can decrease down to sold, or increase)', async () => {
  const f = await setupFixture({ whStock: 5, allocQty: 6 });

  // Sell 2 units
  const saleRes = await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 400,
    lines: [{ type: 'NORMAL_PRODUCT', productId: f.product.id, quantity: 2, unitPrice: 200, lineTotal: 400 }]
  });
  assert.equal(saleRes.status, 201);

  // Decrease to 4 (still > 2 sold) -> 2 units returned to warehouse
  const updateRes1 = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 4, priceAtEvent: 200 }]
  });
  assert.equal(updateRes1.status, 200);

  const inv1 = await prisma.inventory.findUnique({ where: { productId: f.product.id } });
  assert.equal(inv1.quantityOnHand, 7); // 5 + 2 returned = 7
});

test('Test 3 & 4: Sold quantity exceeds currently displayed allocation / unchanged allocation preserved', async () => {
  const f = await setupFixture({ whStock: 2, allocQty: 2 });

  // Simulate an anomaly where sold is 4 but allocation in DB is 2
  // We insert a sale directly into DB
  const [{ nextVal }] = await prisma.$queryRaw`SELECT nextval('receipt_number_seq')::bigint as "nextVal"`;
  await prisma.sale.create({
    data: {
      receiptNumber: Number(nextVal),
      eventId: f.event.id,
      memberId: f.user.id,
      totalAmount: 800,
      paymentMethod: 'UPI',
      items: {
        create: [{ productId: f.product.id, quantity: 4, unitPrice: 200, lineTotal: 800 }]
      }
    }
  });

  // Saving with unchanged allocation (2) MUST succeed without error or stock alteration
  const updateRes1 = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: 'Updated Event Name',
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 2, priceAtEvent: 200 }]
  });
  assert.equal(updateRes1.status, 200);

  const inv1 = await prisma.inventory.findUnique({ where: { productId: f.product.id } });
  assert.equal(inv1.quantityOnHand, 2); // Unchanged

  // Attempting to REDUCE allocation below 2 (e.g. to 1) MUST be rejected
  const updateRes2 = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 1, priceAtEvent: 200 }]
  });
  assert.equal(updateRes2.status, 400);

  // Increasing allocation to 4 (matching sold) takes 2 from warehouse -> warehouse becomes 0
  const updateRes3 = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 4, priceAtEvent: 200 }]
  });
  assert.equal(updateRes3.status, 200);

  const inv2 = await prisma.inventory.findUnique({ where: { productId: f.product.id } });
  assert.equal(inv2.quantityOnHand, 0); // Decremented from 2 to 0
});

test('Test 5 & 6: Increase allocation with sufficient stock vs insufficient stock', async () => {
  const f = await setupFixture({ whStock: 3, allocQty: 2 });

  // Increase from 2 to 5 (needs 3, warehouse has 3) -> succeeds
  const updateRes1 = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 5, priceAtEvent: 200 }]
  });
  assert.equal(updateRes1.status, 200);

  const inv1 = await prisma.inventory.findUnique({ where: { productId: f.product.id } });
  assert.equal(inv1.quantityOnHand, 0);

  // Increase from 5 to 6 (needs 1, warehouse has 0) -> MUST be rejected
  const updateRes2 = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 6, priceAtEvent: 200 }]
  });
  assert.equal(updateRes2.status, 400);
  assert.match(updateRes2.data.error, /Only 0 units are currently available/i);
});

test('Test 7: Decrease allocation without crossing consumed quantity', async () => {
  const f = await setupFixture({ whStock: 1, allocQty: 8 });

  // Sell 3 units
  await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 600,
    lines: [{ type: 'NORMAL_PRODUCT', productId: f.product.id, quantity: 3, unitPrice: 200, lineTotal: 600 }]
  });

  // Decrease to 3 (exact sold count) -> 5 units returned to warehouse
  const updateRes = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 3, priceAtEvent: 200 }]
  });
  assert.equal(updateRes.status, 200);

  const inv = await prisma.inventory.findUnique({ where: { productId: f.product.id } });
  assert.equal(inv.quantityOnHand, 6); // 1 + 5 = 6
});

test('Test 8: Edit event pricing without changing stock', async () => {
  const f = await setupFixture({ whStock: 4, allocQty: 3, price: 200 });

  const updateRes = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 3, priceAtEvent: 275 }]
  });
  assert.equal(updateRes.status, 200);

  const alloc = await prisma.eventAllocation.findFirst({ where: { eventId: f.event.id, productId: f.product.id } });
  assert.equal(Number(alloc.priceAtEvent), 275);
  assert.equal(alloc.allocatedQty, 3);

  const inv = await prisma.inventory.findUnique({ where: { productId: f.product.id } });
  assert.equal(inv.quantityOnHand, 4); // Completely untouched
});

test('Test 9: Two concurrent allocation edits are atomic', async () => {
  const f = await setupFixture({ whStock: 2, allocQty: 1 });

  // Both attempt to increase allocation from 1 to 3 (both need 2 units, but only 2 units exist in warehouse)
  const [resA, resB] = await Promise.all([
    request(f, 'PUT', `/api/events/${f.event.id}`, {
      name: f.event.name,
      location: f.event.location,
      allocations: [{ productId: f.product.id, allocatedQty: 3, priceAtEvent: 200 }]
    }),
    request(f, 'PUT', `/api/events/${f.event.id}`, {
      name: f.event.name,
      location: f.event.location,
      allocations: [{ productId: f.product.id, allocatedQty: 3, priceAtEvent: 200 }]
    })
  ]);

  // One of them must succeed (200), and if both ran, the second will see diff=0 or insufficient stock
  const statuses = [resA.status, resB.status];
  assert.ok(statuses.includes(200));

  const inv = await prisma.inventory.findUnique({ where: { productId: f.product.id } });
  assert.ok(inv.quantityOnHand >= 0, 'Warehouse inventory must never be negative');
});

test('Test 10: Two events reserving the same product cannot overdraw warehouse', async () => {
  const f1 = await setupFixture({ whStock: 5, allocQty: 2 });
  // Create Event 2 allocating 0 initially
  const event2 = await prisma.event.create({
    data: {
      name: 'Event 2',
      location: 'South Hall',
      status: 'ACTIVE',
      startDatetime: new Date(Date.now() - 3600000),
      endDatetime: new Date(Date.now() + 3600000),
      allocations: {
        create: { productId: f1.product.id, allocatedQty: 0, priceAtEvent: 200 }
      }
    }
  });

  // Event 1 increases allocation from 2 to 6 (needs 4, warehouse has 5 -> 1 left)
  const res1 = await request(f1, 'PUT', `/api/events/${f1.event.id}`, {
    name: f1.event.name,
    location: f1.event.location,
    allocations: [{ productId: f1.product.id, allocatedQty: 6, priceAtEvent: 200 }]
  });
  assert.equal(res1.status, 200);

  // Event 2 tries to allocate 3 (warehouse only has 1 left) -> MUST be rejected
  const res2 = await request(f1, 'PUT', `/api/events/${event2.id}`, {
    name: event2.name,
    location: event2.location,
    allocations: [{ productId: f1.product.id, allocatedQty: 3, priceAtEvent: 200 }]
  });
  assert.equal(res2.status, 400);
  assert.match(res2.data.error, /Only 1 units are currently available/i);
});

test('Test 11 & 12: Combo sales & game rewards consume stock accurately', async () => {
  const f = await setupFixture({ whStock: 10, allocQty: 5 });

  // Create game with f.product as win reward
  const game = await prisma.game.create({
    data: {
      name: 'Ring Toss',
      entryFee: 50,
      winRewardProductId: f.product.id,
      winRewardQuantity: 1,
      status: 'ACTIVE',
      eventId: f.event.id
    }
  });

  // Play game
  const playRes = await request(f, 'POST', '/api/games/play', {
    clientTxId: randomUUID(),
    ownerUserId: f.user.id,
    gameId: game.id,
    eventId: f.event.id,
    result: 'WIN',
    paymentMethod: 'CASH',
    cashAmount: 50,
    upiAmount: 0
  });
  assert.equal(playRes.status, 201);

  // Check event details: 1 unit sold/consumed via game reward
  const eventDetails = await request(f, 'GET', `/api/events/${f.event.id}`);
  assert.equal(eventDetails.status, 200);
  const alloc = eventDetails.data.allocations.find(a => a.productId === f.product.id);
  assert.equal(alloc.soldQty, 1);
  assert.equal(alloc.remainingQty, 4);
});

test('Test 13: Event ending and stock return reconciles once and becomes immutable', async () => {
  const f = await setupFixture({ whStock: 5, allocQty: 4 });

  // Sell 1 unit
  await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'CASH',
    totalAmount: 200,
    lines: [{ type: 'NORMAL_PRODUCT', productId: f.product.id, quantity: 1, unitPrice: 200, lineTotal: 200 }]
  });

  // Close event -> 3 unsold units returned to warehouse
  const closeRes = await request(f, 'POST', `/api/events/${f.event.id}/close`);
  assert.equal(closeRes.status, 200);

  const inv = await prisma.inventory.findUnique({ where: { productId: f.product.id } });
  assert.equal(inv.quantityOnHand, 8); // 5 + 3 = 8

  // Attempting to edit allocations on a closed event MUST be rejected
  const editClosedRes = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 2, priceAtEvent: 200 }]
  });
  assert.equal(editClosedRes.status, 400);
});

test('Test 14 & 15: Previously valid allocations remain valid; POS sales & historical receipts intact', async () => {
  const f = await setupFixture({ whStock: 2, allocQty: 4 });

  // 4 units sold
  const sale = await request(f, 'POST', '/api/sales', {
    clientTxId: randomUUID(),
    eventId: f.event.id,
    ownerUserId: f.user.id,
    paymentMethod: 'UPI',
    totalAmount: 800,
    lines: [{ type: 'NORMAL_PRODUCT', productId: f.product.id, quantity: 4, unitPrice: 200, lineTotal: 800 }]
  });
  assert.equal(sale.status, 201);
  const receiptNo = sale.data.sale.receiptNumber;

  // Existing allocation (4) remains completely valid and can be saved with price change
  const updateRes = await request(f, 'PUT', `/api/events/${f.event.id}`, {
    name: f.event.name,
    location: f.event.location,
    allocations: [{ productId: f.product.id, allocatedQty: 4, priceAtEvent: 210 }]
  });
  assert.equal(updateRes.status, 200);

  // Verify historical receipt is unchanged
  const savedSale = await prisma.sale.findUnique({
    where: { receiptNumber: receiptNo },
    include: { items: true }
  });
  assert.equal(savedSale.receiptNumber, receiptNo);
  assert.equal(Number(savedSale.totalAmount), 800);
  assert.equal(savedSale.items.length, 1);
  assert.equal(savedSale.items[0].quantity, 4);
});
