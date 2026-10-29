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
if (!connection) throw new Error('Set IMS_TEST_DATABASE_URL to the isolated synthetic cluster; production is never a default.');
const target = new URL(connection);
if (target.hostname !== '127.0.0.1' || target.port !== '55439' || target.username !== 'ims_test' || target.pathname !== '/ims_synthetic_test') {
  throw new Error('Refusing a database outside the dedicated synthetic test cluster.');
}
const prisma = new PrismaClient({ datasources: { db: { url: connection } } });
const secret = 'synthetic-test-signing-key-never-for-production';
let messages = 0, queries = 0, server, base;
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
      sendSaleReceipt: async () => { messages++; return { success: true }; }, getStatus: () => ({}),
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
async function fixture({ stock = 10, allocated = 1, warehouseReward = false } = {}) {
  const tag = randomUUID();
  const user = await prisma.user.create({ data: { name: 'Synthetic seller', username: tag, passwordHash: 'synthetic-only', role: 'DEVELOPER' } });
  const project = await prisma.project.create({ data: { name: tag, code: tag } });
  const product = await prisma.product.create({ data: { id: tag, name: 'Synthetic product', projectId: project.id,
    inventory: { create: { quantityOnHand: stock } } } });
  const event = await prisma.event.create({ data: { name: 'Synthetic event', location: 'Local test', status: 'ACTIVE',
    startDatetime: new Date(Date.now() - 3600000), endDatetime: new Date(Date.now() + 3600000),
    allocations: warehouseReward ? undefined : { create: { productId: product.id, allocatedQty: allocated, priceAtEvent: 100 } },
  } });
  const game = await prisma.game.create({ data: { name: 'Synthetic game', entryFee: 30,
    winRewardProductId: product.id, winRewardQuantity: 1 } });
  return { user, product, event, game, body: { clientTxId: randomUUID(), eventId: event.id,
    ownerUserId: user.id, items: [{ productId: product.id, quantity: 1, unitPrice: 100 }], paymentMethod: 'CASH', totalAmount: 100 } };
}
async function request(f, method, route, body, role) {
  const token = jwt.sign({ id: role?.id || f.user.id }, secret, { expiresIn: '1h' });
  const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify((route === '/api/games/play' && body.ownerUserId === undefined) ? { ...body, ownerUserId: f.user.id } : body) } : {}) });
  return { status: response.status, data: await response.json() };
}
before(async () => {
  await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS receipt_number_seq');
  await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS game_session_code_seq');
  const app = express(); app.use(express.json());
  for (const route of ['sales', 'games', 'events', 'projects', 'users', 'products', 'combos', 'inventory', 'whatsapp', 'analytics']) {
    app.use(`/api/${route}`, source(`routes/${route}.ts`).default);
  }
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

test('missing/invalid split payments are rejected, never invented', async () => {
  const f = await fixture();
  for (const amounts of [{}, { cashAmount: 1, upiAmount: 1 }, { cashAmount: -1, upiAmount: 101 }, { cashAmount: '1oops', upiAmount: 99 }]) {
    const r = await request(f, 'POST', '/api/sales/sync', { transactions: [{ ...f.body, paymentMethod: 'CASH_UPI', ...amounts }] });
    assert.equal(r.data.results.length, 1); assert.equal(r.data.results[0].status, 'failed');
  }
  assert.equal(await prisma.sale.count({ where: { eventId: f.event.id } }), 0);
});
test('concurrent last-unit sales cannot oversell a real PostgreSQL allocation', async () => {
  const f = await fixture();
  const rs = await Promise.all([request(f, 'POST', '/api/sales', f.body), request(f, 'POST', '/api/sales', { ...f.body, clientTxId: randomUUID() })]);
  assert.equal(rs.filter(r => r.status === 201).length, 1);
  assert.equal(await prisma.sale.count({ where: { eventId: f.event.id } }), 1);
});
test('same operation retries after stock exhaustion and closure return original receipt', async () => {
  const f = await fixture(); const first = await request(f, 'POST', '/api/sales', f.body);
  assert.equal(first.status, 201);
  await source('services/eventLifecycle.ts').reconcileSingleEvent(f.event.id, true);
  const retry = await request(f, 'POST', '/api/sales', f.body);
  assert.equal(retry.status, 200); assert.equal(retry.data.sale.receiptNumber, first.data.sale.receiptNumber);
  assert.equal(await prisma.sale.count({ where: { eventId: f.event.id } }), 1);
  const changed = await request(f, 'POST', '/api/sales', { ...f.body, items: [{ productId: f.product.id, quantity: 2 }] });
  assert.equal(changed.status, 409);
});
test('a key cannot acknowledge another seller or event', async () => {
  const f = await fixture(); await request(f, 'POST', '/api/sales', f.body);
  const other = await fixture();
  assert.equal((await request(other, 'POST', '/api/sales', { ...f.body })).status, 409);
  assert.equal((await request(f, 'POST', '/api/sales', { ...f.body, eventId: other.event.id })).status, 409);
});
test('simultaneous duplicate keys commit exactly one sale', async () => {
  const f = await fixture({ allocated: 10 });
  const rs = await Promise.all(Array.from({ length: 4 }, () => request(f, 'POST', '/api/sales', f.body)));
  assert.equal(rs.filter(r => r.status === 201).length, 1);
  assert.equal(await prisma.sale.count({ where: { clientTxId: f.body.clientTxId } }), 1);
  assert.equal((await request(f, 'POST', '/api/sales', f.body)).status, 200);
});
test('warehouse game reward deducts once, exact remaining quantity never goes negative', async () => {
  for (const stock of [10, 1]) {
    const f = await fixture({ stock, warehouseReward: true });
    const r = await request(f, 'POST', '/api/games/play', { clientTxId: randomUUID(), gameId: f.game.id, eventId: f.event.id, result: 'WIN', paymentMethod: 'CASH' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal((await prisma.inventory.findUnique({ where: { productId: f.product.id } })).quantityOnHand, stock - 1);
  }
});
test('game response loss retry after closure does not consume another reward', async () => {
  const f = await fixture({ stock: 1, warehouseReward: true });
  const body = { clientTxId: randomUUID(), gameId: f.game.id, eventId: f.event.id, result: 'WIN', paymentMethod: 'CASH' };
  const first = await request(f, 'POST', '/api/games/play', body);
  await source('services/eventLifecycle.ts').reconcileSingleEvent(f.event.id, true);
  const next = await request(f, 'POST', '/api/games/play', body);
  assert.equal(next.status, 200); assert.equal(next.data.receipt.receiptNumber, first.data.receipt.receiptNumber);
  assert.equal((await prisma.inventory.findUnique({ where: { productId: f.product.id } })).quantityOnHand, 0);
});
test('concurrent closure returns unsold stock exactly once', async () => {
  const f = await fixture({ stock: 0, allocated: 5 });
  const lifecycle = source('services/eventLifecycle.ts');
  const results = await Promise.all(Array.from({ length: 4 }, () => lifecycle.reconcileSingleEvent(f.event.id, true)));
  assert.equal(results.filter(r => r.reconciled).length, 1);
  assert.equal((await prisma.inventory.findUnique({ where: { productId: f.product.id } })).quantityOnHand, 5);
});
test('sale racing closure conserves allocation', async () => {
  const f = await fixture({ stock: 0, allocated: 5 });
  await Promise.all([request(f, 'POST', '/api/sales', f.body), source('services/eventLifecycle.ts').reconcileSingleEvent(f.event.id, true)]);
  const inv = await prisma.inventory.findUnique({ where: { productId: f.product.id } });
  const sold = await prisma.saleItem.aggregate({ where: { sale: { eventId: f.event.id } }, _sum: { quantity: true } });
  assert.equal(inv.quantityOnHand + (sold._sum.quantity || 0), 5);
});
test('event GET never finalizes or returns expired stock', async () => {
  const f = await fixture({ stock: 0, allocated: 5 });
  await prisma.event.update({ where: { id: f.event.id }, data: { endDatetime: new Date(Date.now() - 1000) } });
  assert.equal((await request(f, 'GET', `/api/events/${f.event.id}`)).status, 200);
  assert.equal((await prisma.event.findUnique({ where: { id: f.event.id } })).reconciledAt, null);
  assert.equal((await prisma.inventory.findUnique({ where: { productId: f.product.id } })).quantityOnHand, 0);
});
test('wrong-event and incomplete combo sync rejects the whole operation once', async () => {
  const f = await fixture({ allocated: 10 }); const other = await fixture();
  const combo = await prisma.combo.create({ data: { name: 'Synthetic combo', price: 10, eventId: other.event.id,
    items: { create: [{ productId: f.product.id, quantity: 1 }, { productId: other.product.id, quantity: 1 }] } } });
  const body = { ...f.body, comboId: combo.id, totalAmount: 10 };
  let r = await request(f, 'POST', '/api/sales/sync', { transactions: [body] });
  assert.equal(r.data.results.length, 1); assert.equal(r.data.results[0].status, 'failed');
  await prisma.combo.update({ where: { id: combo.id }, data: { eventId: null } });
  r = await request(f, 'POST', '/api/sales/sync', { transactions: [body] });
  assert.equal(r.data.results.length, 1); assert.equal(r.data.results[0].status, 'failed');
  assert.equal(await prisma.sale.count({ where: { eventId: f.event.id } }), 0);
});
test('a valid combo sync persists all components at bundle price', async () => {
  const f = await fixture({ allocated: 10 });
  const combo = await prisma.combo.create({ data: { name: 'Synthetic combo', price: 10,
    items: { create: [{ productId: f.product.id, quantity: 2 }] } } });
  const r = await request(f, 'POST', '/api/sales/sync', { transactions: [{ ...f.body, comboId: combo.id, totalAmount: 10,
    items: [{ productId: f.product.id, quantity: 2 }], paymentMethod: 'CASH_UPI', cashAmount: 4, upiAmount: 6 }] });
  assert.equal(r.data.results[0].status, 'success', JSON.stringify(r.data));
  const sale = await prisma.sale.findUnique({ where: { clientTxId: f.body.clientTxId }, include: { items: true } });
  assert.equal(Number(sale.totalAmount), 10); assert.equal(sale.items[0].quantity, 2);
});
test('preservation endpoints do not delete rows or renumber receipts', async () => {
  const f = await fixture(); const sale = await request(f, 'POST', '/api/sales', f.body);
  for (const route of [`/api/sales/${sale.data.sale.id}`, '/api/sales/purge-all', `/api/events/${f.event.id}`, `/api/users/${f.user.id}`, `/api/projects/${f.product.projectId}`]) {
    assert.equal((await request(f, 'DELETE', route)).status, 409);
  }
  assert.equal((await request(f, 'PUT', `/api/sales/${sale.data.sale.id}`, { quantity: 99 })).status, 409);
  assert.equal((await prisma.sale.findUnique({ where: { id: sale.data.sale.id } })).receiptNumber, sale.data.sale.receiptNumber);
});
test('Member cannot manage combos and cannot fetch warehouse stock through products', async () => {
  const f = await fixture(); const member = await prisma.user.create({ data: { name: 'Synthetic member', username: randomUUID(), passwordHash: 'synthetic', role: 'MEMBER' } });
  assert.equal((await request(f, 'POST', '/api/combos', { name: 'Unauthorized' }, member)).status, 403);
  const response = await request(f, 'GET', '/api/products', undefined, member);
  assert.equal(response.status, 200); assert(response.data.products.every(p => p.inventory === null));
});
test('Head financial projection hides split amounts and nested time-trend revenue', () => {
  const projected = source('middleware/responsePolicy.ts').projectResponse({ totalAmount: 100, cashAmount: 40, upiAmount: 60,
    timeTrend: [{ revenue: 100 }], user: { passwordHash: 'must-not-leak' } }, { revenue: false, pii: false, inventory: false, activity: false });
  assert.equal(projected.cashAmount, null); assert.equal(projected.upiAmount, null);
  assert.equal(projected.timeTrend[0].revenue, null); assert.equal(projected.user.passwordHash, undefined);
});
test('unauthenticated receipt dispatch is denied without messaging', async () => {
  const response = await fetch(base + '/api/whatsapp/send-receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: 'synthetic' }) });
  assert.equal(response.status, 401); assert.equal(messages, 0);
});

test('bulk intake rolls back every row when a later row is invalid', async () => {
  const f = await fixture({ stock: 10 });
  const r = await request(f, 'POST', '/api/inventory/bulk-intake', { items: [
    { productId: f.product.id, quantity: 5 }, { productId: 'missing-synthetic-product', quantity: 1 },
  ] });
  assert(r.status >= 400);
  assert.equal((await prisma.inventory.findUnique({ where: { productId: f.product.id } })).quantityOnHand, 10);
});
test('stale count adjustments cannot overwrite newer stock', async () => {
  const f = await fixture({ stock: 10 });
  const first = await request(f, 'PUT', `/api/inventory/${f.product.id}`, { expectedQuantityOnHand: 10, quantityOnHand: 12 });
  const stale = await request(f, 'PUT', `/api/inventory/${f.product.id}`, { expectedQuantityOnHand: 10, quantityOnHand: 11 });
  assert.equal(first.status, 200); assert.equal(stale.status, 409);
  assert.equal((await prisma.inventory.findUnique({ where: { productId: f.product.id } })).quantityOnHand, 12);
});
test('simultaneous game and ordinary sale share the last event unit', async () => {
  const f = await fixture({ allocated: 1 });
  const rs = await Promise.all([request(f, 'POST', '/api/sales', f.body), request(f, 'POST', '/api/games/play', {
    clientTxId: randomUUID(), eventId: f.event.id, gameId: f.game.id, result: 'WIN', paymentMethod: 'CASH',
  })]);
  assert.equal(rs.filter(r => r.status === 201).length, 1);
  assert.equal((await prisma.saleItem.aggregate({ where: { sale: { eventId: f.event.id } }, _sum: { quantity: true } }))._sum.quantity, 1);
});
test('event creation cannot overallocate the last warehouse unit concurrently', async () => {
  const f = await fixture({ stock: 1 });
  const body = { name: 'Synthetic event', location: 'Local', startDatetime: new Date(Date.now() - 60000).toISOString(),
    endDatetime: new Date(Date.now() + 3600000).toISOString(), allocations: [{ productId: f.product.id, allocatedQty: 1, priceAtEvent: 100 }] };
  const rs = await Promise.all([request(f, 'POST', '/api/events', body), request(f, 'POST', '/api/events', body)]);
  assert.equal(rs.filter(r => r.status === 201).length, 1);
  assert.equal((await prisma.inventory.findUnique({ where: { productId: f.product.id } })).quantityOnHand, 0);
});
test('new ownerless sync is preserved as a conflict rather than attributed to the current seller', async () => {
  const f = await fixture(); const legacy = { ...f.body }; delete legacy.ownerUserId;
  const r = await request(f, 'POST', '/api/sales/sync', { transactions: [legacy] });
  assert.equal(r.data.results[0].status, 'conflict');
  assert.equal(await prisma.sale.count({ where: { clientTxId: legacy.clientTxId } }), 0);
});
test('two members keep independent event context and backend rejects forged browser roles', async () => {
  const a = await fixture(), b = await fixture();
  await prisma.user.updateMany({ where: { id: { in: [a.user.id, b.user.id] } }, data: { role: 'MEMBER' } });
  const rs = await Promise.all([request(a, 'POST', '/api/sales', a.body), request(b, 'POST', '/api/sales', b.body)]);
  assert(rs.every(r => r.status === 201));
  for (const f of [a, b]) {
    const sale = await prisma.sale.findUnique({ where: { clientTxId: f.body.clientTxId } });
    assert.equal(sale.eventId, f.event.id); assert.equal(sale.sellerUserIdAtSale, f.user.id);
  }
  const forgedRole = jwt.sign({ id: a.user.id, role: 'DEVELOPER' }, secret, { expiresIn: '1h' });
  const denied = await fetch(base + '/api/users', { headers: { Authorization: `Bearer ${forgedRole}` } });
  assert.equal(denied.status, 403);
});
test('new sessions are invalidated by a password change without rewriting seller history', async () => {
  const f = await fixture();
  const credentialVersion = source('middleware/auth.ts').credentialVersion;
  const token = jwt.sign({ id: f.user.id, credentialVersion: credentialVersion(f.user.passwordHash) }, secret, { expiresIn: '1h' });
  await prisma.user.update({ where: { id: f.user.id }, data: { passwordHash: 'different-synthetic-hash' } });
  const response = await fetch(base + '/api/users', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 401);
});
test('IST date range includes the end of the selected business day', () => {
  const { businessDateRange, businessDay } = source('services/reportDates.ts');
  const range = businessDateRange('2026-10-29', '2026-10-29');
  assert.equal(range.gte.toISOString(), '2026-10-28T18:30:00.000Z');
  assert.equal(range.lt.toISOString(), '2026-10-29T18:30:00.000Z');
  assert.equal(businessDay(new Date('2026-10-28T19:00:00Z')), '2026-10-29');
});
test('event and analytics count a game fee once, even when no reward is issued', async () => {
  const f = await fixture();
  const r = await request(f, 'POST', '/api/games/play', { clientTxId: randomUUID(), eventId: f.event.id,
    gameId: f.game.id, result: 'LOSE', paymentMethod: 'CASH' });
  assert.equal(r.status, 201);
  const event = await request(f, 'GET', `/api/events/${f.event.id}`);
  assert.equal(event.data.event.summary.totalRevenue, 30);
  const analytics = await request(f, 'GET', `/api/analytics/dashboard?eventId=${f.event.id}`);
  assert.equal(analytics.data.overview.totalRevenue, 30);
  assert.equal(analytics.data.timeTrend.reduce((sum, row) => sum + row.revenue, 0), 30);
  assert.equal(analytics.data.stallPerformance[0].totalRevenue, 30);
});
test('project filter uses matching lines rather than the whole mixed-project receipt', async () => {
  const f = await fixture({ allocated: 10 }), other = await fixture();
  await prisma.eventAllocation.create({ data: { eventId: f.event.id, productId: other.product.id, allocatedQty: 10, priceAtEvent: 50 } });
  const r = await request(f, 'POST', '/api/sales', { ...f.body, totalAmount: 150,
    items: [{ productId: f.product.id, quantity: 1 }, { productId: other.product.id, quantity: 1 }] });
  assert.equal(r.status, 201);
  const analytics = await request(f, 'GET', `/api/analytics/dashboard?eventId=${f.event.id}&projectId=${f.product.projectId}`);
  assert.equal(analytics.data.overview.totalRevenue, 100); assert.equal(analytics.data.overview.totalUnitsSold, 1);
});

test('event-specific combo availability uses stall stock even when warehouse is empty', async () => {
  const f = await fixture({ stock: 0, allocated: 6 });
  const combo = await prisma.combo.create({ data: { name: 'Synthetic global bundle', price: 150,
    items: { create: [{ productId: f.product.id, quantity: 2 }] } } });
  const r = await request(f, 'GET', `/api/combos?eventId=${f.event.id}`);
  const row = r.data.combos.find(c => c.id === combo.id);
  assert.equal(row.availableStock, 3); assert.equal(row.isOutOfStock, false);
  const detail = await request(f, 'GET', `/api/combos/${combo.id}?eventId=${f.event.id}`);
  assert.equal(detail.data.combo.availableStock, 3);
});
test('PICK_ANY validates allowed items and calculates a pool instead of a minimum', async () => {
  const f = await fixture({ stock: 0, allocated: 4 }), other = await fixture();
  const combo = await prisma.combo.create({ data: { name: 'Synthetic pick pool', price: 150, comboType: 'PICK_ANY', minItems: 2,
    items: { create: [{ productId: f.product.id, quantity: 1 }, { productId: other.product.id, quantity: 1 }] } } });
  const response = await request(f, 'GET', `/api/combos?eventId=${f.event.id}`);
  assert.equal(response.data.combos.find(c => c.id === combo.id).availableStock, 2);
  const bad = await request(f, 'POST', '/api/sales/sync', { transactions: [{ ...f.body, comboId: combo.id,
    totalAmount: 150, items: [{ productId: other.product.id, quantity: 2 }] }] });
  assert.equal(bad.data.results.length, 1); assert.notEqual(bad.data.results[0].status, 'success');
});

test('socket authentication rejects anonymous clients and broadcasts only invalidation signals', async () => {
  const http = require('node:http');
  const { io: client } = require(path.resolve(__dirname, '../../frontend/node_modules/socket.io-client'));
  const sockets = source('sockets/index.ts'); const httpServer = http.createServer();
  const io = sockets.initSockets(httpServer);
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const anon = client(url, { reconnection: false, forceNew: true });
  let authenticated;
  try {
    const error = await new Promise((resolve, reject) => { anon.once('connect_error', resolve); anon.once('connect', () => reject(Error('Anonymous client connected'))); });
    assert.match(error.message, /session/i);
    const f = await fixture();
    authenticated = client(url, { reconnection: false, forceNew: true, auth: { token: jwt.sign({ id: f.user.id }, secret, { expiresIn: '1h' }) } });
    await new Promise((resolve, reject) => { authenticated.once('connect', resolve); authenticated.once('connect_error', reject); });
    const received = new Promise(resolve => authenticated.once('sale:created', resolve));
    sockets.broadcast('sale:created', { eventId: 'sensitive-event', totalAmount: 123, memberName: 'private-synthetic' });
    assert.deepEqual(await received, { action: 'refresh' });
  } finally { anon.disconnect(); authenticated?.disconnect(); await new Promise(resolve => io.close(resolve)); }
});
test('CORS advertises PATCH for the configured portal and denies an unrelated origin', () => {
  const { corsOptions } = source('config/http.ts');
  assert(corsOptions.methods.includes('PATCH'));
  corsOptions.origin('https://ims-ecru-three.vercel.app', (_error, allowed) => assert.equal(allowed, true));
  corsOptions.origin('https://synthetic-untrusted.example', (_error, allowed) => assert.equal(allowed, false));
});
