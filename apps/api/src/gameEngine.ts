import { BOT_NAMES } from './botNames';
import { Server } from 'socket.io';

const LOBBY_DURATION_SEC = 60;
const NUMBER_CALL_INTERVAL_SEC = 4;
const MAX_NUMBERS_TO_CALL = 75;
const TARGET_TOTAL_CARDS = 150;



function generateBingoCard() {
  const ranges = [[1,15], [16,30], [31,45], [46,60], [61,75]];
  const card: (number | null)[][] = Array(5).fill(null).map(() => Array(5).fill(null));
  for (let col = 0; col < 5; col++) {
    const [min, max] = ranges[col];
    const nums: number[] = [];
    while (nums.length < 5) {
      const n = Math.floor(Math.random() * (max - min + 1)) + min;
      if (!nums.includes(n)) nums.push(n);
    }
    for (let row = 0; row < 5; row++) card[row][col] = nums[row];
  }
  card[2][2] = null; // FREE space
  return card;
}

// 🔬 NEW LOGIC: Count how many patterns are complete
function countPatterns(card: (number | null)[][], marked: Set<number>): number {
  let count = 0;

  // 1. Check Four Corners (Counts as 1 pattern)
  const corners = [card[0][0], card[0][4], card[4][0], card[4][4]];
  const cornersComplete = corners.every(cell => cell === null || marked.has(cell));
  if (cornersComplete) count++;

  // 2. Check Rows (5 patterns)
  for (let r = 0; r < 5; r++) {
    let rowComplete = true;
    for (let c = 0; c < 5; c++) {
      if (card[r][c] !== null && !marked.has(card[r][c])) {
        rowComplete = false;
        break;
      }
    }
    if (rowComplete) count++;
  }

  // 3. Check Columns (5 patterns)
  for (let c = 0; c < 5; c++) {
    let colComplete = true;
    for (let r = 0; r < 5; r++) {
      if (card[r][c] !== null && !marked.has(card[r][c])) {
        colComplete = false;
        break;
      }
    }
    if (colComplete) count++;
  }

  // 4. Check Diagonals (2 patterns)
  let d1 = true, d2 = true;
  for (let i = 0; i < 5; i++) {
    if (card[i][i] !== null && !marked.has(card[i][i])) d1 = false;
    if (card[i][4 - i] !== null && !marked.has(card[i][4 - i])) d2 = false;
  }
  if (d1) count++;
  if (d2) count++;

  return count;
}

interface BotCard { id: number; grid: (number | null)[][] }
interface BotPlayer {
  id: string;
  name: string;
  cardsBought: BotCard[];
  timers: NodeJS.Timeout[];
}

export class GameEngine {
  private io: Server;
  private pool: any;
  private state: 'WAITING' | 'CALLING' | 'COMPLETED' = 'WAITING';
  private timeRemaining: number = LOBBY_DURATION_SEC;
  private calledNumbers: number[] = [];
  private timerInterval: NodeJS.Timeout | null = null;
  
  private totalCardsSold = 0;
  private prizePool = 0;
  private bots: BotPlayer[] = [];
  public soldCardIds: Set<number> = new Set();
  public protectedCards: Set<number> = new Set();

  constructor(io: Server, pool: any) {
    this.io = io;
    this.pool = pool;
    this.startLobby();
  }

  
  
  public getAdminStats() {
    return {
      state: this.state,
      timeRemaining: this.timeRemaining,
      totalCardsSold: this.totalCardsSold,
      prizePool: this.prizePool,
      calledCount: this.calledNumbers.length,
      lastNumber: this.calledNumbers.length ? this.calledNumbers[this.calledNumbers.length - 1] : null,
      soldCount: this.soldCardIds.size
    };
  }

  public adminForceStart() {
    if (this.state === "WAITING") {
      const anySelf = this as any;
      if (typeof anySelf.startCallingNumbers === "function") anySelf.startCallingNumbers();
    }
  }

  public adminCallNext(): boolean {
    const anySelf = this as any;
    if (typeof anySelf.callNumber === "function") { anySelf.callNumber(); return true; }
    if (typeof anySelf.callNextNumber === "function") { anySelf.callNextNumber(); return true; }
    return false;
  }

  public adminReset() {
    const anySelf = this as any;
    if (anySelf.timerInterval) clearInterval(anySelf.timerInterval);
    if (anySelf.callInterval) clearInterval(anySelf.callInterval);
    if (anySelf.numberInterval) clearInterval(anySelf.numberInterval);
    this.state = "WAITING";
    this.timeRemaining = 60;
    this.calledNumbers = [];
    this.soldCardIds.clear();
    this.protectedCards.clear();
    this.totalCardsSold = 0;
    this.prizePool = 0;
    if (typeof anySelf.emitStats === "function") anySelf.emitStats();
  }

  public removeSoldCard(cardId: number, fee: number) {
    console.log(`[GAME ENGINE] 🔄 removeSoldCard called for ${cardId}. Currently in set? `, this.soldCardIds.has(cardId));
    if (this.soldCardIds.has(cardId)) {
      this.soldCardIds.delete(cardId);
      this.protectedCards.add(cardId);
      console.log(`[GAME ENGINE] 🛡️ ${cardId} removed from sold and added to protected (5s).`);
      setTimeout(() => {
        this.protectedCards.delete(cardId);
        console.log(`[GAME ENGINE] 🛡️ Protection expired for ${cardId}.`);
      }, 5000);
      this.totalCardsSold--;
      this.prizePool -= fee * 0.8;
      if (this.prizePool < 0) this.prizePool = 0;
      console.log(`[GAME ENGINE] 📊 Emitting stats after refund. Total sold now: ${this.totalCardsSold}`);
      this.emitStats();
    } else {
      console.log(`[GAME ENGINE] ❌ removeSoldCard FAILED: ${cardId} was NOT in soldCardIds!`);
    }
  }

