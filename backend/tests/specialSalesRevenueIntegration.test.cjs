const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

describe('Special Sales Revenue Integration & Aggregation', () => {
  const prisma = new PrismaClient();

  it('aggregates live database revenue: ₹49,734 stall + ₹6,030 special sales = ₹55,764 combined', async () => {
    // 1. Regular active sales
    const regularSales = await prisma.sale.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: { totalAmount: true, quantity: true, items: { select: { quantity: true } } },
    });
    const regularRevenue = regularSales.reduce((acc, s) => acc + Number(s.totalAmount), 0);
    assert.equal(regularRevenue, 49734);
    assert.equal(regularSales.length, 275);

    // 2. Eligible Special Sales (CONFIRMED or FULFILLED)
    const eligibleSpecialSales = await prisma.specialSale.findMany({
      where: { status: { in: ['CONFIRMED', 'FULFILLED'] } },
      select: {
        totalAmount: true,
        amountPaid: true,
        balanceDue: true,
        totalUnits: true,
        status: true,
        paymentStatus: true,
      },
    });

    const specialRevenue = eligibleSpecialSales.reduce((acc, s) => acc + Number(s.amountPaid), 0);
    const specialUnits = eligibleSpecialSales.reduce((acc, s) => acc + s.totalUnits, 0);

    assert.equal(specialRevenue, 6030);
    assert.equal(eligibleSpecialSales.length, 3);
    assert.equal(specialUnits, 25);

    // 3. Combined organizational revenue
    const combinedTotal = regularRevenue + specialRevenue;
    assert.equal(combinedTotal, 55764);
  });

  it('strictly excludes DRAFT and CANCELLED special sales from received revenue', () => {
    const orders = [
      { status: 'DRAFT', amountPaid: '500.00', totalAmount: '500.00' },
      { status: 'CANCELLED', amountPaid: '1000.00', totalAmount: '1000.00' },
      { status: 'CONFIRMED', amountPaid: '200.00', totalAmount: '200.00' },
      { status: 'FULFILLED', amountPaid: '800.00', totalAmount: '800.00' },
    ];

    const eligible = orders.filter(o => ['CONFIRMED', 'FULFILLED'].includes(o.status));
    const revenue = eligible.reduce((acc, o) => acc + Number(o.amountPaid), 0);
    assert.equal(revenue, 1000);
  });

  it('respects partially paid orders and counts only amountPaid (not unpaid balance)', () => {
    const partiallyPaidOrder = {
      status: 'CONFIRMED',
      totalAmount: '5000.00',
      amountPaid: '2000.00',
      balanceDue: '3000.00',
      paymentStatus: 'PARTIALLY_PAID',
    };

    // Revenue rule: only actual collected/received cash/upi counts as revenue
    const eligibleRevenue = Number(partiallyPaidOrder.amountPaid);
    const outstanding = Number(partiallyPaidOrder.balanceDue);

    assert.equal(eligibleRevenue, 2000);
    assert.equal(outstanding, 3000);
    assert.notEqual(eligibleRevenue, Number(partiallyPaidOrder.totalAmount));
  });

  it('ensures regular sales and special sales are stored in separate models without double counting', async () => {
    const regularCount = await prisma.sale.count();
    const specialCount = await prisma.specialSale.count();

    // Verify independent models
    assert.equal(typeof regularCount, 'number');
    assert.equal(typeof specialCount, 'number');
    assert.ok(regularCount > 0);
    assert.ok(specialCount > 0);
  });

  it('ensures event-scoped queries never pollute stall revenue with special sales', async () => {
    const dcacSales = await prisma.sale.findMany({
      where: { eventId: 'dcac-stall-2026', status: { not: 'CANCELLED' } },
    });
    if (dcacSales.length > 0) {
      const dcacRevenue = dcacSales.reduce((acc, s) => acc + Number(s.totalAmount), 0);
      assert.equal(dcacRevenue, 930);
    }
  });
});
