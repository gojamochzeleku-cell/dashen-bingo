import { useEffect, useState, useRef } from 'react'
import { io } from 'socket.io-client'

const socket = io()
function resolveTgId(): number {
  const w = window as any;
  const real = w.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (real) return real;
  if (location.hostname === 'localhost') return 6814258043;
  let dev = localStorage.getItem('dev_tg_id');
  if (!dev) { dev = String(Math.floor(1e8 + Math.random() * 9e8)); localStorage.setItem('dev_tg_id', dev); }
  return Number(dev);
}
const TELEGRAM_ID: number = resolveTgId();

interface BingoCard {
  id: number
  grid: (number | null)[][]
}

const getCompletedPatternCells = (grid: (number | null)[][], calledSet: Set<number>): Set<string> => {
  const highlighted = new Set<string>()
  const checkLine = (cells: {r: number, c: number, val: number | null}[]) => {
    const isComplete = cells.every(cell => cell.val === null || calledSet.has(cell.val))
    if (isComplete) cells.forEach(cell => highlighted.add(`${cell.r}-${cell.c}`))
  }
  for (let r = 0; r < 5; r++) { const cells = []; for (let c = 0; c < 5; c++) cells.push({r, c, val: grid[r][c]}); checkLine(cells) }
  for (let c = 0; c < 5; c++) { const cells = []; for (let r = 0; r < 5; r++) cells.push({r, c, val: grid[r][c]}); checkLine(cells) }
  const d1 = [], d2 = []; for (let i = 0; i < 5; i++) { d1.push({r: i, c: i, val: grid[i][i]}); d2.push({r: i, c: 4 - i, val: grid[i][4 - i]}) }
  checkLine(d1); checkLine(d2)
  checkLine([{r: 0, c: 0, val: grid[0][0]}, {r: 0, c: 4, val: grid[0][4]}, {r: 4, c: 0, val: grid[4][0]}, {r: 4, c: 4, val: grid[4][4]}])
  return highlighted
}