  public addSoldCard(cardId: number, fee: number) {
    if (!this.soldCardIds.has(cardId)) {
      this.soldCardIds.add(cardId);
      this.totalCardsSold++;
      this.prizePool += fee * 0.8;
      this.emitStats();
    }
  }

  private emitStats() {
    this.io.emit('game:stats', {
      state: this.state,
      timeRemaining: this.timeRemaining,
      totalCardsSold: this.totalCardsSold,
      prizePool: this.prizePool,
      soldCardIds: Array.from(this.soldCardIds)
    });
  }

  private stopBotTimers() {
    this.bots.forEach(bot => {
      bot.timers.forEach(t => clearTimeout(t));
      bot.timers = [];
    });
  }

  private startLobby() {
    this.state = 'WAITING';
    this.timeRemaining = LOBBY_DURATION_SEC;
    this.calledNumbers = [];
    this.totalCardsSold = 0;
    this.prizePool = 0;
    this.soldCardIds.clear();
    this.bots = [];
    this.stopBotTimers();

    this.pool.query('DELETE FROM game_cards WHERE game_id = 1')
      .then(() => console.log(' [GAME ENGINE] Cleared old cards for new round.'))
      .catch(err => console.error('❌ Cleanup error:', err));

    console.log(`🎮 [GAME ENGINE] Lobby started. Target: ${TARGET_TOTAL_CARDS} cards.`);
    this.emitStats();

    for (let i = 0; i < 100; i++) {
      const name = BOT_NAMES[i % BOT_NAMES.length];
      const bot: BotPlayer = { id: `bot_${i}`, name, cardsBought: [], timers: [] };
      const cardsToBuy = Math.random() < 0.8 ? 1 : 2; 

      for (let c = 0; c < cardsToBuy; c++) {
        const delayMs = (Math.random() * 53000) + 2000; 
        const timer = setTimeout(() => { this.botBuyCard(bot); }, delayMs);
        bot.timers.push(timer);
      }
      this.bots.push(bot);
    }

    this.timerInterval = setInterval(() => {
      this.timeRemaining--;
      this.emitStats();
      if (this.timeRemaining <= 0) this.startCallingNumbers();
    }, 1000);
  }

  private botBuyCard(bot: BotPlayer) {
    if (this.totalCardsSold >= TARGET_TOTAL_CARDS) return;
    if (this.state !== 'WAITING') return;

    let cardId;
    let attempts = 0;
    do { 
      cardId = Math.floor(Math.random() * 400) + 1; 
      attempts++;
    } while ((this.soldCardIds.has(cardId) || this.protectedCards.has(cardId)) && attempts < 500);

    if (this.soldCardIds.has(cardId) || this.protectedCards.has(cardId)) return; 

    const grid = generateBingoCard();
    const cardObj = { id: cardId, grid };
    
    this.soldCardIds.add(cardId);
    this.totalCardsSold++;
    this.prizePool += 10 * 0.8;
    bot.cardsBought.push(cardObj);

    this.io.emit('game:botCardsSold', { cardIds: [cardId] });
    this.emitStats();
  }

  private startCallingNumbers() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.stopBotTimers(); 
    
    this.state = 'CALLING';
    console.log(` [GAME ENGINE] Lobby closed. Total cards: ${this.totalCardsSold}. Calling numbers!`);
    this.io.emit('game:stateChange', { state: 'CALLING' });

    let numbersCalledCount = 0;
    const markedNumbers = new Set<number>();

    this.timerInterval = setInterval(() => {
      if (numbersCalledCount >= MAX_NUMBERS_TO_CALL) { this.endGame(false, null); return; }

      let newNumber: number;
      do { newNumber = Math.floor(Math.random() * 75) + 1; } while (this.calledNumbers.includes(newNumber));

      this.calledNumbers.push(newNumber);
      markedNumbers.add(newNumber);
      numbersCalledCount++;

      console.log(` [GAME ENGINE] Called Number: ${newNumber} (${numbersCalledCount}/${MAX_NUMBERS_TO_CALL})`);
      
      this.io.emit('game:numberCalled', { 
        number: newNumber, 
        calledNumbers: this.calledNumbers,
        totalCardsSold: this.totalCardsSold,
        prizePool: this.prizePool
      });

      // 🔬 CHECK FOR 2 PATTERNS
      for (const bot of this.bots) {
        for (const card of bot.cardsBought) {
          const completedPatterns = countPatterns(card.grid, markedNumbers);
          
          if (completedPatterns >= 2) {
            console.log(`🏆 [GAME ENGINE] BINGO! ${bot.name} won with card #${card.id} (Patterns: ${completedPatterns})!`);
            this.endGame(true, { botName: bot.name, cardId: card.id, grid: card.grid, winningNumber: newNumber });
            return;
          }
        }
      }
    }, NUMBER_CALL_INTERVAL_SEC * 1000);
  }

  private endGame(hasWinner: boolean, winnerData: any) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.stopBotTimers();
    
    this.state = 'COMPLETED';
    this.io.emit('game:completed', {
      hasWinner,
      winner: hasWinner ? winnerData : null,
      prizePool: this.prizePool
    });
    setTimeout(() => { console.log('🔄 [GAME ENGINE] Restarting...'); this.startLobby(); }, 8000);
  }

  public getCurrentState() {
    return {
      state: this.state,
      timeRemaining: this.timeRemaining,
      calledNumbers: this.calledNumbers,
      soldCardIds: Array.from(this.soldCardIds),
      totalCardsSold: this.totalCardsSold,
      prizePool: this.prizePool
    };
  }
}
