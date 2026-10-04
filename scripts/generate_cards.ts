import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function generateValidCard(): (number | null)[][] {
  const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
  const columns: number[][] = [];

  // Generate 5 columns
  for (let col = 0; col < 5; col++) {
    const [min, max] = ranges[col];
    const nums: number[] = [];
    while (nums.length < 5) {
      const n = Math.floor(Math.random() * (max - min + 1)) + min;
      if (!nums.includes(n)) nums.push(n);
    }
    columns.push(nums.sort((a, b) => a - b));
  }

  // Transpose columns into rows for easier frontend rendering
  const rows: (number | null)[][] = [];
  for (let r = 0; r < 5; r++) {
    const row: (number | null)[] = [];
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 2) {
        row.push(null); // FREE space in the center
      } else {
        row.push(columns[c][r]);
      }
    }
    rows.push(row);
  }
  return rows;
}

async function main() {
  console.log('🔄 Connecting to Neon database...');
  const client = await pool.connect();

  try {
    console.log('🔄 Starting transaction to generate 400 cards...');
    await client.query('BEGIN');

    let successCount = 0;

    for (let i = 1; i <= 400; i++) {
      const cardData = generateValidCard();
      
      // Use ON CONFLICT to make this script safe to run multiple times
      const result = await client.query(
        `INSERT INTO bingo_cards (grid_number, card_data, is_active) 
         VALUES ($1, $2, true) 
         ON CONFLICT (grid_number) DO NOTHING 
         RETURNING id`,
        [i, JSON.stringify(cardData)]
      );

      if (result.rows.length > 0) {
        successCount++;
      }
      
      // Print progress every 50 cards
      if (i % 50 === 0) {
        console.log(`   ⏳ Progress: ${i}/400 cards processed...`);
      }
    }

    await client.query('COMMIT');
    console.log(`\n🎉 SUCCESS! Generated/Verified ${successCount} new unique Bingo cards.`);
    
    // Verify total count
    const countResult = await client.query('SELECT COUNT(*) FROM bingo_cards');
    console.log(`📊 Total cards currently in database: ${countResult.rows[0].count}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ FAILED to generate cards:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
