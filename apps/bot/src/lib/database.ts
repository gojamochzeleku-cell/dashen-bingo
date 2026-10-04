import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function getOrCreateUser(telegramId: number, username: string, firstName: string) {
  const client = await pool.connect();
  try {
    const userResult = await client.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [telegramId]
    );

    let userId: number;

    if (userResult.rows.length === 0) {
      const newUser = await client.query(
        'INSERT INTO users (telegram_id, username, first_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [telegramId, username, firstName, 'PLAYER']
      );
      userId = newUser.rows[0].id;

      await client.query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, $2)',
        [userId, 0]
      );
      console.log(`✅ Created new user: ${username} (ID: ${userId})`);
    } else {
      userId = userResult.rows[0].id;
    }

    return userId;
  } finally {
    client.release();
  }
}

// ✅ FIX: Convert PostgreSQL NUMERIC string to a Number
export async function getUserBalance(userId: number): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [userId]
    );
    // Parse the string to a float, default to 0 if undefined
    return parseFloat(result.rows[0]?.balance) || 0;
  } finally {
    client.release();
  }
}

export async function addFunds(userId: number, amount: number, description: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const walletResult = await client.query(
      'SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (walletResult.rows.length === 0) {
      throw new Error('Wallet not found');
    }

    const walletId = walletResult.rows[0].id;

    await client.query(
      'UPDATE wallets SET balance = balance + $1 WHERE id = $2',
      [amount, walletId]
    );

    await client.query(
      'INSERT INTO wallet_ledger (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
      [walletId, amount, 'DEPOSIT', description]
    );

    await client.query('COMMIT');
    console.log(`✅ Added ${amount} ETB to user ${userId}: ${description}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default pool;
