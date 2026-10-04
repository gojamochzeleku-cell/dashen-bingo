import { Router, Request, Response } from 'express';

export function createTransactionsRouter(pool: any, gameEngine: any): Router {
  const router = Router();
  const MIN_WITHDRAW = 100;
  const KEEP_IN_WALLET = 100;

  function parseSMS(text: string): { amount: number | null; reference: string | null; sender: string | null } {
    let amount: number | null = null;
    let reference: string | null = null;
    let sender: string | null = null;
    const amountMatch =
      text.match(/(?:ETB|Birr|birr)\s*(\d+(?:[.,]\d+)?)/i) ||
      text.match(/(\d+(?:[.,]\d+)?)\s*(?:ETB|Birr|birr)/i) ||
      text.match(/credited\s+(?:with\s+)?(?:ETB\s+)?(\d+(?:[.,]\d+)?)/i) ||
      text.match(/received\s+(?:ETB\s+)?(\d+(?:[.,]\d+)?)/i) ||
      text.match(/amount[:\s]+(?:ETB\s+)?(\d+(?:[.,]\d+)?)/i);
    if (amountMatch) amount = parseFloat(amountMatch[1].replace(',', '.'));
    const refMatch = text.match(/(?:ref|reference|txn|trans|transaction|id)[:\s#]*([A-Z0-9\-]{4,})/i);
    if (refMatch) reference = refMatch[1].toUpperCase();
    if (!reference) {
      const fallback = text.match(/\b([A-Z0-9]{6,15})\b/);
      if (fallback) reference = fallback[1];
    }
    const senderMatch =
      text.match(/from\s+(\+?2519\d{8}|09\d{8}|\d{10,})/i) ||
      text.match(/Acct\s+(?:\*+)?(\d{4,})/i);
    if (senderMatch) sender = senderMatch[1];
    return { amount, reference, sender };
  }

  router.post('/deposit/submit', async (req: Request, res: Response) => {
    try {
      const { telegramId, smsText, method } = req.body;
      if (!telegramId || !smsText || !method) return res.status(400).json({ error: 'missing fields' });
      const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
      if (userRes.rows.length === 0) return res.status(404).json({ error: 'user not found' });
      const userId = userRes.rows[0].id;
      const parsed = parseSMS(smsText);
      if (!parsed.amount || parsed.amount <= 0) return res.status(400).json({ error: 'could not parse amount from SMS' });
      if (!parsed.reference) return res.status(400).json({ error: 'could not find reference number in SMS' });
      const dupCheck = await pool.query('SELECT id, status FROM transactions WHERE reference = $1', [parsed.reference]);
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({ error: 'duplicate SMS', existingStatus: dupCheck.rows[0].status, message: 'This reference (' + parsed.reference + ') was already ' + dupCheck.rows[0].status + '.' });
      }
      await pool.query(
        `INSERT INTO transactions (user_id, telegram_id, type, method, amount, status, reference, sms_sender, sms_raw)
         VALUES ($1, $2, 'deposit', $3, $4, 'pending', $5, $6, $7)`,
        [userId, telegramId, method, parsed.amount, parsed.reference, parsed.sender, smsText]);
      res.json({ success: true, amount: parsed.amount, reference: parsed.reference, message: 'Deposit submitted. Will be credited within 5 minutes after admin approval.' });
    } catch (e: any) {
      if (e.code === '23505') return res.status(409).json({ error: 'duplicate SMS', message: 'This SMS was already submitted.' });
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/withdraw/request', async (req: Request, res: Response) => {
    try {
      const { telegramId, amount, method, accountNumber, accountName } = req.body;
      const amt = parseFloat(amount);
      if (!telegramId || isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'invalid amount' });
      if (!method || !accountNumber || !accountName) return res.status(400).json({ error: 'missing payout details' });

      const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
      if (userRes.rows.length === 0) return res.status(404).json({ error: 'user not found' });
      const userId = userRes.rows[0].id;

      const walletRes = await pool.query('SELECT id, balance FROM wallets WHERE user_id = $1', [userId]);
      if (walletRes.rows.length === 0) return res.status(404).json({ error: 'no wallet' });
      const wallet = walletRes.rows[0];
      const currentBal = parseFloat(wallet.balance);

      const max = currentBal - KEEP_IN_WALLET;
      if (amt < MIN_WITHDRAW) return res.status(400).json({ error: 'minimum withdrawal is ' + MIN_WITHDRAW + ' ETB', min: MIN_WITHDRAW });
      if (max < MIN_WITHDRAW) return res.status(400).json({ error: 'insufficient balance: you must keep ' + KEEP_IN_WALLET + ' ETB in wallet', current: currentBal });
      if (amt > max) return res.status(400).json({ error: 'maximum withdrawal is ' + Math.floor(max) + ' ETB (balance minus ' + KEEP_IN_WALLET + ')', max });

      await pool.query('BEGIN');
      await pool.query('UPDATE wallets SET balance = balance - $1 WHERE id = $2', [amt, wallet.id]);
      const txnRes = await pool.query(
        `INSERT INTO transactions (user_id, telegram_id, type, method, amount, status, payout_account, payout_name)
         VALUES ($1, $2, 'withdrawal', $3, $4, 'pending', $5, $6) RETURNING id`,
        [userId, telegramId, method, amt, accountNumber, accountName]);
      await pool.query('COMMIT');

      res.json({ success: true, txnId: txnRes.rows[0].id, amount: amt, newBalance: currentBal - amt });
    } catch (e: any) {
      await pool.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
