import cors from "cors";
import express from 'express';
import { createTransactionsRouter } from "./transactions";
import { createAdminRouter } from "./adminRoutes";
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { GameEngine } from './gameEngine';
import { pool } from './lib/database';

dotenv.config();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

const PORT = process.env.PORT || 3000;
const gameEngine = new GameEngine(io, pool);
app.use("/api/tx", createTransactionsRouter(pool, gameEngine));
app.use("/api/admin", createAdminRouter(gameEngine, pool));

// ==========================================
// HELPER: Generate deterministic card grid
// ==========================================
function generateCardGridFromId(cardId: number) {
  const ranges = [[1,15], [16,30], [31,45], [46,60], [61,75]];
  const grid: (number | null)[][] = Array(5).fill(null).map(() => Array(5).fill(null));
  
  let seed = cardId * 9301 + 49297;
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  
  for (let col = 0; col < 5; col++) {
    const [min, max] = ranges[col];
    const nums: number[] = [];
    while (nums.length < 5) {
      const n = Math.floor(random() * (max - min + 1)) + min;
      if (!nums.includes(n)) nums.push(n);
    }
    for (let row = 0; row < 5; row++) grid[row][col] = nums[row];
  }
  grid[2][2] = null;
  return grid;
}

// ==========================================
// SECURE CARD SELECTION ENDPOINT
// ==========================================
app.post('/api/select-cards', async (req, res) => {
  const { telegramId, cardIds, fee } = req.body;

  if (!telegramId || !cardIds || !Array.isArray(cardIds) || !fee) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (cardIds.length > 4) {
    return res.status(400).json({ error: 'Maximum 4 cards allowed' });
  }

  // 🔬 HARD CAP CHECK: Count existing cards for this user in this game
  const existingCardsResult = await pool.query(
    'SELECT COUNT(*) FROM game_cards WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1) AND game_id = 1',
    [telegramId]
  );
  const existingCount = parseInt(existingCardsResult.rows[0].count);
  
  if (existingCount + cardIds.length > 4) {
    return res.status(400).json({ error: `Limit reached. You already have ${existingCount} cards. Max is 4.` });
  }

  const totalCost = cardIds.length * fee;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let userId: number;
    const userResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) {
      const newUser = await client.query(
        'INSERT INTO users (telegram_id, username, first_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [telegramId, 'WebUser', 'WebUser', 'PLAYER']
      );
      userId = newUser.rows[0].id;
      await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, $2)', [userId, 0]);
    } else {
      userId = userResult.rows[0].id;
    }

    const walletResult = await client.query(
      'SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]
    );
    if (walletResult.rows.length === 0) throw new Error('Wallet not found');
    
    const currentBalance = parseFloat(walletResult.rows[0].balance);
    if (currentBalance < totalCost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Insufficient funds. Required: ${totalCost} ETB` });
    }

    await client.query('UPDATE wallets SET balance = balance - $1 WHERE id = $2', [totalCost, walletResult.rows[0].id]);

    await client.query(
      'INSERT INTO wallet_ledger (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
      [walletResult.rows[0].id, -totalCost, 'GAME_FEE', `Purchased ${cardIds.length} cards`]
    );

    for (const cardId of cardIds) {
      await client.query(
        'INSERT INTO game_cards (game_id, user_id, bingo_card_id, fee_paid) VALUES (1, $1, $2, $3)',
        [userId, cardId, fee]
      );
    }

    for (const cardId of cardIds) {
      gameEngine.addSoldCard(cardId, fee);
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `Purchased ${cardIds.length} cards for ${totalCost} ETB` });

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Card selection failed:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ==========================================
// REFUND CARD ENDPOINT
// ==========================================
app.post('/api/refund-card', async (req, res) => {
  const { telegramId, cardId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) throw new Error('User not found');
    const userId = userResult.rows[0].id;

    const cardResult = await client.query(
      'SELECT id, fee_paid FROM game_cards WHERE user_id = $1 AND bingo_card_id = $2 AND game_id = 1',
      [userId, cardId]
    );
    if (cardResult.rows.length === 0) throw new Error('Card not found');
    
    const fee = parseFloat(cardResult.rows[0].fee_paid);

    await client.query('DELETE FROM game_cards WHERE id = $1', [cardResult.rows[0].id]);

    const walletResult = await client.query('SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    await client.query('UPDATE wallets SET balance = balance + $1 WHERE id = $2', [fee, walletResult.rows[0].id]);
    await client.query('INSERT INTO wallet_ledger (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
      [walletResult.rows[0].id, fee, 'REFUND', `Refunded card #${cardId}`]);

    await client.query('COMMIT');
    gameEngine.removeSoldCard(cardId, fee);
    res.json({ success: true, message: `Refunded ${fee} ETB` });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

// ==========================================
// UPDATE FEE ENDPOINT
// ==========================================
app.post('/api/update-card-fee', async (req, res) => {
  const { telegramId, cardIds, newFee, additionalCost } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) throw new Error('User not found');
    const userId = userResult.rows[0].id;

    const walletResult = await client.query('SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (parseFloat(walletResult.rows[0].balance) < additionalCost) throw new Error('Insufficient funds');

    for (const cardId of cardIds) {
      await client.query('UPDATE game_cards SET fee_paid = $1 WHERE user_id = $2 AND bingo_card_id = $3 AND game_id = 1', [newFee, userId, cardId]);
    }
    
    if (additionalCost > 0) {
      await client.query('UPDATE wallets SET balance = balance - $1 WHERE id = $2', [additionalCost, walletResult.rows[0].id]);
      await client.query('INSERT INTO wallet_ledger (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
        [walletResult.rows[0].id, -additionalCost, 'FEE_UPDATE', `Increased fee for ${cardIds.length} cards`]);
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Fee updated' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

// ==========================================
// WALLET BALANCE ENDPOINT
// ==========================================
app.get('/api/wallet-balance', async (req, res) => {
  const { telegramId } = req.query;
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.json({ balance: 0 });
    const userId = userResult.rows[0].id;
    const walletResult = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
    res.json({ balance: parseFloat(walletResult.rows[0]?.balance || 0) });
  } catch (error) { res.json({ balance: 0 }); }
});

// ==========================================
// FETCH USER'S CARDS FOR LIVE GAME
// ==========================================
app.get('/api/my-cards', async (req, res) => {
  const { telegramId } = req.query;
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.json({ cards: [], balance: 0, hasCards: false });
    const userId = userResult.rows[0].id;
    
    const cardsResult = await pool.query(
      'SELECT bingo_card_id, fee_paid FROM game_cards WHERE user_id = $1 AND game_id = 1 ORDER BY bingo_card_id',
      [userId]
    );
    
    const walletResult = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
    const balance = parseFloat(walletResult.rows[0]?.balance || 0);
    
    const cards = cardsResult.rows.map((row: any) => ({
      bingo_card_id: row.bingo_card_id,
      fee_paid: row.fee_paid,
      grid: generateCardGridFromId(row.bingo_card_id)
    }));
    
    res.json({ cards, balance, hasCards: cards.length > 0 });
  } catch (error) {
    console.error('Fetch cards error:', error);
    res.json({ cards: [], balance: 0, hasCards: false });
  }
});

app.get('/', (req, res) => res.json({ status: 'Dashen Bingo API running' }));

io.on('connection', (socket) => {
  console.log('✅ Player connected:', socket.id);
  socket.emit('game:sync', gameEngine.getCurrentState());
  socket.on('disconnect', () => console.log('❌ Player disconnected:', socket.id));
});

server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
