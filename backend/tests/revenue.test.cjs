const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calculateEventRevenue } = require('../dist/services/revenue.js');

describe('calculateEventRevenue', () => {
  it('correctly calculates DCAC Stall ledger (₹510 products + ₹420 games = ₹930 total)', () => {
    // 5 Product sales totalling ₹510
    const productSales = [
      { id: 291, receiptNumber: 421, transactionType: 'SALE', status: 'COMPLETED', totalAmount: '50.00' },
      { id: 295, receiptNumber: 425, transactionType: 'SALE', status: 'COMPLETED', totalAmount: '120.00' },
      { id: 296, receiptNumber: 426, transactionType: 'SALE', status: 'COMPLETED', totalAmount: '70.00' },
      { id: 297, receiptNumber: 427, transactionType: 'SALE', status: 'COMPLETED', totalAmount: '100.00' },
      { id: 299, receiptNumber: 429, transactionType: 'SALE', status: 'COMPLETED', totalAmount: '170.00' },
    ];

    // 14 Game sales of ₹30 each totalling ₹420
    const gameSales = Array.from({ length: 14 }, (_, idx) => ({
      id: 281 + idx,
      receiptNumber: 411 + idx,
      transactionType: 'GAME',
      status: 'COMPLETED',
      totalAmount: '30.00',
    }));

    // Matching 14 game sessions
    const gameSessions = Array.from({ length: 14 }, (_, idx) => ({
      id: `gs-${idx}`,
      entryFee: '30.00',
      status: 'COMPLETED',
    }));

    const result = calculateEventRevenue([...productSales, ...gameSales], gameSessions);

    assert.equal(result.totalRevenue, 930);
    assert.equal(result.productRevenue, 510);
    assert.equal(result.gameRevenue, 420);
    assert.equal(result.totalTransactions, 19);
    assert.equal(result.productSalesCount, 5);
    assert.equal(result.gameSalesCount, 14);
  });

  it('excludes cancelled / voided sales from revenue', () => {
    const sales = [
      { id: 1, transactionType: 'SALE', status: 'COMPLETED', totalAmount: '100.00' },
      { id: 2, transactionType: 'SALE', status: 'CANCELLED', totalAmount: '50.00' },
      { id: 3, transactionType: 'GAME', status: 'COMPLETED', totalAmount: '30.00' },
      { id: 4, transactionType: 'GAME', status: 'CANCELLED', totalAmount: '30.00' },
    ];

    const result = calculateEventRevenue(sales);
    assert.equal(result.totalRevenue, 130);
    assert.equal(result.productRevenue, 100);
    assert.equal(result.gameRevenue, 30);
    assert.equal(result.totalTransactions, 2);
    assert.equal(result.productSalesCount, 1);
    assert.equal(result.gameSalesCount, 1);
  });

  it('handles product-only events without games (e.g. Nexus Select City Walk)', () => {
    const sales = [
      { id: 10, transactionType: 'SALE', status: 'COMPLETED', totalAmount: '32179.00' },
      { id: 11, transactionType: 'COMBO', status: 'COMPLETED', totalAmount: '9105.00' },
    ];

    const result = calculateEventRevenue(sales, []);
    assert.equal(result.totalRevenue, 41284);
    assert.equal(result.productRevenue, 41284);
    assert.equal(result.gameRevenue, 0);
    assert.equal(result.totalTransactions, 2);
    assert.equal(result.productSalesCount, 2);
    assert.equal(result.gameSalesCount, 0);
  });

  it('never double counts game fees when both game sales and game sessions exist', () => {
    const sales = [
      { id: 101, transactionType: 'GAME', status: 'COMPLETED', totalAmount: '30.00' },
    ];
    const sessions = [
      { id: 'gs-1', entryFee: '30.00', status: 'COMPLETED' },
    ];

    const result = calculateEventRevenue(sales, sessions);
    // MUST NOT be 60
    assert.equal(result.totalRevenue, 30);
    assert.equal(result.gameRevenue, 30);
    assert.equal(result.productRevenue, 0);
  });

  it('handles decimal precision without floating point inaccuracies', () => {
    const sales = [
      { id: 1, transactionType: 'SALE', status: 'COMPLETED', totalAmount: 0.1 },
      { id: 2, transactionType: 'SALE', status: 'COMPLETED', totalAmount: 0.2 },
    ];

    const result = calculateEventRevenue(sales);
    assert.equal(result.totalRevenue, 0.3);
    assert.equal(result.productRevenue, 0.3);
  });
});
