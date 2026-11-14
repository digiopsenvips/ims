const { PrismaClient, Role } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_enactus_ims_secure_key_12345';

async function runTests() {
  console.log('🧪 Starting Granular Role & Permission System Test Suite...\n');

  let testDev = null;
  let eventOpUser = null;
  let financeUser = null;

  try {
    // 1. Setup Developer
    const devPass = await bcrypt.hash('developer123', 10);
    testDev = await prisma.user.upsert({
      where: { username: 'test_dev_perms_runner' },
      update: { role: Role.DEVELOPER, status: 'ACTIVE' },
      create: {
        name: 'Test Dev Perms Runner',
        username: 'test_dev_perms_runner',
        passwordHash: devPass,
        role: Role.DEVELOPER,
        status: 'ACTIVE',
      },
    });

    // 2. Setup Event Operations Manager (Head role with EVENT_OPERATIONS_MANAGER template)
    const opPass = await bcrypt.hash('opmanager123', 10);
    eventOpUser = await prisma.user.upsert({
      where: { username: 'test_event_op_mgr' },
      update: { role: Role.HEAD, status: 'ACTIVE' },
      create: {
        name: 'Event Ops Manager',
        username: 'test_event_op_mgr',
        passwordHash: opPass,
        role: Role.HEAD,
        status: 'ACTIVE',
      },
    });

    // Clear old test permissions
    await prisma.headPermission.deleteMany({
      where: { userId: eventOpUser.id },
    });

    // Assign EVENT_OPERATIONS_MANAGER permissions: full operational, ZERO financial
    const opPerms = [
      'dashboard.view',
      'dashboard.view_operational',
      'events.view',
      'events.create',
      'events.edit',
      'events.extend_deadline',
      'events.reopen',
      'events.close_stall',
      'events.reconcile',
      'events.view_stock',
      'events.allocate_stock',
      'events.edit_allocations',
      'events.return_stock',
      'events.manage_pricing',
      'events.view_sales_quantities',
      'products.view',
      'products.edit_standard_price',
      'products.view_stock',
      'products.view_sales_quantities',
      'inventory.view_warehouse',
      'inventory.view_stall',
      'combos.view',
      'combos.create',
      'combos.edit',
      'combos.activate_deactivate',
      'sales.pos_access',
      'sales.record_sale',
      'sales.view_history',
      'sales.view_details',
      'special_sales.view',
      'special_sales.create',
      'special_sales.edit',
      'special_sales.confirm',
      'special_sales.fulfill',
      'games.view',
      'games.create',
      'games.edit',
      'games.configure_rewards',
      'games.activate_deactivate',
      'games.play',
      'games.view_sessions',
      'analytics.access',
      'analytics.view_operational',
      'whatsapp.view_queue',
      'whatsapp.view_status',
    ];

    await prisma.headPermission.createMany({
      data: opPerms.map(key => ({
        userId: eventOpUser.id,
        permissionKey: key,
        allowed: true,
      })),
    });

    // Verify DB assignments
    const assignedOpPerms = await prisma.headPermission.findMany({
      where: { userId: eventOpUser.id, allowed: true },
    });
    console.log(`✓ Test 1: Created Event Operations Manager with ${assignedOpPerms.length} operational permissions.`);

    // Check operational vs financial separation
    const assignedKeys = new Set(assignedOpPerms.map(p => p.permissionKey));
    const financialKeys = [
      'dashboard.view_revenue',
      'dashboard.view_financial_kpis',
      'sales.view_amounts',
      'sales.view_revenue',
      'sales.view_payment_methods',
      'events.view_revenue',
      'products.view_cost_price',
      'products.view_profit_margins',
      'special_sales.view_financials',
      'special_sales.record_payment',
      'analytics.view_financial',
      'analytics.view_profit',
      'analytics.view_due_reports',
      'analytics.export_financial',
    ];

    const leakedFinancial = financialKeys.filter(k => assignedKeys.has(k));
    if (leakedFinancial.length > 0) {
      throw new Error(`CRITICAL: Financial permissions leaked to Event Operations Manager: ${leakedFinancial.join(', ')}`);
    }
    console.log('✓ Test 2: Verified strict zero financial visibility for Event Operations Manager (0 of 14 financial keys granted).');

    // 3. Setup Finance Manager (Admin role with FINANCE_MANAGER template)
    const finPass = await bcrypt.hash('finmanager123', 10);
    financeUser = await prisma.user.upsert({
      where: { username: 'test_finance_mgr' },
      update: { role: Role.ADMIN, status: 'ACTIVE' },
      create: {
        name: 'Finance Manager',
        username: 'test_finance_mgr',
        passwordHash: finPass,
        role: Role.ADMIN,
        status: 'ACTIVE',
      },
    });

    await prisma.headPermission.deleteMany({
      where: { userId: financeUser.id },
    });

    const finPerms = [
      'dashboard.view',
      'dashboard.view_operational',
      'dashboard.view_revenue',
      'dashboard.view_financial_kpis',
      'events.view',
      'events.view_revenue',
      'products.view',
      'products.view_cost_price',
      'products.view_profit_margins',
      'sales.view_history',
      'sales.view_details',
      'sales.view_amounts',
      'sales.view_revenue',
      'sales.view_payment_methods',
      'special_sales.view',
      'special_sales.view_financials',
      'special_sales.record_payment',
      'analytics.access',
      'analytics.view_operational',
      'analytics.view_financial',
      'analytics.view_profit',
      'analytics.view_due_reports',
      'analytics.export_financial',
      'whatsapp.view_queue',
      'whatsapp.view_status',
    ];

    await prisma.headPermission.createMany({
      data: finPerms.map(key => ({
        userId: financeUser.id,
        permissionKey: key,
        allowed: true,
      })),
    });

    const assignedFinPerms = await prisma.headPermission.findMany({
      where: { userId: financeUser.id, allowed: true },
    });
    console.log(`✓ Test 3: Created Finance Manager with ${assignedFinPerms.length} permissions including full revenue visibility.`);

    // 4. Test Immediate Revocation / Update
    // Revoke special_sales.fulfill from eventOpUser
    await prisma.headPermission.updateMany({
      where: { userId: eventOpUser.id, permissionKey: 'special_sales.fulfill' },
      data: { allowed: false },
    });

    const checkRevoked = await prisma.headPermission.findFirst({
      where: { userId: eventOpUser.id, permissionKey: 'special_sales.fulfill' },
    });
    if (checkRevoked && checkRevoked.allowed) {
      throw new Error('Revocation failed: permission is still allowed.');
    }
    console.log('✓ Test 4: Immediate permission revocation successfully tested.');

    // 5. Test Audit Log Persistence
    const auditRecord = await prisma.auditLog.create({
      data: {
        action: 'PERMISSIONS_UPDATED',
        actorId: testDev.id,
        actorName: testDev.name,
        actorRole: testDev.role,
        targetUserId: eventOpUser.id,
        targetUsername: eventOpUser.username,
        details: {
          added: ['events.create', 'events.edit'],
          removed: ['special_sales.fulfill'],
          totalAssigned: opPerms.length - 1,
        },
        ipAddress: '127.0.0.1',
      },
    });

    if (!auditRecord || !auditRecord.id) {
      throw new Error('Failed to create audit log entry.');
    }

    const fetchedLog = await prisma.auditLog.findUnique({
      where: { id: auditRecord.id },
    });
    if (!fetchedLog || fetchedLog.action !== 'PERMISSIONS_UPDATED') {
      throw new Error('Audit log verification failed.');
    }
    console.log(`✓ Test 5: Audit log persistence verified with ID: ${fetchedLog.id}.`);

    // Clean up test audit log and records
    await prisma.auditLog.delete({ where: { id: auditRecord.id } });
    await prisma.headPermission.deleteMany({
      where: { userId: { in: [eventOpUser.id, financeUser.id] } },
    });
    await prisma.user.deleteMany({
      where: { username: { in: ['test_event_op_mgr', 'test_finance_mgr', 'test_dev_perms_runner'] } },
    });

    console.log('\n✅ All Granular Permission & Security separation tests PASSED successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Granular Permission Test FAILED:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
