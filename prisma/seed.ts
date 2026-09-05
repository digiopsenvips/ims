import { PrismaClient, Role, EventStatus, PaymentMethod, SaleStatus, InventoryTransactionType, InventoryReferenceType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const permissionSeeds = [
  { key: 'dashboard.view', name: 'View Dashboard', category: 'Dashboard', description: 'Access the main dashboard.' },
  { key: 'dashboard.inventory', name: 'View Inventory Dashboard', category: 'Dashboard', description: 'View inventory-related dashboard stats.' },
  { key: 'dashboard.revenue', name: 'View Revenue Dashboard', category: 'Dashboard', description: 'View revenue KPIs.' },
  { key: 'dashboard.events', name: 'View Events Dashboard', category: 'Dashboard', description: 'View event metrics.' },
  { key: 'projects.view', name: 'View Projects', category: 'Projects', description: 'View projects.' },
  { key: 'projects.create', name: 'Create Projects', category: 'Projects', description: 'Create new projects.' },
  { key: 'projects.edit', name: 'Edit Projects', category: 'Projects', description: 'Edit project data.' },
  { key: 'projects.deactivate', name: 'Deactivate Projects', category: 'Projects', description: 'Deactivate projects.' },
  { key: 'products.view', name: 'View Products', category: 'Products', description: 'View products.' },
  { key: 'products.create', name: 'Create Products', category: 'Products', description: 'Create new products.' },
  { key: 'products.edit', name: 'Edit Products', category: 'Products', description: 'Edit product data.' },
  { key: 'products.deactivate', name: 'Deactivate Products', category: 'Products', description: 'Deactivate products.' },
  { key: 'inventory.view', name: 'View Inventory', category: 'Inventory', description: 'View inventory.' },
  { key: 'inventory.create', name: 'Create Inventory', category: 'Inventory', description: 'Create inventory records.' },
  { key: 'inventory.edit', name: 'Edit Inventory', category: 'Inventory', description: 'Edit inventory details.' },
  { key: 'inventory.adjust', name: 'Adjust Inventory', category: 'Inventory', description: 'Adjust inventory counts.' },
  { key: 'inventory.history.view', name: 'View Inventory History', category: 'Inventory', description: 'View historical inventory movement.' },
  { key: 'inventory.production.view', name: 'View Production Inventory', category: 'Inventory', description: 'View production data.' },
  { key: 'inventory.allocation.view', name: 'View Allocation Inventory', category: 'Inventory', description: 'View allocation data.' },
  { key: 'events.view', name: 'View Events', category: 'Events', description: 'View events.' },
  { key: 'events.create', name: 'Create Events', category: 'Events', description: 'Create events.' },
  { key: 'events.edit', name: 'Edit Events', category: 'Events', description: 'Edit event details.' },
  { key: 'events.start', name: 'Start Events', category: 'Events', description: 'Start events.' },
  { key: 'events.end', name: 'End Events', category: 'Events', description: 'Stop events.' },
  { key: 'events.cancel', name: 'Cancel Events', category: 'Events', description: 'Cancel events.' },
  { key: 'events.reconcile', name: 'Reconcile Events', category: 'Events', description: 'Reconcile event stock.' },
  { key: 'event_inventory.view', name: 'View Event Inventory', category: 'Event Inventory', description: 'View event inventory data.' },
  { key: 'event_inventory.create', name: 'Create Event Inventory', category: 'Event Inventory', description: 'Create event inventory assignments.' },
  { key: 'event_inventory.edit', name: 'Edit Event Inventory', category: 'Event Inventory', description: 'Edit event inventory.' },
  { key: 'event_pricing.view', name: 'View Event Pricing', category: 'Event Pricing', description: 'View event-specific pricing.' },
  { key: 'event_pricing.edit', name: 'Edit Event Pricing', category: 'Event Pricing', description: 'Edit event pricing.' },
  { key: 'sales.view', name: 'View Sales', category: 'Sales', description: 'View sales records.' },
  { key: 'sales.create', name: 'Create Sales', category: 'Sales', description: 'Create sales records.' },
  { key: 'sales.edit', name: 'Edit Sales', category: 'Sales', description: 'Edit sales records.' },
  { key: 'sales.cancel', name: 'Cancel Sales', category: 'Sales', description: 'Cancel sale records.' },
  { key: 'sales.export', name: 'Export Sales', category: 'Sales', description: 'Export sales data.' },
  { key: 'sales.customer_name.view', name: 'View Customer Name', category: 'Sales Fields', description: 'View customer names.' },
  { key: 'sales.customer_phone.view', name: 'View Customer Phone', category: 'Sales Fields', description: 'View customer phone numbers.' },
  { key: 'sales.member.view', name: 'View Member', category: 'Sales Fields', description: 'View member attribution.' },
  { key: 'sales.amount.view', name: 'View Sale Amount', category: 'Sales Fields', description: 'View sale amounts.' },
  { key: 'sales.payment_method.view', name: 'View Payment Method', category: 'Sales Fields', description: 'View payment method details.' },
  { key: 'analytics.view', name: 'View Analytics', category: 'Analytics', description: 'View analytics.' },
  { key: 'analytics.revenue.view', name: 'View Revenue Analytics', category: 'Analytics', description: 'View revenue analytics.' },
  { key: 'analytics.products.view', name: 'View Product Analytics', category: 'Analytics', description: 'View product analytics.' },
  { key: 'analytics.events.view', name: 'View Event Analytics', category: 'Analytics', description: 'View event analytics.' },
  { key: 'analytics.projects.view', name: 'View Project Analytics', category: 'Analytics', description: 'View project analytics.' },
  { key: 'analytics.members.view', name: 'View Member Analytics', category: 'Analytics', description: 'View member analytics.' },
  { key: 'users.view', name: 'View Users', category: 'Users', description: 'View users.' },
  { key: 'users.create', name: 'Create Users', category: 'Users', description: 'Create user accounts.' },
  { key: 'users.edit', name: 'Edit Users', category: 'Users', description: 'Edit user accounts.' },
  { key: 'users.deactivate', name: 'Deactivate Users', category: 'Users', description: 'Deactivate user accounts.' },
  { key: 'users.password_reset', name: 'Reset User Passwords', category: 'Users', description: 'Reset passwords.' },
  { key: 'permissions.view', name: 'View Permissions', category: 'Permissions', description: 'View permission set.' },
  { key: 'permissions.assign', name: 'Assign Permissions', category: 'Permissions', description: 'Assign or edit permissions.' },
  { key: 'audit.view', name: 'View Audit Logs', category: 'Audit', description: 'View system audit logs.' },
  { key: 'reports.export', name: 'Export Reports', category: 'Reports', description: 'Export operational reports.' }
];

const permissionMap = new Map<string, string>();

async function seed() {
  const now = new Date();

  for (const item of permissionSeeds) {
    const permission = await prisma.permission.upsert({
      where: { key: item.key },
      update: { name: item.name, description: item.description, category: item.category },
      create: { ...item, id: crypto.randomUUID() }
    });
    permissionMap.set(permission.key, permission.id);
  }

  const developer = await prisma.user.upsert({
    where: { username: 'developer' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      name: 'Developer User',
      username: 'developer',
      email: 'developer@enactus.local',
      passwordHash: await bcrypt.hash('Password123!', 10),
      role: Role.DEVELOPER,
      isActive: true,
      lastLoginAt: now,
    },
  });

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      name: 'Admin User',
      username: 'admin',
      email: 'admin@enactus.local',
      passwordHash: await bcrypt.hash('Password123!', 10),
      role: Role.ADMIN,
      isActive: true,
      lastLoginAt: now,
    },
  });

  const financeHead = await prisma.user.upsert({
    where: { username: 'finance-head' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      name: 'Finance Head',
      username: 'finance-head',
      email: 'finance-head@enactus.local',
      passwordHash: await bcrypt.hash('Password123!', 10),
      role: Role.HEAD,
      isActive: true,
      lastLoginAt: now,
    },
  });

  const marketingHead = await prisma.user.upsert({
    where: { username: 'marketing-head' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      name: 'Marketing Head',
      username: 'marketing-head',
      email: 'marketing-head@enactus.local',
      passwordHash: await bcrypt.hash('Password123!', 10),
      role: Role.HEAD,
      isActive: true,
      lastLoginAt: now,
    },
  });

  const productionHead = await prisma.user.upsert({
    where: { username: 'production-head' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      name: 'Production Head',
      username: 'production-head',
      email: 'production-head@enactus.local',
      passwordHash: await bcrypt.hash('Password123!', 10),
      role: Role.HEAD,
      isActive: true,
      lastLoginAt: now,
    },
  });

  const members = await Promise.all([
    prisma.user.upsert({
      where: { username: 'member-one' },
      update: {},
      create: {
        id: crypto.randomUUID(),
        name: 'Member One',
        username: 'member-one',
        email: 'member-one@enactus.local',
        passwordHash: await bcrypt.hash('Password123!', 10),
        role: Role.MEMBER,
        isActive: true,
        lastLoginAt: now,
      },
    }),
    prisma.user.upsert({
      where: { username: 'member-two' },
      update: {},
      create: {
        id: crypto.randomUUID(),
        name: 'Member Two',
        username: 'member-two',
        email: 'member-two@enactus.local',
        passwordHash: await bcrypt.hash('Password123!', 10),
        role: Role.MEMBER,
        isActive: true,
        lastLoginAt: now,
      },
    }),
    prisma.user.upsert({
      where: { username: 'member-three' },
      update: {},
      create: {
        id: crypto.randomUUID(),
        name: 'Member Three',
        username: 'member-three',
        email: 'member-three@enactus.local',
        passwordHash: await bcrypt.hash('Password123!', 10),
        role: Role.MEMBER,
        isActive: true,
        lastLoginAt: now,
      },
    }),
  ]);

  await Promise.all([
    // Developer permissions: Full system access
    ...permissionSeeds.map(perm =>
      prisma.userPermission.upsert({
        where: { userId_permissionId: { userId: developer.id, permissionId: permissionMap.get(perm.key)! } },
        update: {},
        create: { userId: developer.id, permissionId: permissionMap.get(perm.key)!, grantedBy: developer.id }
      })
    ),
    // Admin permissions: Full operational access (all except user/permission management)
    ...permissionSeeds.filter(perm => !perm.key.startsWith('users.') && !perm.key.startsWith('permissions.')).map(perm =>
      prisma.userPermission.upsert({
        where: { userId_permissionId: { userId: admin.id, permissionId: permissionMap.get(perm.key)! } },
        update: {},
        create: { userId: admin.id, permissionId: permissionMap.get(perm.key)!, grantedBy: developer.id }
      })
    ),
    // Finance Head permissions
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: financeHead.id, permissionId: permissionMap.get('dashboard.view')! } },
      update: {},
      create: { userId: financeHead.id, permissionId: permissionMap.get('dashboard.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: financeHead.id, permissionId: permissionMap.get('sales.view')! } },
      update: {},
      create: { userId: financeHead.id, permissionId: permissionMap.get('sales.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: financeHead.id, permissionId: permissionMap.get('sales.amount.view')! } },
      update: {},
      create: { userId: financeHead.id, permissionId: permissionMap.get('sales.amount.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: financeHead.id, permissionId: permissionMap.get('sales.member.view')! } },
      update: {},
      create: { userId: financeHead.id, permissionId: permissionMap.get('sales.member.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: financeHead.id, permissionId: permissionMap.get('analytics.revenue.view')! } },
      update: {},
      create: { userId: financeHead.id, permissionId: permissionMap.get('analytics.revenue.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: financeHead.id, permissionId: permissionMap.get('audit.view')! } },
      update: {},
      create: { userId: financeHead.id, permissionId: permissionMap.get('audit.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: financeHead.id, permissionId: permissionMap.get('reports.export')! } },
      update: {},
      create: { userId: financeHead.id, permissionId: permissionMap.get('reports.export')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: marketingHead.id, permissionId: permissionMap.get('dashboard.view')! } },
      update: {},
      create: { userId: marketingHead.id, permissionId: permissionMap.get('dashboard.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: marketingHead.id, permissionId: permissionMap.get('projects.view')! } },
      update: {},
      create: { userId: marketingHead.id, permissionId: permissionMap.get('projects.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: marketingHead.id, permissionId: permissionMap.get('products.view')! } },
      update: {},
      create: { userId: marketingHead.id, permissionId: permissionMap.get('products.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: marketingHead.id, permissionId: permissionMap.get('events.view')! } },
      update: {},
      create: { userId: marketingHead.id, permissionId: permissionMap.get('events.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: marketingHead.id, permissionId: permissionMap.get('analytics.products.view')! } },
      update: {},
      create: { userId: marketingHead.id, permissionId: permissionMap.get('analytics.products.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: marketingHead.id, permissionId: permissionMap.get('analytics.events.view')! } },
      update: {},
      create: { userId: marketingHead.id, permissionId: permissionMap.get('analytics.events.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: productionHead.id, permissionId: permissionMap.get('dashboard.view')! } },
      update: {},
      create: { userId: productionHead.id, permissionId: permissionMap.get('dashboard.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: productionHead.id, permissionId: permissionMap.get('products.view')! } },
      update: {},
      create: { userId: productionHead.id, permissionId: permissionMap.get('products.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: productionHead.id, permissionId: permissionMap.get('inventory.view')! } },
      update: {},
      create: { userId: productionHead.id, permissionId: permissionMap.get('inventory.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: productionHead.id, permissionId: permissionMap.get('inventory.history.view')! } },
      update: {},
      create: { userId: productionHead.id, permissionId: permissionMap.get('inventory.history.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: productionHead.id, permissionId: permissionMap.get('inventory.production.view')! } },
      update: {},
      create: { userId: productionHead.id, permissionId: permissionMap.get('inventory.production.view')!, grantedBy: developer.id }
    }),
    prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: productionHead.id, permissionId: permissionMap.get('analytics.products.view')! } },
      update: {},
      create: { userId: productionHead.id, permissionId: permissionMap.get('analytics.products.view')!, grantedBy: developer.id }
    }),
    ...members.flatMap((member) => [
      prisma.userPermission.upsert({
        where: { userId_permissionId: { userId: member.id, permissionId: permissionMap.get('dashboard.view')! } },
        update: {},
        create: { userId: member.id, permissionId: permissionMap.get('dashboard.view')!, grantedBy: developer.id }
      }),
      prisma.userPermission.upsert({
        where: { userId_permissionId: { userId: member.id, permissionId: permissionMap.get('sales.view')! } },
        update: {},
        create: { userId: member.id, permissionId: permissionMap.get('sales.view')!, grantedBy: developer.id }
      }),
      prisma.userPermission.upsert({
        where: { userId_permissionId: { userId: member.id, permissionId: permissionMap.get('sales.create')! } },
        update: {},
        create: { userId: member.id, permissionId: permissionMap.get('sales.create')!, grantedBy: developer.id }
      }),
      prisma.userPermission.upsert({
        where: { userId_permissionId: { userId: member.id, permissionId: permissionMap.get('sales.amount.view')! } },
        update: {},
        create: { userId: member.id, permissionId: permissionMap.get('sales.amount.view')!, grantedBy: developer.id }
      }),
    ])
  ]);

  const tahsin = await prisma.project.upsert({
    where: { code: 'TAH' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      name: 'Tahsin',
      code: 'TAH',
      description: 'Tahsin product stream.',
      isActive: true,
    },
  });

  const upcycle = await prisma.project.upsert({
    where: { code: 'UPC' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      name: 'Upcycle',
      code: 'UPC',
      description: 'Upcycle product stream.',
      isActive: true,
    },
  });

  const products = await Promise.all([
    prisma.product.upsert({
      where: { productCode: 'TAH-001' },
      update: {},
      create: { id: crypto.randomUUID(), productCode: 'TAH-001', name: 'Tote Bag', projectId: tahsin.id, isActive: true },
    }),
    prisma.product.upsert({
      where: { productCode: 'TAH-002' },
      update: {},
      create: { id: crypto.randomUUID(), productCode: 'TAH-002', name: 'Pouch', projectId: tahsin.id, isActive: true },
    }),
    prisma.product.upsert({
      where: { productCode: 'UPC-001' },
      update: {},
      create: { id: crypto.randomUUID(), productCode: 'UPC-001', name: 'Diary', projectId: upcycle.id, isActive: true },
    }),
    prisma.product.upsert({
      where: { productCode: 'UPC-002' },
      update: {},
      create: { id: crypto.randomUUID(), productCode: 'UPC-002', name: 'Notebook', projectId: upcycle.id, isActive: true },
    }),
  ]);

  const tenure = await prisma.tenure.create({
    data: {
      id: crypto.randomUUID(),
      name: 'Current Academic Tenure',
      startDate: new Date('2025-08-01T00:00:00.000Z'),
      endDate: new Date('2026-06-30T00:00:00.000Z'),
      isActive: true,
    },
  });

  const event1 = await prisma.event.upsert({
    where: { eventCode: 'DU-FEST-001' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      eventCode: 'DU-FEST-001',
      tenureId: tenure.id,
      name: 'DU Fest',
      location: 'VIPS Campus',
      startDate: new Date('2026-03-15T00:00:00.000Z'),
      endDate: new Date('2026-03-15T00:00:00.000Z'),
      startTime: '10:00',
      endTime: '17:00',
      status: EventStatus.ACTIVE,
      notes: 'Active event for product sales.',
      createdBy: admin.id,
    },
  });

  await prisma.event.upsert({
    where: { eventCode: 'UPC-MARKET-001' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      eventCode: 'UPC-MARKET-001',
      tenureId: tenure.id,
      name: 'Upcycle Market',
      location: 'Main Stall',
      startDate: new Date('2026-04-10T00:00:00.000Z'),
      endDate: new Date('2026-04-10T00:00:00.000Z'),
      startTime: '11:00',
      endTime: '18:00',
      status: EventStatus.SCHEDULED,
      notes: 'Planned monthly stall event.',
      createdBy: admin.id,
    },
  });

  await prisma.eventProduct.upsert({
    where: { eventId_productId: { eventId: event1.id, productId: products[0].id } },
    update: {},
    create: { eventId: event1.id, productId: products[0].id, allocatedQuantity: 20, eventPrice: 250.00 },
  });

  await prisma.eventProduct.upsert({
    where: { eventId_productId: { eventId: event1.id, productId: products[2].id } },
    update: {},
    create: { eventId: event1.id, productId: products[2].id, allocatedQuantity: 15, eventPrice: 200.00 },
  });

  for (const product of products) {
    await prisma.inventoryTransaction.create({
      data: {
        productId: product.id,
        transactionType: InventoryTransactionType.INITIAL_PRODUCTION,
        quantity: product.name === 'Tote Bag' ? 120 : product.name === 'Pouch' ? 80 : product.name === 'Diary' ? 90 : 60,
        referenceType: InventoryReferenceType.PRODUCT,
        referenceId: product.id,
        notes: 'Initial production stock.',
        createdBy: admin.id,
      },
    });
  }

  const eventSale = await prisma.sale.create({
    data: {
      id: crypto.randomUUID(),
      transactionCode: 'INV-1001',
      clientTransactionId: 'offline-1001',
      eventId: event1.id,
      memberId: members[0].id,
      tenureId: tenure.id,
      customerName: 'Test Customer',
      customerPhone: '9999999999',
      paymentMethod: PaymentMethod.UPI,
      totalAmount: 500.00,
      saleTime: new Date(),
      status: SaleStatus.COMPLETED,
      saleItems: {
        create: [
          { productId: products[0].id, quantity: 2, unitPrice: 250.00, lineTotal: 500.00 },
        ],
      },
    },
  });

  await prisma.inventoryTransaction.create({
    data: {
      productId: products[0].id,
      eventId: event1.id,
      transactionType: InventoryTransactionType.SALE,
      quantity: 2,
      referenceType: InventoryReferenceType.SALE,
      referenceId: eventSale.id,
      notes: 'Sale recorded for Test Customer.',
      createdBy: members[0].id,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: 'SEED_INITIAL_DATA',
      entityType: 'SYSTEM',
      entityId: 'seed',
      previousData: { count: 0 },
      newData: { count: 1 },
      metadata: { source: 'seed' },
    },
  });

  console.log('Seed data created successfully.');
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
