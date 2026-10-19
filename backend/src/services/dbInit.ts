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

    console.log('✅ [Database] PostgreSQL sequences and WhatsApp session tables initialized.');
  } catch (err) {
    console.error('❌ [Database] Sequence initialization failed:', err);
  }
}
