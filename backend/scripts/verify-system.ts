const BASE_URL = 'http://localhost:5001/api';

async function req(path: string, options: any = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

async function runTests() {
  console.log('🧪 Starting End-to-End System Verification...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`, detail || '');
      failed++;
    }
  }

  try {
    // 1. Health check
    console.log('--- 1. Health Check ---');
    const health = await req('/health');
    assert(health.status === 200 && health.data.status === 'ok', 'API Health Check returns 200 OK');

    // 2. Auth Tests
    console.log('\n--- 2. Authentication & RBAC ---');
    const devLogin = await req('/auth/login', {
      method: 'POST',
      body: { username: 'developer', password: 'Admin@123' },
    });
    assert(devLogin.status === 200 && !!devLogin.data.token, 'Developer login succeeds and returns JWT');
    const devToken = devLogin.data.token;

    const adminLogin = await req('/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'Admin@123' },
    });
    assert(adminLogin.status === 200 && adminLogin.data.user.role === 'ADMIN', 'Admin login succeeds');
    const adminToken = adminLogin.data.token;

    const prodHeadLogin = await req('/auth/login', {
      method: 'POST',
      body: { username: 'head_production', password: 'Head@123' },
    });
    assert(prodHeadLogin.status === 200 && prodHeadLogin.data.user.role === 'HEAD', 'Production Head login succeeds');
    const prodHeadToken = prodHeadLogin.data.token;

    const memberLogin = await req('/auth/login', {
      method: 'POST',
      body: { username: 'aarav_sharma', password: 'Member@123' },
    });
    assert(memberLogin.status === 200 && memberLogin.data.user.role === 'MEMBER', 'Member login succeeds');
    const memberToken = memberLogin.data.token;

    const badLogin = await req('/auth/login', {
      method: 'POST',
      body: { username: 'developer', password: 'WrongPassword' },
    });
    assert(badLogin.status === 401, 'Invalid credentials rejected with 401');

    // Admin restricted from creating users
    const adminCreateUser = await req('/users', {
      method: 'POST',
      token: adminToken,
      body: { name: 'Test', username: 'test_user', password: 'Password@123', role: 'MEMBER' },
    });
    assert(adminCreateUser.status === 403, 'Admin blocked from creating new accounts (403)');

    // 3. Projects & Auto-Generated Product IDs
    console.log('\n--- 3. Projects & Auto-Generated Product IDs ---');
    const createPrj = await req('/projects', {
      method: 'POST',
      token: devToken,
      body: { name: 'Clay Works' },
    });
    assert(createPrj.status === 201 && createPrj.data.project.code === 'CLA', 'Project created with derived 3-letter code CLA');
    const projectId = createPrj.data.project.id;

    // Create product under project -> verify auto-assigned ID format
    const createProd1 = await req(`/projects/${projectId}/products`, {
      method: 'POST',
      token: devToken,
      body: { name: 'Terracotta Bottle', basePrice: 299 },
    });
    assert(
      createProd1.status === 201 && createProd1.data.product.id === 'CLA-001',
      `Product 1 gets system auto-generated ID CLA-001 (got ${createProd1.data?.product?.id})`
    );

    const createProd2 = await req(`/projects/${projectId}/products`, {
      method: 'POST',
      token: devToken,
      body: { name: 'Glazed Mug', basePrice: 199 },
    });
    assert(
      createProd2.status === 201 && createProd2.data.product.id === 'CLA-002',
      `Product 2 gets system auto-generated ID CLA-002 (got ${createProd2.data?.product?.id})`
    );

    // 4. Bulk Stock Intake
    console.log('\n--- 4. Bulk Inventory Intake & Live Stock ---');
    const bulkIntake = await req('/inventory/bulk-intake', {
      method: 'POST',
      token: devToken,
      body: {
        items: [
          { productId: 'CLA-001', quantity: 50, notes: 'First furnace batch' },
          { productId: 'CLA-002', quantity: 40, notes: 'Mug batch 1' },
        ],
      },
    });
    assert(bulkIntake.status === 200, 'Bulk inventory intake processed successfully');

    const invCheck = await req('/inventory', { token: devToken });
    const cla1 = invCheck.data.inventory.find((i: any) => i.productId === 'CLA-001');
    assert(cla1 && cla1.quantityOnHand === 50, 'Live stock on hand updated to 50 for CLA-001');

    // 5. Events with Inline Allocation & Pricing
    console.log('\n--- 5. Events with Inline Allocation & Pricing ---');
    const now = new Date();
    const end = new Date(Date.now() + 86400000);

    const createEvent = await req('/events', {
      method: 'POST',
      token: devToken,
      body: {
        name: 'Spring Mela Test 2026',
        location: 'North Campus Lawn',
        startDatetime: now.toISOString(),
        endDatetime: end.toISOString(),
        status: 'ACTIVE',
        allocations: [
          { productId: 'CLA-001', allocatedQty: 20, priceAtEvent: 280 },
          { productId: 'CLA-002', allocatedQty: 15, priceAtEvent: 185 },
        ],
      },
    });
    assert(createEvent.status === 201, 'Event created with inline product allocations and event prices');
    const eventId = createEvent.data.event.id;

    // Verify main inventory decreased by allocated quantity
    const invAfterAlloc = await req('/inventory', { token: devToken });
    const cla1AfterAlloc = invAfterAlloc.data.inventory.find((i: any) => i.productId === 'CLA-001');
    assert(
      cla1AfterAlloc.quantityOnHand === 30,
      `Main stock decremented from 50 to 30 after allocating 20 to event (got ${cla1AfterAlloc?.quantityOnHand})`
    );

    // 6. Sales Recording & Remaining Allocation Enforcement
    console.log('\n--- 6. Sales Recording & Allocation Integrity ---');
    // Try to record sale exceeding remaining allocated quantity (25 > 20) -> should fail 400
    const overSale = await req('/sales', {
      method: 'POST',
      token: memberToken,
      body: {
        eventId,
        productId: 'CLA-001',
        quantity: 25,
        paymentMethod: 'UPI',
      },
    });
    assert(overSale.status === 400, 'Sale exceeding allocated stock blocked with status 400');

    // Record valid sale of 3 units
    const validSale = await req('/sales', {
      method: 'POST',
      token: memberToken,
      body: {
        eventId,
        productId: 'CLA-001',
        quantity: 3,
        paymentMethod: 'UPI',
        customerName: 'Aman Deep',
        customerPhone: '9988776655',
      },
    });
    assert(validSale.status === 201, 'Valid sale recorded by Member');
    assert(Number(validSale.data.sale.totalAmount) === 840, `Sale total amount is 3 * 280 = 840 (got ${validSale.data?.sale?.totalAmount})`);

    // 7. Offline PWA Sync with Idempotency
    console.log('\n--- 7. Offline PWA Sync & Idempotency ---');
    const clientUuid = 'test-client-uuid-' + Date.now();
    const offlineBatch = {
      sales: [
        {
          clientTxId: clientUuid,
          eventId,
          productId: 'CLA-002',
          quantity: 2,
          paymentMethod: 'CASH',
          customerName: 'Offline Buyer',
          saleTime: new Date().toISOString(),
        },
      ],
    };

    // First submission
    const sync1 = await req('/sales/sync', {
      method: 'POST',
      token: memberToken,
      body: offlineBatch,
    });
    assert(sync1.status === 200 && sync1.data.syncedCount === 1, 'Offline queued sale synced successfully');

    // Second submission with SAME clientTxId -> must be idempotent!
    const sync2 = await req('/sales/sync', {
      method: 'POST',
      token: memberToken,
      body: offlineBatch,
    });
    assert(
      sync2.status === 200 && sync2.data.results[0].status === 'already_synced',
      'Sync retry is idempotent: recognized duplicate clientTxId and did not double-record'
    );

    // 8. "End Event" Action - Returning Unsold Stock to Main Inventory
    console.log('\n--- 8. End Event Action (Unsold Stock Recovery) ---');
    // CLA-001 had 20 allocated, 3 sold -> 17 unsold
    // CLA-002 had 15 allocated, 2 sold -> 13 unsold
    const endRes = await req(`/events/${eventId}/end`, {
      method: 'POST',
      token: devToken,
    });
    assert(endRes.status === 200, 'End Event action executed successfully');

    const invAfterEnd = await req('/inventory', { token: devToken });
    const cla1Final = invAfterEnd.data.inventory.find((i: any) => i.productId === 'CLA-001');
    assert(
      cla1Final.quantityOnHand === 47,
      `Unsold stock returned: CLA-001 main inventory restored to 47 (30 + 17) (got ${cla1Final?.quantityOnHand})`
    );

    // 9. Granular Head Permissions & Sanitization
    console.log('\n--- 9. Head Granular Permissions & Sanitization ---');
    // Production Head has view_revenue: false -> sales totalAmount should be sanitized/null
    const prodHeadSales = await req('/sales', { token: prodHeadToken });
    assert(
      prodHeadSales.status === 200 && prodHeadSales.data.sales[0].totalAmount === null,
      'Production Head without view_revenue sees totalAmount sanitized to null'
    );

    // Finance Head has view_customer_pii: false -> customer name should be "Confidential"
    const finHeadLogin = await req('/auth/login', {
      method: 'POST',
      body: { username: 'head_finance', password: 'Head@123' },
    });
    const finSales = await req('/sales', { token: finHeadLogin.data.token });
    assert(
      finSales.status === 200 && finSales.data.sales[0].customerName === 'Confidential',
      'Finance Head without view_customer_pii sees customer name masked as Confidential'
    );

    // Developer can update Head permissions checklist
    const updatePerms = await req(`/users/${prodHeadLogin.data.user.id}/permissions`, {
      method: 'PUT',
      token: devToken,
      body: {
        permissions: {
          view_inventory: true,
          view_revenue: true, // grant revenue access
        },
      },
    });
    assert(updatePerms.status === 200 && updatePerms.data.permissions.view_revenue === true, 'Developer successfully updated Head permission checklist');

    // 10. Analytics
    console.log('\n--- 10. Analytics ---');
    const analytics = await req('/analytics/dashboard', { token: devToken });
    assert(analytics.status === 200 && analytics.data.overview.totalSalesRecords > 0, 'Analytics overview returns aggregates');
    assert(Array.isArray(analytics.data.productShare), 'Analytics provides product share distribution');
    assert(Array.isArray(analytics.data.stallPerformance), 'Analytics provides per-stall performance');

    console.log(`\n========================================`);
    console.log(`🎉 VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Test run encountered unexpected error:', error);
    process.exit(1);
  }
}

runTests();
