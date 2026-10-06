const fs = require('fs');
let fail = 0;
function patch(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [search, replace, expect, label] of pairs) {
    const count = s.split(search).length - 1;
    if (count !== expect) { console.log('❌ ABORT: "' + label + '" found ' + count + 'x (expected ' + expect + ') in ' + file); fail = 1; continue; }
    s = s.split(search).join(replace);
    console.log('✅ ' + label);
  }
  if (!fail) fs.writeFileSync(file, s);
}

// ---------- A. GAME ENGINE ----------
const E = 'apps/api/src/gameEngine.ts';
let e = fs.readFileSync(E, 'utf8');
const ePairs = [
  ['this.prizePool -= fee * 0.8;', 'this.prizePool -= 10 * 0.8;', 1, 'refund uses fixed base fee'],
  ['this.prizePool += fee * 0.8;', 'this.prizePool += 10 * 0.8;', 1, 'purchase uses fixed base fee'],
  ['public protectedCards: Set<number> = new Set();',
   'public protectedCards: Set<number> = new Set();\n  private winClaims: Map<number, number> = new Map();', 1, 'winClaims map added'],
  ['    this.pool = pool;\n    this.startLobby();',
   '    this.pool = pool;\n    this.startLobby();\n    io.on(\'connection\', (socket: any) => {\n      socket.on(\'claimWin\', (data: any) => { this.handleClaim(data && data.telegramId); });\n    });', 1, 'claimWin socket listener'],
  ['  private endGame(hasWinner: boolean, winnerData: any) {\n    if (this.timerInterval) clearInterval(this.timerInterval);\n    this.stopBotTimers();',
   '  private async endGame(hasWinner: boolean, winnerData: any) {\n    if (this.timerInterval) clearInterval(this.timerInterval);\n    this.stopBotTimers();\n    const payouts = await this.settleWinners();', 1, 'endGame async + settle winners'],
  ['      winner: hasWinner ? winnerData : null,\n      prizePool: this.prizePool',
   '      winner: hasWinner ? winnerData : null,\n      prizePool: this.prizePool,\n      payouts: payouts', 1, 'payouts in completed event']
];
for (const [search, replace, expect, label] of ePairs) {
  const count = e.split(search).length - 1;
  if (count !== expect) { console.log('❌ ABORT: "' + label + '" found ' + count + 'x'); fail = 1; }
  else { e = e.split(search).join(replace); console.log('✅ ' + label); }
}

