const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('../node_modules/typescript');
const { randomUUID } = require('node:crypto');
function environment(network) {
  const records = new Map(), events = new Map(), calls = [], storage = new Map([
    ['enactus_ims_user', JSON.stringify({ id: 'seller-A' })], ['enactus_ims_token', 'synthetic-token'],
  ]);
  const clone = value => value === undefined ? undefined : structuredClone(value);
  function store(map) { return {
    get: async id => clone(map.get(id)),
    add: async value => { if (map.has(value.clientTxId)) throw Error('Duplicate'); map.set(value.clientTxId, clone(value)); calls.push('durable-add'); },
    put: async value => { map.set(value.clientTxId || value.id, clone(value)); },
  }; }
  const db = {
    get: async (table, id) => clone((table === 'offline_sales' ? records : events).get(id)),
    getAll: async table => [...(table === 'offline_sales' ? records : events).values()].map(clone),
    transaction(table) { return { store: store(table === 'offline_sales' ? records : events), done: Promise.resolve() }; },
  };
  class ApiError extends Error { constructor(status) { super('synthetic'); this.status = status; } }
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename); if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, Map, Set, Date, Error, Number, JSON,
      crypto: { randomUUID }, navigator: { onLine: true }, window: { addEventListener() {} }, setInterval() {},
      localStorage: { getItem: k => storage.get(k) || null }, console,
      require(name) {
        if (name === 'idb') return { openDB: async () => db };
        if (name === './api') return { ApiError, api: { post: async (route, body) => { calls.push('network'); return network(route, body, { records, calls, ApiError }); } } };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'));
        throw Error('Unapproved import ' + name);
      },
    }, { filename });
    return module.exports;
  }
  return { records, events, calls, storage, manager: load(path.resolve(__dirname, '../../frontend/src/lib/sync.ts')).syncManager,
    db: load(path.resolve(__dirname, '../../frontend/src/lib/db.ts')) };
}
const order = { eventId: 'synthetic-event', paymentMethod: 'CASH', saleTime: '2026-10-29T12:00:00Z', items: [
  { productId: 'synthetic-product', productName: 'Synthetic', quantity: 1, unitPrice: 100, totalAmount: 100 },
] };
test('online operations are durable before transmission and retained after commit', async () => {
  const e = environment(async (_route, body) => ({ results: [{ clientTxId: body.transactions[0].clientTxId, status: 'success', saleId: 1, receiptNumber: 4 }] }));
  const result = await e.manager.recordOrder(order);
  assert.equal(e.calls[0], 'durable-add'); assert.equal(e.calls[1], 'network');
  assert.equal(result.syncedImmediately, true); assert.equal(e.records.size, 1);
  assert.equal(e.records.get(result.orderId).syncStatus, 'committed');
  assert.equal(e.records.get(result.orderId).ownerUserId, 'seller-A');
});
test('lost response keeps the operation key and resolves through the same key', async () => {
  let attempts = 0; const keys = [];
  const e = environment(async (_route, body) => {
    const key = body.transactions[0].clientTxId; keys.push(key);
    if (++attempts === 1) throw new Error('Synthetic response lost after commit');
    return { results: [{ clientTxId: key, status: 'already_synced', saleId: 1, receiptNumber: 4 }] };
  });
  const result = await e.manager.recordOrder(order); assert.equal(result.syncedImmediately, false);
  assert.equal(e.records.get(result.orderId).syncStatus, 'pending');
  await e.manager.triggerSync(); assert.equal(new Set(keys).size, 1);
  assert.equal(e.records.get(result.orderId).syncStatus, 'committed');
});
test('legacy ownerless operations are preserved in conflict without transmission', async () => {
  const e = environment(async () => { throw Error('Must not transmit'); });
  e.records.set('legacy-key', { clientTxId: 'legacy-key', eventId: 'legacy-event', syncStatus: 'pending', queuedAt: 1 });
  await e.manager.triggerSync(); assert.equal(e.calls.includes('network'), false);
  assert.equal(e.records.get('legacy-key').syncStatus, 'conflict');
});
test('switching sellers does not replay or reassign another seller queue', async () => {
  const e = environment(async () => { throw Error('Must not transmit'); });
  e.records.set('seller-A-key', { clientTxId: 'seller-A-key', ownerUserId: 'seller-A', eventId: 'synthetic-event', syncStatus: 'pending', queuedAt: 1 });
  e.storage.set('enactus_ims_user', JSON.stringify({ id: 'seller-B' }));
  await e.manager.triggerSync(); assert.equal(e.calls.includes('network'), false);
  assert.equal(e.records.get('seller-A-key').ownerUserId, 'seller-A');
  assert.equal(e.records.get('seller-A-key').syncStatus, 'pending');
});
test('contradictory server results preserve a conflict rather than dropping the queue', async () => {
  const e = environment(async (_route, body) => ({ results: [
    { clientTxId: body.transactions[0].clientTxId, status: 'failed' },
    { clientTxId: body.transactions[0].clientTxId, status: 'success', saleId: 1, receiptNumber: 4 },
  ] }));
  await assert.rejects(e.manager.recordOrder(order), /Ambiguous/);
  assert.equal(e.records.size, 1); assert.equal([...e.records.values()][0].syncStatus, 'conflict');
});
test('failed/discard APIs cannot erase payloads or acknowledged receipts', async () => {
  const e = environment(async () => ({}));
  const sale = { clientTxId: 'preserved', eventId: 'event', syncStatus: 'failed', queuedAt: 1, customerName: 'Synthetic' };
  await e.db.queueOfflineSale(sale); await e.db.deleteOfflineSale(sale.clientTxId);
  await assert.rejects(e.db.clearFailedOfflineSales(), /preserved/);
  assert.equal(e.records.get(sale.clientTxId).customerName, 'Synthetic');
  await e.db.acknowledgeOfflineSale(sale.clientTxId, { saleId: 1, receiptNumber: 4 });
  await e.db.deleteOfflineSale(sale.clientTxId);
  assert.equal(e.records.get(sale.clientTxId).syncStatus, 'committed');
  await assert.rejects(e.db.acknowledgeOfflineSale(sale.clientTxId, { saleId: 2, receiptNumber: 5 }), /Conflicting/);
  assert.equal(e.records.get(sale.clientTxId).acknowledgement.receiptNumber, 4);
});
test('game queue retains its acknowledgement and retries an uncertain play with one key', async () => {
  let attempts = 0; const keys = [];
  const e = environment(async (route, body) => { assert.equal(route, '/games/play'); keys.push(body.clientTxId);
    if (++attempts === 1) throw Error('Synthetic dropped response');
    return { saleId: 2, receipt: { receiptNumber: 5, sessionCode: 'synthetic-session' } };
  });
  const result = await e.manager.recordGame({ eventId: 'event', gameId: 'game', result: 'WIN', paymentMethod: 'CASH', saleTime: order.saleTime });
  await e.manager.triggerSync(); assert.equal(new Set(keys).size, 1);
  assert.equal(e.records.get(result.orderId).acknowledgement.receipt.sessionCode, 'synthetic-session');
});

