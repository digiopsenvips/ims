import { prisma } from '../config/prisma';

/**
 * Initializes and synchronizes database sequences on server startup.
 * Ensures sequences match or exceed the maximum ID in tables to prevent
 * primary key unique constraint violations after database migrations or restores.
 */
export async function initializeDatabaseSequences(): Promise<void> {
  try {
    // 1. Ensure receipt_number_seq exists and is synchronized
    await prisma.$executeRawUnsafe(`
      CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START WITH 1;
    `);

    // 2. Ensure game_session_code_seq exists
    await prisma.$executeRawUnsafe(`
      CREATE SEQUENCE IF NOT EXISTS game_session_code_seq START WITH 1;
    `);

    // 3. Synchronize sales_id_seq with MAX(id) in sales
    await prisma.$executeRawUnsafe(`
      SELECT setval(
        'sales_id_seq',
        GREATEST(COALESCE((SELECT MAX(id) FROM sales), 0), 1)
      );
    `);

    // 4. Synchronize sale_items_id_seq with MAX(id) in sale_items
    await prisma.$executeRawUnsafe(`
      SELECT setval(
        'sale_items_id_seq',
        GREATEST(COALESCE((SELECT MAX(id) FROM sale_items), 0), 1)
      );
    `);

    // 5. Synchronize receipt_number_seq with MAX(receipt_number) in sales
    await prisma.$executeRawUnsafe(`
      SELECT setval(
        'receipt_number_seq',
        GREATEST(
          COALESCE((SELECT MAX(receipt_number) FROM sales), 0),
          COALESCE((SELECT last_value FROM receipt_number_seq), 1)
        )
      );
    `);

    // 6. Ensure whatsapp_sessions table exists in Supabase for Render deployments
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // 7. Ensure Special Sales sequence and tables exist
    await prisma.$executeRawUnsafe(`
      CREATE SEQUENCE IF NOT EXISTS special_sale_order_seq START WITH 1001;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS special_sales (
        id TEXT PRIMARY KEY,
        reference TEXT UNIQUE NOT NULL,
        order_number INTEGER UNIQUE NOT NULL,
        customer_name TEXT NOT NULL,
        customer_category TEXT NOT NULL,
        contact_person TEXT,
        phone TEXT,
        email TEXT,
        billing_address TEXT,
        department TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        payment_status TEXT NOT NULL DEFAULT 'UNPAID',
        payment_method TEXT,
        subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        discount_percentage NUMERIC(5, 2),
        discount_reason TEXT,
        additional_charges NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        charges_reason TEXT,
        total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        balance_due NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        total_units INTEGER NOT NULL DEFAULT 0,
        total_items INTEGER NOT NULL DEFAULT 0,
        created_by_id TEXT,
        created_by_name TEXT,
        last_modified_by_id TEXT,
        last_modified_by_name TEXT,
        confirmed_at TIMESTAMP,
        confirmed_by_id TEXT,
        confirmed_by_name TEXT,
        fulfilled_at TIMESTAMP,
        fulfilled_by_id TEXT,
        fulfilled_by_name TEXT,
        cancelled_at TIMESTAMP,
        cancelled_by_id TEXT,
        cancelled_by_name TEXT,
        cancel_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS special_sale_items (
        id TEXT PRIMARY KEY,
        special_sale_id TEXT NOT NULL REFERENCES special_sales(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL,
        standard_price NUMERIC(10, 2) NOT NULL,
        special_price NUMERIC(10, 2) NOT NULL,
        is_price_overridden BOOLEAN NOT NULL DEFAULT false,
        override_reason TEXT,
        discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        line_total NUMERIC(10, 2) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS special_sale_payments (
        id TEXT PRIMARY KEY,
        special_sale_id TEXT NOT NULL REFERENCES special_sales(id) ON DELETE CASCADE,
        payment_method TEXT NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        cash_amount NUMERIC(10, 2),
        upi_amount NUMERIC(10, 2),
        reference TEXT,
        notes TEXT,
        recorded_by_id TEXT,
        recorded_by_name TEXT,
        paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Safely add special_sale_id to whatsapp_deliveries
    await prisma.$executeRawUnsafe(`
      ALTER TABLE whatsapp_deliveries 
      ADD COLUMN IF NOT EXISTS special_sale_id TEXT REFERENCES special_sales(id) ON DELETE SET NULL;
    `);

    // Safely add combo support columns to special_sale_items
    await prisma.$executeRawUnsafe(`ALTER TABLE special_sale_items ALTER COLUMN product_id DROP NOT NULL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE special_sale_items ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'PRODUCT';`);
    await prisma.$executeRawUnsafe(`ALTER TABLE special_sale_items ADD COLUMN IF NOT EXISTS combo_id TEXT REFERENCES combos(id) ON DELETE SET NULL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE special_sale_items ADD COLUMN IF NOT EXISTS combo_name TEXT;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE special_sale_items ADD COLUMN IF NOT EXISTS components JSONB;`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_special_sale_items_combo_id ON special_sale_items(combo_id);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_special_sale_items_item_type ON special_sale_items(item_type);`);

    // Create indexes for fast query performance individually
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_special_sales_status ON special_sales(status);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_special_sales_payment_status ON special_sales(payment_status);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_special_sales_customer_category ON special_sales(customer_category);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_special_sales_created_at ON special_sales(created_at);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_special_sales_reference ON special_sales(reference);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_special_sale_items_sale_id ON special_sale_items(special_sale_id);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_special_sale_items_product_id ON special_sale_items(product_id);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_special_sale_payments_sale_id ON special_sale_payments(special_sale_id);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_whatsapp_deliveries_special_sale ON whatsapp_deliveries(special_sale_id);`);

    // Safely add user status and retirement metadata columns to users
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserStatus') THEN
          CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'RETIRED', 'SUSPENDED');
        END IF;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "retired_at" TIMESTAMP(3);`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "retired_by_id" TEXT;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "retired_by_name" TEXT;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "retire_reason" TEXT;`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_users_status" ON "users"("status");`);

    console.log('✅ [Database] PostgreSQL sequences, WhatsApp session, Special Sales tables, and User retirement schema initialized.');
  } catch (err) {
    console.error('❌ [Database] Sequence initialization failed:', err);
  }
}
