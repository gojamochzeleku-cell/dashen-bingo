import { Router, Request, Response } from 'express';
import type { GameEngine } from './gameEngine';

export function createAdminRouter(gameEngine: GameEngine, pool: any): Router {
  const router = Router();
  const ADMIN_KEY = process.env.ADMIN_KEY || 'DashenAdmin@2026';

  router.use((req: Request, res: Response, next) => {
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_KEY) {
      return res.status(403).json({ error: 'Forbidden: invalid admin key' });
    }
    next();
  });

  router.post('/login', (_req: Request, res: Response) => res.json({ success: true, time: Date.now() }));

  router.get('/stats', async (_req: Request, res: Response) => {
    try {
      const game = gameEngine.getAdminStats();
      let db: any = {};
      try {
        const u = await pool.query('SELECT COUNT(*)::int AS c FROM users');
        const v = await pool.query('SELECT COUNT(*)::int AS c FROM users WHERE shared_contact = TRUE');
        const b = await pool.query('SELECT COALESCE(SUM(balance),0)::float AS t FROM wallets');
        db = { users: u.rows[0].c, verified: v.rows[0].c, totalBalances: b.rows[0].t };
      } catch (e) {}
      res.json({ game, db, botCount: gameEngine.botTargetCount ?? 30, now: Date.now() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/users', async (_req: Request, res: Response) => {
    try {
      const q = await pool.query(
        `SELECT u.telegram_id, u.username, u.first_name, u.shared_contact, u.phone_number, w.balance
         FROM users u LEFT JOIN wallets w ON w.user_id = u.id
         ORDER BY u.id DESC LIMIT 200`);
      res.json({ users: q.rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/adjust-balance', async (req: Request, res: Response) => {
    try {
      const { telegramId, amount } = req.body;
      const amt = parseFloat(amount);
      if (!telegramId || isNaN(amt)) return res.status(400).json({ error: 'bad params' });
      const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
      if (userRes.rows.length === 0) return res.status(404).json({ error: 'user not found' });
      const userId = userRes.rows[0].id;
      await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [amt, userId]);
      const after = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
      res.json({ success: true, newBalance: parseFloat(after.rows[0].balance) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/game/force-start', (_req: Request, res: Response) => { gameEngine.adminForceStart(); res.json({ success: true }); });
  router.post('/game/call-next', (_req: Request, res: Response) => { res.json({ success: gameEngine.adminCallNext() }); });
  router.post('/game/reset', (_req: Request, res: Response) => { gameEngine.adminReset(); res.json({ success: true }); });

  router.post('/broadcast', async (req: Request, res: Response) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: 'text required' });
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const users = await pool.query('SELECT telegram_id FROM users');
      let sent = 0, failed = 0;
      for (const row of users.rows) {
        try {
          await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: row.telegram_id, text: String(text) })
          });
          sent++;
        } catch { failed++; }
        await new Promise(r => setTimeout(r, 35));
      }
      res.json({ sent, failed });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/pending', async (_req: Request, res: Response) => {
    try {
      const q = await pool.query(
        `SELECT t.*, u.username, u.first_name, u.phone_number
         FROM transactions t LEFT JOIN users u ON u.id = t.user_id
         WHERE t.status = 'pending' ORDER BY t.created_at ASC`);
      res.json({ transactions: q.rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/txn/approve/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const txnRes = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
      if (txnRes.rows.length === 0) return res.status(404).json({ error: 'not found' });
      const txn = txnRes.rows[0];
      if (txn.status !== 'pending') return res.status(400).json({ error: 'already processed' });

      await pool.query('BEGIN');
      if (txn.type === 'deposit') {
        await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [txn.amount, txn.user_id]);
      }
      await pool.query(`UPDATE transactions SET status = 'approved', processed_at = NOW() WHERE id = $1`, [id]);
      await pool.query('COMMIT');

      try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const msg = txn.type === 'deposit'
          ? '✅ *Deposit Approved!*\n\nAmount: *' + txn.amount + ' ETB*\nReference: `' + txn.reference + '`\n\nYour wallet has been credited. Thank you!'
          : '✅ *Withdrawal Approved!*\n\nAmount: *' + txn.amount + ' ETB* is being sent to your account.\n\nThank you for playing!';
        await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: txn.telegram_id, text: msg, parse_mode: 'Markdown' })
        });
      } catch (e) {}
      res.json({ success: true });
    } catch (e: any) {
      await pool.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/txn/reject/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const notes = (req.body && req.body.notes) || '';
      const txnRes = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
      if (txnRes.rows.length === 0) return res.status(404).json({ error: 'not found' });
      const txn = txnRes.rows[0];
      if (txn.status !== 'pending') return res.status(400).json({ error: 'already processed' });

      await pool.query('BEGIN');
      let finalStatus = 'rejected';
      if (txn.type === 'withdrawal') {
        await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [txn.amount, txn.user_id]);
        finalStatus = 'refunded';
      }
      await pool.query(`UPDATE transactions SET status = $1, processed_at = NOW(), admin_notes = $2 WHERE id = $3`, [finalStatus, notes, id]);
      await pool.query('COMMIT');

      try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const support = process.env.SUPPORT_USERNAME || 'DashenBingo';
        const msg = txn.type === 'deposit'
          ? '❌ *Deposit Rejected*\n\nAmount: *' + txn.amount + ' ETB*\nReference: `' + txn.reference + '`\n\nReason: ' + (notes || 'SMS verification failed.') + '\n\nContact @' + support + ' for help.'
          : '❌ *Withdrawal Rejected*\n\nAmount: *' + txn.amount + ' ETB* has been REFUNDED to your wallet.\n\nReason: ' + (notes || 'Could not process.') + '\n\nContact @' + support + ' for help.';
        await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: txn.telegram_id, text: msg, parse_mode: 'Markdown' })
        });
      } catch (e) {}
      res.json({ success: true, finalStatus });
    } catch (e: any) {
      await pool.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/ledger', async (req: Request, res: Response) => {
    try {
      const period = String(req.query.period || 'daily');
      let dateFilter = "t.created_at >= NOW() - INTERVAL '1 day'";
      if (period === 'weekly') dateFilter = "t.created_at >= NOW() - INTERVAL '7 days'";
      else if (period === 'monthly') dateFilter = "t.created_at >= NOW() - INTERVAL '30 days'";
      else if (period === 'all') dateFilter = '1=1';

      const q = await pool.query(
        `SELECT t.*, u.username, u.first_name
         FROM transactions t LEFT JOIN users u ON u.id = t.user_id
         WHERE ${dateFilter} ORDER BY t.created_at DESC LIMIT 500`);
      const summary = await pool.query(
        `SELECT
           SUM(CASE WHEN type='deposit' AND status='approved' THEN amount ELSE 0 END)::float AS total_deposits,
           SUM(CASE WHEN type='withdrawal' AND status='approved' THEN amount ELSE 0 END)::float AS total_withdrawals,
           COUNT(CASE WHEN status='pending' THEN 1 END) AS pending_count,
           COUNT(CASE WHEN status='approved' THEN 1 END) AS approved_count,
           COUNT(CASE WHEN status IN ('rejected','refunded') THEN 1 END) AS rejected_count
         FROM transactions t WHERE ${dateFilter}`);
      res.json({ transactions: q.rows, summary: summary.rows[0], period });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });


  // ====== PROMOTIONS MANAGEMENT ======
  router.get('/promos', async (_req: Request, res: Response) => {
    try {
      const q = await pool.query('SELECT * FROM promotions ORDER BY id ASC');
      res.json({ promos: q.rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/promos/update', async (req: Request, res: Response) => {
    try {
      const { id, is_active, value, max_amount } = req.body;
      await pool.query(
        'UPDATE promotions SET is_active = $1, value = $2, max_amount = $3 WHERE id = $4',
        [is_active, value, max_amount || null, id]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/active-promos', async (_req: Request, res: Response) => {
    try {
      const q = await pool.query(
        "SELECT type, value, max_amount FROM promotions WHERE is_active = TRUE AND (start_time IS NULL OR start_time <= NOW()) AND (end_time IS NULL OR end_time >= NOW())"
      );
      res.json({ promos: q.rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  
  router.post('/set-bot-count', async (req: Request, res: Response) => {
    try {
      const { count } = req.body;
      if (typeof count !== 'number' || count < 0 || count > 200) {
        return res.status(400).json({ error: 'Invalid bot count. Must be between 0 and 200.' });
      }
      gameEngine.botTargetCount = count;
      console.log(`🛡️ [ADMIN] Updated botTargetCount to: ${count}`);
      res.json({ success: true, currentCount: gameEngine.botTargetCount });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