test('stock projection keeps unconfirmed quantities across reload without increasing recorded sales', () => {
  const filename = path.resolve(__dirname, '../../frontend/src/lib/offline-stock.ts');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
  const result = module.exports.withUnconfirmedStock([{ id: 'event', allocations: [{ productId: 'product', remainingQty: 5, soldQty: 1 }] }], [
    { eventId: 'event', syncStatus: 'pending', items: [{ productId: 'product', quantity: 2 }] },
    { eventId: 'other-event', syncStatus: 'pending', items: [{ productId: 'product', quantity: 5 }] },
  ]);
  assert.equal(result[0].allocations[0].remainingQty, 3); assert.equal(result[0].allocations[0].soldQty, 1);
  assert.equal(result[0].allocations[0].pendingQty, 2);
});
test('an explicit unavailable event is retained instead of redirecting to another event', () => {
  const filename = path.resolve(__dirname, '../../frontend/src/lib/event-context.ts'), module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, Date });
  assert.equal(module.exports.selectedEventId([{ id: 'other-active-event', status: 'ACTIVE' }], 'chosen-event'), 'chosen-event');
});
test('maintenance guard refuses operational or remote databases before invoking a database tool', () => {
  const { assertDisposableDatabase } = require('../scripts/guard-disposable-db.cjs');
  assert.throws(() => assertDisposableDatabase({ DATABASE_URL: 'postgresql://synthetic@remote.example/operational' }), /disabled/);
  assert.throws(() => assertDisposableDatabase({ IMS_ALLOW_DISPOSABLE_DATABASE: '1', DATABASE_URL: 'postgresql://synthetic@remote.example/operational' }), /Refusing/);
  assertDisposableDatabase({ IMS_ALLOW_DISPOSABLE_DATABASE: '1', DATABASE_URL: 'postgresql://ims_test@127.0.0.1:55439/ims_synthetic_test' });
});
