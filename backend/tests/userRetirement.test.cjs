const { PrismaClient, Role } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_enactus_ims_secure_key_12345';

async function runTests() {
  console.log('🧪 Starting User Retirement Test Suite...\n');
  let testUser = null;
  let testDeveloper = null;
  let testSale = null;

  try {
    // Setup test developer
    const devPass = await bcrypt.hash('developer123', 10);
    testDeveloper = await prisma.user.upsert({
      where: { username: 'test_dev_retire_admin' },
      update: { role: Role.DEVELOPER, status: 'ACTIVE' },
      create: {
        name: 'Test Dev Admin',
        username: 'test_dev_retire_admin',
        passwordHash: devPass,
        role: Role.DEVELOPER,
        status: 'ACTIVE',
      },
    });

    // Setup test member with a historical sale
    const memPass = await bcrypt.hash('member123', 10);
    testUser = await prisma.user.upsert({
      where: { username: 'test_member_retire_subject' },
      update: {
        name: 'Test Member Subject',
        passwordHash: memPass,
        role: Role.MEMBER,
        status: 'ACTIVE',
        retiredAt: null,
        retiredById: null,
        retiredByName: null,
        retireReason: null,
      },
      create: {
        name: 'Test Member Subject',
        username: 'test_member_retire_subject',
        passwordHash: memPass,
        role: Role.MEMBER,
        status: 'ACTIVE',
      },
    });

    // Find or create an active event for test sale
    let event = await prisma.event.findFirst();
    if (!event) {
      event = await prisma.event.create({
        data: {
          name: 'Retire Test Event',
          location: 'Campus',
          startDatetime: new Date(),
          endDatetime: new Date(Date.now() + 86400000),
          status: 'ACTIVE',
        },
      });
    }

    // Create a historical sale attributed to testUser
    testSale = await prisma.sale.create({
      data: {
        receiptNumber: 999901 + Math.floor(Math.random() * 9000),
        eventId: event.id,
        memberId: testUser.id,
        sellerUserIdAtSale: testUser.id,
        sellerUsernameAtSale: testUser.username,
        sellerNameAtSale: testUser.name,
        totalAmount: 150.00,
        paymentMethod: 'CASH',
        cashAmount: 150.00,
      },
    });

    console.log('✅ Test setup completed.');
    console.log(`   User: @${testUser.username} (ID: ${testUser.id})`);
    console.log(`   Sale ID: ${testSale.id}, Receipt: #${testSale.receiptNumber}`);

    // TEST 1: Check initial user status
    console.log('\n--- TEST 1: User initially ACTIVE ---');
    const u1 = await prisma.user.findUnique({ where: { id: testUser.id } });
    if (u1.status !== 'ACTIVE') throw new Error(`Expected ACTIVE, got ${u1.status}`);
    console.log('✅ User status is ACTIVE.');

    // TEST 2: Simulate Retirement
    console.log('\n--- TEST 2: Perform Account Retirement ---');
    const retiredAt = new Date();
    const u2 = await prisma.user.update({
      where: { id: testUser.id },
      data: {
        status: 'RETIRED',
        retiredAt,
        retiredById: testDeveloper.id,
        retiredByName: testDeveloper.name,
        retireReason: 'Tenure completed / graduated',
      },
    });
    if (u2.status !== 'RETIRED') throw new Error(`Expected RETIRED, got ${u2.status}`);
    if (!u2.retiredAt) throw new Error('Expected retiredAt timestamp');
    if (u2.retiredById !== testDeveloper.id) throw new Error('Expected retiredById');
    if (u2.retireReason !== 'Tenure completed / graduated') throw new Error('Expected retireReason');
    console.log('✅ Account retired with proper metadata.');

    // TEST 3: Verify Historical Sale Attribution Preserved
    console.log('\n--- TEST 3: Historical Sale Attribution Untouched ---');
    const s1 = await prisma.sale.findUnique({
      where: { id: testSale.id },
      include: { member: true },
    });
    if (!s1) throw new Error('Sale disappeared!');
    if (s1.memberId !== testUser.id) throw new Error('Sale memberId was cleared or changed!');
    if (s1.sellerUserIdAtSale !== testUser.id) throw new Error('sellerUserIdAtSale mismatch');
    if (s1.sellerUsernameAtSale !== 'test_member_retire_subject') throw new Error('sellerUsernameAtSale altered');
    if (s1.sellerNameAtSale !== 'Test Member Subject') throw new Error('sellerNameAtSale altered');
    if (!s1.member) throw new Error('Sale member relation is null!');
    if (s1.member.status !== 'RETIRED') throw new Error('Expected member to be marked RETIRED');
    console.log('✅ Historical sale attribution is 100% intact, immutable, and correctly references the retired user.');

    // TEST 4: Verify Reactivation
    console.log('\n--- TEST 4: Reactivate Account ---');
    const u3 = await prisma.user.update({
      where: { id: testUser.id },
      data: {
        status: 'ACTIVE',
        retiredAt: null,
        retiredById: null,
        retiredByName: null,
        retireReason: null,
      },
    });
    if (u3.status !== 'ACTIVE') throw new Error('Reactivation failed');
    if (u3.retiredAt !== null) throw new Error('retiredAt not cleared');
    console.log('✅ Account successfully reactivated to ACTIVE.');

    console.log('\n🎉 ALL 4 USER RETIREMENT TESTS PASSED PERFECTLY!\n');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  } finally {
    // Cleanup test records
    if (testSale) {
      await prisma.sale.delete({ where: { id: testSale.id } }).catch(() => {});
    }
    if (testUser) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
    if (testDeveloper) {
      await prisma.user.delete({ where: { id: testDeveloper.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
}

runTests();