// Check if methods already exist (graceful skip instead of fail)
if (e.includes('settleWinners()') && e.includes('handleClaim(') && e.includes('gridFromId(')) {
  console.log('✅ engine methods already present (skipping append)');
} else {
  const methods = `
  private gridFromId(cardId: number): (number | null)[][] {
    const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
    const grid: (number | null)[][] = Array(5).fill(null).map(() => Array(5).fill(null));
    let seed = cardId * 9301 + 49297;
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let c = 0; c < 5; c++) {
      const nums: number[] = [];
      for (let i = ranges[c][0]; i <= ranges[c][1]; i++) nums.push(i);
      for (let i = nums.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); const t = nums[i]; nums[i] = nums[j]; nums[j] = t; }
      for (let r = 0; r < 5; r++) grid[r][c] = nums[r];
    }
    grid[2][2] = null;
    return grid;
  }

  private async handleClaim(telegramId: number) {
    if (this.state !== 'PLAYING' || !telegramId || this.winClaims.has(telegramId)) return;
    try {
      const userRes = await this.pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
      if (userRes.rows.length === 0) return;
      const cardsRes = await this.pool.query('SELECT bingo_card_id, fee_paid FROM game_cards WHERE user_id = $1 AND game_id = 1', [userRes.rows[0].id]);
      if (cardsRes.rows.length === 0) return;
      const marked = new Set(this.calledNumbers);
      let tier = 10; let win = false;
      for (const row of cardsRes.rows) {
        if (countPatterns(this.gridFromId(row.bingo_card_id), marked) >= 2) { win = true; tier = Math.max(tier, parseFloat(row.fee_paid || 10)); }
      }
      if (win) { this.winClaims.set(telegramId, tier); console.log('🏆 CLAIM accepted tg=' + telegramId + ' tier=' + tier); }
    } catch (err) { console.error('claim error', err); }
  }

  private async settleWinners(): Promise<any[]> {
    const results: any[] = [];
    const n = this.winClaims.size;
    if (n === 0) return results;
    const base = this.totalCardsSold * 10 * 0.8;
    for (const [tgId, tier] of Array.from(this.winClaims.entries())) {
      const payout = Math.round(((base * (tier / 10)) / n) * 100) / 100;
      try {
        const u = await this.pool.query('SELECT id FROM users WHERE telegram_id = $1', [tgId]);
        if (u.rows.length === 0) continue;
        const w = await this.pool.query('SELECT id FROM wallets WHERE user_id = $1', [u.rows[0].id]);
        if (w.rows.length === 0) continue;
        await this.pool.query('UPDATE wallets SET balance = balance + $1 WHERE id = $2', [payout, w.rows[0].id]);
        await this.pool.query('INSERT INTO wallet_ledger (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)', [w.rows[0].id, payout, 'WIN_PAYOUT', 'Bingo win tier ' + tier + ' split ' + n]);
        results.push({ telegramId: tgId, payout: payout, tier: tier });
      } catch (err) { console.error('payout failed', tgId, err); }
    }
    this.winClaims.clear();
    return results;
  }
`;
  e = e.substring(0, e.lastIndexOf('}')) + methods + '}\n';
  console.log('✅ engine methods appended');
}
if (!fail) fs.writeFileSync(E, e);

// ---------- B. LOBBY ----------
patch('apps/web/src/Lobby.tsx', [
  ['{Math.floor(prizePool)} ETB',
   '{Math.floor(prizePool * ((selectedCards.length > 0 ? selectedCards[0].fee : 10) / 10))} ETB', 1, 'lobby personalized prize']
]);

// ---------- C. LIVE GAME ----------
patch('apps/web/src/LiveGame.tsx', [
  ['const cardsContainerRef = useRef<HTMLDivElement>(null)',
   'const cardsContainerRef = useRef<HTMLDivElement>(null)\n  const myTierRef = useRef(1)\n  const hasCardsRef = useRef(false)', 1, 'tier refs'],
  ['setReserved(totalSpent)',
   'setReserved(totalSpent); if (data.cards.length > 0) { myTierRef.current = parseFloat(data.cards[0].fee_paid || 10) / 10; hasCardsRef.current = true; }', 1, 'tier from fee_paid'],
  ['setPrize(Math.floor(data.prizePool))',
   'setPrize(Math.floor(data.prizePool * myTierRef.current))', 1, 'live personalized prize'],
  ['setCurrentNumber(data.number); setCalledNumbers(data.calledNumbers || []); updateStats(data)',
   'setCurrentNumber(data.number); setCalledNumbers(data.calledNumbers || []); updateStats(data)\n      if (hasCardsRef.current && data.calledNumbers && data.calledNumbers.length >= 12) socket.emit(\'claimWin\', { telegramId: TELEGRAM_ID })', 1, 'auto-claim emit'],
  ['setWinner(data.winner)',
   'setWinner(data.winner); const myPay = (data.payouts || []).find((p: any) => p.telegramId === TELEGRAM_ID); if (myPay) { setTimeout(() => { alert(\'🏆 You won \' + myPay.payout + \' ETB!\'); }, 800); }', 1, 'winner payout alert']
]);

if (fail) { console.log('🛑 PATCH ABORTED — nothing was written or pushed.'); process.exit(1); }
console.log('✅ ALL REPLACEMENTS VERIFIED');
