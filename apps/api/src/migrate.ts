import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('🔧 Migrating REAL database (Neon)...');

  await pool.query(`CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    telegram_id BIGINT NOT NULL,
    type VARCHAR(20) NOT NULL,
    method VARCHAR(20),
    amount NUMERIC(12,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    reference VARCHAR(100) UNIQUE,
    sms_sender VARCHAR(100),
    sms_raw TEXT,
    admin_notes TEXT,
    payout_account VARCHAR(100),
    payout_name VARCHAR(200),
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    processed_by BIGINT
  )`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_txn_created ON transactions(created_at)`);

  // Safety: ensure onboarding columns exist too
  await pool.query(`ALTER TABLE users
    ADD COLUMN IF NOT EXISTS joined_channel BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS shared_contact BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50)`);

  console.log('✅ Migration complete on the REAL database!');
  await pool.end();
}

run().catch(e => { console.error('❌ Migration failed:', e.message); process.exit(1); });
