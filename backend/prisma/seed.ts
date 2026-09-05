import { PrismaClient, Role, EventStatus, PaymentMethod } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ALL_HEAD_PERMISSIONS = [
  'view_inventory',
  'view_revenue',
  'view_customer_pii',
  'view_analytics',
  'view_event_breakdown',
  'edit_inventory',
  'edit_events',
  'export_data'
];

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Clean existing records in reverse dependency order
  await prisma.sale.deleteMany();
  await prisma.eventAllocation.deleteMany();
  await prisma.event.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.product.deleteMany();
  await prisma.project.deleteMany();
  await prisma.headPermission.deleteMany();
  await prisma.user.deleteMany();

  console.log('🧹 Cleaned existing tables');

  // 2. Hash passwords
  const devPassword = await bcrypt.hash('Admin@123', 10);
  const headPassword = await bcrypt.hash('Head@123', 10);
  const memberPassword = await bcrypt.hash('Member@123', 10);

  // 3. Create Users
  // Developer
  const developer = await prisma.user.create({
    data: {
      name: 'System Developer',
      username: 'developer',
      email: 'developer@enactus-vips.org',
      passwordHash: devPassword,
      role: Role.DEVELOPER,
    }
  });

  // Admin
  const admin = await prisma.user.create({
    data: {
      name: 'Executive Admin',
      username: 'admin',
      email: 'admin@enactus-vips.org',
      passwordHash: devPassword,
      role: Role.ADMIN,
    }
  });

  // Finance Head
  const headFinance = await prisma.user.create({
    data: {
      name: 'Rohan Mehta (Finance Head)',
      username: 'head_finance',
      email: 'finance@enactus-vips.org',
      passwordHash: headPassword,
      role: Role.HEAD,
    }
  });

  // Marketing Head
  const headMarketing = await prisma.user.create({
    data: {
      name: 'Ananya Roy (Marketing Head)',
      username: 'head_marketing',
      email: 'marketing@enactus-vips.org',
      passwordHash: headPassword,
      role: Role.HEAD,
    }
  });

  // Production Head
  const headProduction = await prisma.user.create({
    data: {
      name: 'Kabir Singhal (Production Head)',
      username: 'head_production',
      email: 'production@enactus-vips.org',
      passwordHash: headPassword,
      role: Role.HEAD,
    }
  });

  // Members
  const memberAarav = await prisma.user.create({
    data: {
      name: 'Aarav Sharma',
      username: 'aarav_sharma',
      email: 'aarav@enactus-vips.org',
      passwordHash: memberPassword,
      role: Role.MEMBER,
    }
  });

  const memberDiya = await prisma.user.create({
    data: {
      name: 'Diya Verma',
      username: 'diya_verma',
      email: 'diya@enactus-vips.org',
      passwordHash: memberPassword,
      role: Role.MEMBER,
    }
  });

  console.log('👤 Created Users: Developer, Admin, 3 Heads, 2 Members');

  // 4. Assign Head Permissions
  const financePermissions = [
    { key: 'view_inventory', allowed: true },
    { key: 'view_revenue', allowed: true },
    { key: 'view_customer_pii', allowed: false },
    { key: 'view_analytics', allowed: true },
    { key: 'view_event_breakdown', allowed: true },
    { key: 'edit_inventory', allowed: false },
    { key: 'edit_events', allowed: false },
    { key: 'export_data', allowed: true }
  ];

  const marketingPermissions = [
    { key: 'view_inventory', allowed: true },
    { key: 'view_revenue', allowed: true },
    { key: 'view_customer_pii', allowed: false },
    { key: 'view_analytics', allowed: true },
    { key: 'view_event_breakdown', allowed: true },
    { key: 'edit_inventory', allowed: false },
    { key: 'edit_events', allowed: true },
    { key: 'export_data', allowed: false }
  ];

  const productionPermissions = [
    { key: 'view_inventory', allowed: true },
    { key: 'view_revenue', allowed: false },
    { key: 'view_customer_pii', allowed: false },
    { key: 'view_analytics', allowed: false },
    { key: 'view_event_breakdown', allowed: false },
    { key: 'edit_inventory', allowed: true },
    { key: 'edit_events', allowed: false },
    { key: 'export_data', allowed: false }
  ];

  for (const p of financePermissions) {
    await prisma.headPermission.create({
      data: { userId: headFinance.id, permissionKey: p.key, allowed: p.allowed }
    });
  }

  for (const p of marketingPermissions) {
    await prisma.headPermission.create({
      data: { userId: headMarketing.id, permissionKey: p.key, allowed: p.allowed }
    });
  }

  for (const p of productionPermissions) {
    await prisma.headPermission.create({
      data: { userId: headProduction.id, permissionKey: p.key, allowed: p.allowed }
    });
  }

  console.log('🔒 Assigned granular permissions to Heads');

  // 5. Create Projects
  const projectTahsin = await prisma.project.create({
    data: {
      name: 'Tahsin',
      code: 'TAH'
    }
  });

  const projectUpcycle = await prisma.project.create({
    data: {
      name: 'Upcycle',
      code: 'UPC'
    }
  });

  console.log('📦 Created Projects: Tahsin & Upcycle');

  // 6. Create Products with auto-assigned IDs
  const tah1 = await prisma.product.create({
    data: {
      id: 'TAH-001',
      name: 'Tahsin Handcrafted Scented Candle',
      projectId: projectTahsin.id,
      basePrice: 250.00
    }
  });

  const tah2 = await prisma.product.create({
    data: {
      id: 'TAH-002',
      name: 'Tahsin Organic Clay Diya Set',
      projectId: projectTahsin.id,
      basePrice: 180.00
    }
  });

  const tah3 = await prisma.product.create({
    data: {
      id: 'TAH-003',
      name: 'Tahsin Herbal Fragrance Pouch',
      projectId: projectTahsin.id,
      basePrice: 120.00
    }
  });

  const upc1 = await prisma.product.create({
    data: {
      id: 'UPC-001',
      name: 'Upcycle Denim Tote Bag',
      projectId: projectUpcycle.id,
      basePrice: 350.00
    }
  });

  const upc2 = await prisma.product.create({
    data: {
      id: 'UPC-002',
      name: 'Upcycle Fabric Journal Notebook',
      projectId: projectUpcycle.id,
      basePrice: 220.00
    }
  });

  const upc3 = await prisma.product.create({
    data: {
      id: 'UPC-003',
      name: 'Upcycle Bottle Desk Planter',
      projectId: projectUpcycle.id,
      basePrice: 150.00
    }
  });

  console.log('🏷️ Created 6 Products with auto IDs (TAH-001..3, UPC-001..3)');

  // 7. Initial Inventory
  const initialStock = [
    { productId: tah1.id, qty: 60, notes: 'Batch 1 fresh craft' },
    { productId: tah2.id, qty: 50, notes: 'Diwali production run' },
    { productId: tah3.id, qty: 80, notes: 'Lavender & sandalwood' },
    { productId: upc1.id, qty: 45, notes: 'Stitched from reclaimed jeans' },
    { productId: upc2.id, qty: 55, notes: 'Hardbound handmade paper' },
    { productId: upc3.id, qty: 40, notes: 'Polished recycled glass' },
  ];

  for (const item of initialStock) {
    await prisma.inventory.create({
      data: {
        productId: item.productId,
        quantityOnHand: item.qty,
        notes: item.notes
      }
    });
  }

  console.log('📊 Seeded initial Inventory counts');

  // 8. Create a sample Active Event
  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 2);

  const sampleEvent = await prisma.event.create({
    data: {
      name: 'VIPS Annual Diwali Mela 2026',
      location: 'VIPS Main Lawn, Pitampura, New Delhi',
      startDatetime: now,
      endDatetime: tomorrow,
      status: EventStatus.ACTIVE,
    }
  });

  // Event Allocations with event-specific pricing
  const allocations = [
    { productId: tah1.id, allocatedQty: 25, priceAtEvent: 240.00 },
    { productId: tah2.id, allocatedQty: 20, priceAtEvent: 170.00 },
    { productId: tah3.id, allocatedQty: 30, priceAtEvent: 110.00 },
    { productId: upc1.id, allocatedQty: 15, priceAtEvent: 330.00 },
    { productId: upc2.id, allocatedQty: 20, priceAtEvent: 200.00 },
    { productId: upc3.id, allocatedQty: 15, priceAtEvent: 140.00 },
  ];

  for (const alloc of allocations) {
    await prisma.eventAllocation.create({
      data: {
        eventId: sampleEvent.id,
        productId: alloc.productId,
        allocatedQty: alloc.allocatedQty,
        priceAtEvent: alloc.priceAtEvent
      }
    });

    // Main inventory decreases by the allocated amount
    await prisma.inventory.update({
      where: { productId: alloc.productId },
      data: {
        quantityOnHand: { decrement: alloc.allocatedQty }
      }
    });
  }

  console.log('🎪 Created Sample Active Event with Allocations & Event Pricing');

  // 9. Sample Sales
  await prisma.sale.create({
    data: {
      eventId: sampleEvent.id,
      productId: tah1.id,
      memberId: memberAarav.id,
      quantity: 2,
      unitPrice: 240.00,
      totalAmount: 480.00,
      paymentMethod: PaymentMethod.UPI,
      customerName: 'Priya Sharma',
      customerPhone: '9876543210',
      saleTime: new Date(Date.now() - 3600 * 1000 * 2)
    }
  });

  await prisma.sale.create({
    data: {
      eventId: sampleEvent.id,
      productId: upc1.id,
      memberId: memberDiya.id,
      quantity: 1,
      unitPrice: 330.00,
      totalAmount: 330.00,
      paymentMethod: PaymentMethod.CASH,
      customerName: 'Rahul Verma',
      customerPhone: '9811223344',
      saleTime: new Date(Date.now() - 3600 * 1000)
    }
  });

  console.log('💰 Seeded sample completed sales');
  console.log('✅ Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