function LiveGame() {
  const [currentNumber, setCurrentNumber] = useState<number | null>(null)
  const [calledNumbers, setCalledNumbers] = useState<number[]>([])
  const [myCards, setMyCards] = useState<BingoCard[]>([])
  const [balance, setBalance] = useState(0)
  const [reserved, setReserved] = useState(0)
  const [prize, setPrize] = useState(0)
  const [totalCardsSold, setTotalCardsSold] = useState(0)
  const [gameState, setGameState] = useState('WAITING')
  const [winner, setWinner] = useState<any>(null)
  const [hasCards, setHasCards] = useState(true)
  const [countdown, setCountdown] = useState(8)
  const cardsContainerRef = useRef<HTMLDivElement>(null)

  const generateCardGrid = (cardId: number): (number | null)[][] => {
    const ranges = [[1,15], [16,30], [31,45], [46,60], [61,75]]
    const grid: (number | null)[][] = Array(5).fill(null).map(() => Array(5).fill(null))
    let seed = cardId * 9301 + 49297
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    for (let col = 0; col < 5; col++) {
      const [min, max] = ranges[col]; const nums: number[] = [];
      while (nums.length < 5) { const n = Math.floor(random() * (max - min + 1)) + min; if (!nums.includes(n)) nums.push(n); }
      for (let row = 0; row < 5; row++) grid[row][col] = nums[row];
    }
    grid[2][2] = null; return grid;
  }

  const getLetter = (n: number) => {
    if (n <= 15) return 'B'; if (n <= 30) return 'I'; if (n <= 45) return 'N'; if (n <= 60) return 'G'; return 'O';
  }

  useEffect(() => {
    fetch(`/api/my-cards?telegramId=${TELEGRAM_ID}`)
      .then(r => r.json())
      .then(data => {
        if (data.cards) {
          const cardsWithGrids = data.cards.map((c: any) => ({ id: c.bingo_card_id, grid: c.grid || generateCardGrid(c.bingo_card_id) }))
          setMyCards(cardsWithGrids); setHasCards(cardsWithGrids.length > 0)
          const totalSpent = data.cards.reduce((sum: number, card: any) => sum + parseFloat(card.fee_paid || 10), 0)
          setReserved(totalSpent)
        } else { setHasCards(false); setReserved(0); }
        if (data.balance !== undefined) setBalance(data.balance)
      })
      .catch(err => { console.error('Failed to fetch cards:', err); setHasCards(false); setReserved(0) })

    const updateStats = (data: any) => {
      if (data.totalCardsSold !== undefined) setTotalCardsSold(data.totalCardsSold)
      if (data.prizePool !== undefined) setPrize(Math.floor(data.prizePool))
      if (data.state) setGameState(data.state)
    }

    socket.on('game:numberCalled', (data) => {
      setCurrentNumber(data.number); setCalledNumbers(data.calledNumbers || []); updateStats(data)
    })
    socket.on('game:stats', updateStats)
    socket.on('game:sync', (data) => {
      if (data.calledNumbers) { setCalledNumbers(data.calledNumbers); if (data.calledNumbers.length > 0) setCurrentNumber(data.calledNumbers[data.calledNumbers.length - 1]) }
      updateStats(data)
    })
    
    socket.on('game:completed', (data) => { 
      if (data.hasWinner) {
        setWinner(data.winner)
        setCountdown(8)
      }
    })

    return () => { socket.off('game:numberCalled'); socket.off('game:stats'); socket.off('game:completed'); socket.off('game:sync'); }
  }, [])

  useEffect(() => {
    if (!winner) return
    if (countdown <= 0) { window.location.reload(); return }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [winner, countdown])

  const isNumberCalled = (num: number) => calledNumbers.includes(num)
  const boardColumns = [
    { letter: 'B', numbers: Array.from({length: 15}, (_, i) => i + 1) },
    { letter: 'I', numbers: Array.from({length: 15}, (_, i) => i + 16) },
    { letter: 'N', numbers: Array.from({length: 15}, (_, i) => i + 31) },
    { letter: 'G', numbers: Array.from({length: 15}, (_, i) => i + 46) },
    { letter: 'O', numbers: Array.from({length: 15}, (_, i) => i + 61) }
  ]

  const calledSet = new Set(calledNumbers)

  return (
    <div className="live-game-layout">
      <div className="live-stats-bar">
        <div className="live-stat-box"><span className="live-stat-label">BALANCE</span><span className="live-stat-value green">{balance}</span></div>
        <div className="live-stat-box"><span className="live-stat-label">RESERVED</span><span className="live-stat-value blue">{reserved}</span></div>
        <div className="live-stat-box"><span className="live-stat-label">PRIZE</span><span className="live-stat-value yellow">{prize}</span></div>
        <div className="live-stat-box"><span className="live-stat-label">CARDS</span><span className="live-stat-value purple">{totalCardsSold}</span></div>
        <div className="live-stat-box"><span className="live-stat-label">CALLED</span><span className="live-stat-value orange">{calledNumbers.length}/75</span></div>
      </div>

      <div className="live-two-columns">
        <div className="live-left-column">
          <div className="current-number-display">
            <div className="current-number-big">
              {currentNumber ? (
                <>
                  <span className={`bingo-letter-display letter-${getLetter(currentNumber).toLowerCase()}`}>{getLetter(currentNumber)}</span>
                  <span className="number-display">{currentNumber}</span>
                </>
              ) : '---'}
            </div>
            <div className="current-label">CURRENT</div>
          </div>
          <div className="bingo-board-headers">
            <span className="bingo-letter b">B</span><span className="bingo-letter i">I</span><span className="bingo-letter n">N</span><span className="bingo-letter g">G</span><span className="bingo-letter o">O</span>
          </div>
          <div className="bingo-board-grid">
            {Array.from({length: 15}, (_, rowIdx) => (
              boardColumns.map((col, colIdx) => {
                const num = col.numbers[rowIdx]; const called = isNumberCalled(num)
                return <div key={`${rowIdx}-${colIdx}`} className={`board-number ${called ? 'called' : ''}`}>{num}</div>
              })
            ))}
          </div>
        </div>

        <div className="live-right-column" ref={cardsContainerRef}>
          {!hasCards ? (
            <div className="no-cards-message">
              <div className="no-cards-icon"></div><h3>You didn't buy cards</h3>
              <p>Wait for this game to end and try your luck in the next round!</p>
              <div className="no-cards-hint">💡 Tip: Select cards in the lobby before the timer ends</div>
            </div>
          ) : (
            myCards.map((card) => {
              const patternCells = getCompletedPatternCells(card.grid, calledSet)
              return (
                <div key={card.id} className="player-card">
                  <div className="player-card-title">CARD #{card.id}</div>
                  <div className="card-bingo-headers">
                    <span className="card-letter b">B</span><span className="card-letter i">I</span><span className="card-letter n">N</span><span className="card-letter g">G</span><span className="card-letter o">O</span>
                  </div>
                  <div className="card-grid-5x5">
                    {card.grid.map((row, rIdx) => row.map((cell, cIdx) => {
                      const isFree = rIdx === 2 && cIdx === 2
                      const isMatched = cell !== null && isNumberCalled(cell)
                      const isPatternComplete = patternCells.has(`${rIdx}-${cIdx}`)
                      return (
                        <div key={`${rIdx}-${cIdx}`} className={`card-cell ${isFree ? 'free' : ''} ${isMatched ? 'matched' : ''} ${isPatternComplete ? 'pattern-complete' : ''}`}>
                          {isFree ? 'FREE' : cell}
                        </div>
                      )
                    }))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 🔬 PREMIUM WINNER MODAL (Blink effect strictly isolated here) */}
      {winner && (() => {
        const winnerPatternCells = getCompletedPatternCells(winner.grid, calledSet);
        return (
          <div className="winner-overlay-premium">
            <div className="winner-modal-premium">
              <div className="winner-glow-bg"></div>
              <h2 className="winner-modal-title">🎉 Game Completed</h2>
              <p className="winner-modal-subtitle">New game will start soon. You will be redirected to the lobby.</p>
              
              <div className="winner-announcement">
                <span className="winner-name">{winner.botName || 'Player'}</span> 
                <span className="winner-card-badge">Card #{winner.cardId}</span> 
                <span className="winner-action">has won the game!</span>
              </div>

              <div className="winner-card-display-premium">
                <div className="winner-card-header-premium">
                  <span className="winner-header-letter">B</span>
                  <span className="winner-header-letter">I</span>
                  <span className="winner-header-letter">N</span>
                  <span className="winner-header-letter">G</span>
                  <span className="winner-header-letter">O</span>
                </div>
                <div className="winner-card-grid-premium">
                  {winner.grid.map((row: (number | null)[], rIdx: number) => 
                    row.map((cell: number | null, cIdx: number) => {
                      const isFree = rIdx === 2 && cIdx === 2
                      const isRedLight = winnerPatternCells.has(`${rIdx}-${cIdx}`)
                      const isLastNumber = cell === winner.winningNumber // 🔥 Identifies the exact winning number
                      return (
                        <div 
                          key={`${rIdx}-${cIdx}`} 
                          className={`winner-cell-premium ${isFree ? 'free-cell-premium' : ''} ${isRedLight ? 'pattern-complete-premium' : ''} ${isLastNumber ? 'golden-halo-pulse' : ''}`}
                        >
                          {isFree ? '★' : cell}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              <div className="redirect-countdown-premium">
                <div className="countdown-bar">
                  <div className="countdown-fill" style={{ width: `${(countdown / 8) * 100}%` }}></div>
                </div>
                <p>Redirecting to the Lobby in <strong>{countdown}</strong> seconds...</p>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default LiveGame
