import { API_BASE } from "./apiBase";
import { useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'

const socket = io(API_BASE)
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
const DEFAULT_FEE = 10
const FEE_TIERS = [10, 20, 30, 40, 50]
const MAX_CARDS = 4

interface PurchasedCard { cardId: number; fee: number }

function Lobby() {
  const [timeRemaining, setTimeRemaining] = useState(60)
  const [totalCardsSold, setTotalCardsSold] = useState(0)
  const [prizePool, setPrizePool] = useState(0)
  const [gameState, setGameState] = useState('WAITING')
  const [selectedCards, setSelectedCards] = useState<PurchasedCard[]>([])
  const [currentFee, setCurrentFee] = useState(DEFAULT_FEE)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [message, setMessage] = useState({ text: '', type: 'success' | 'error' | '' })
  const [walletBalance, setWalletBalance] = useState(2000)
  const [soldCardIds, setSoldCardIds] = useState<Set<number>>(new Set())
  
  // 🔬 BRUTE FORCE FRONTEND PROTECTION: Keep refunded cards available for 5s
  const [recentlyRefunded, setRecentlyRefunded] = useState<Set<number>>(new Set())

  const allCards = Array.from({ length: 400 }, (_, i) => i + 1)

  useEffect(() => {
    const handleStats = (data: any) => {
      setTimeRemaining(data.timeRemaining)
      setTotalCardsSold(data.totalCardsSold || 0)
      if (data.prizePool !== undefined && data.prizePool > 0) setPrizePool(data.prizePool)
      setGameState(data.state)
      if (Array.isArray(data.soldCardIds)) {
        // 🔬 FILTER OUT recently refunded cards so they NEVER turn red!
        const filteredIds = data.soldCardIds.filter((id: number) => !recentlyRefunded.has(id))
        setSoldCardIds(new Set(filteredIds))
      }
    }

    socket.on('game:stats', handleStats)
    fetchWalletBalance()
    return () => { socket.off('game:stats', handleStats) }
  }, [recentlyRefunded])

  const fetchWalletBalance = async () => {
    try {
      const response = await fetch(API_BASE + `/api/wallet-balance?telegramId=${TELEGRAM_ID}`)
      const data = await response.json()
      if (data.balance !== undefined) setWalletBalance(data.balance)
    } catch (error) { console.error(error) }
  }

  const handleCardClick = useCallback((cardNumber: number) => {
    if (gameState !== 'WAITING') return
    
    const isAlreadySelected = selectedCards.some(c => c.cardId === cardNumber)
    
    if (isAlreadySelected) {
      const cardToRefund = selectedCards.find(c => c.cardId === cardNumber)
      
      // 1. Instantly remove from UI
      setSelectedCards(prev => prev.filter(c => c.cardId !== cardNumber))
      setSoldCardIds(prev => { const s = new Set(prev); s.delete(cardNumber); return s; })
      
      // 2. 🔬 ADD TO FRONTEND PROTECTION SHIELD (5 seconds)
      setRecentlyRefunded(prev => {
        const next = new Set(prev);
        next.add(cardNumber);
        setTimeout(() => {
          setRecentlyRefunded(current => {
            const updated = new Set(current);
            updated.delete(cardNumber);
            return updated;
          });
        }, 5000);
        return next;
      });
      
      if (cardToRefund) {
        setWalletBalance(prev => prev + cardToRefund.fee)
        fetch(API_BASE + '/api/refund-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegramId: TELEGRAM_ID, cardId: cardNumber })
        }).catch(err => {
          console.error('Refund failed, reverting:', err)
          setSelectedCards(prev => [...prev, cardToRefund])
          setSoldCardIds(prev => new Set(prev).add(cardNumber))
          setWalletBalance(prev => prev - cardToRefund.fee)
        })
      }
      return
    }
    
    if (soldCardIds.has(cardNumber)) {
      setMessage({ text: `Card #${cardNumber} is sold`, type: 'error' })
      setTimeout(() => setMessage({ text: '', type: '' }), 1500)
      return
    }
    
    if (selectedCards.length >= MAX_CARDS) {
      setMessage({ text: `ከፍተኛ አራት መርጠዋል።`, type: 'error' })
      setTimeout(() => setMessage({ text: '', type: '' }), 1500)
      return
    }
    
    if (walletBalance < currentFee) {
      setMessage({ text: `Need ${currentFee} ETB`, type: 'error' })
      setTimeout(() => setMessage({ text: '', type: '' }), 1500)
      return
    }

    const newCard = { cardId: cardNumber, fee: currentFee }
    setSelectedCards(prev => [...prev, newCard])
    setSoldCardIds(prev => new Set(prev).add(cardNumber))
    setWalletBalance(prev => prev - currentFee)

    fetch(API_BASE + '/api/select-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: TELEGRAM_ID, cardIds: [cardNumber], fee: currentFee })
    }).catch(err => {
      console.error('Purchase failed, reverting:', err)
      setSelectedCards(prev => prev.filter(c => c.cardId !== cardNumber))
      setSoldCardIds(prev => { const s = new Set(prev); s.delete(cardNumber); return s; })
      setWalletBalance(prev => prev + currentFee)
    })
  }, [gameState, selectedCards, soldCardIds, walletBalance, currentFee])

  const handleFeeChange = (delta: number) => {
    const currentIndex = FEE_TIERS.indexOf(currentFee)
    const newIndex = currentIndex + delta
    if (newIndex >= 0 && newIndex < FEE_TIERS.length) {
      const newFee = FEE_TIERS[newIndex]
      if (newFee > currentFee && selectedCards.length > 0) {
        setCurrentFee(newFee); setNeedsConfirmation(true)
        setMessage({ text: `Fee: ${newFee} ETB. Confirm?`, type: 'success' })
      } else { setCurrentFee(newFee); setNeedsConfirmation(false); setMessage({ text: '', type: '' }) }
    }
  }

  const confirmFeeIncrease = async () => {
    if (selectedCards.length === 0) { setNeedsConfirmation(false); return }
    setIsProcessing(true)
    try {
      const oldTotal = selectedCards.reduce((sum, card) => sum + card.fee, 0)
      const additionalCost = (selectedCards.length * currentFee) - oldTotal
      const response = await fetch(API_BASE + '/api/update-card-fee', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: TELEGRAM_ID, cardIds: selectedCards.map(c => c.cardId), newFee: currentFee, additionalCost })
      })
      if (response.ok) {
        setSelectedCards(prev => prev.map(card => ({ ...card, fee: currentFee })))
        setWalletBalance(prev => prev - additionalCost)
        setNeedsConfirmation(false); setMessage({ text: '', type: '' })
      }
    } catch (error) { console.error(error) }
    finally { setIsProcessing(false) }
  }

  const formatNum = (n: number) => n.toString().padStart(2, '0')

  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (timeRemaining / 60) * circumference;
  const timerColor = timeRemaining > 20 ? '#10b981' : timeRemaining > 10 ? '#fbbf24' : '#ef4444';

  return (
    <div className="app-layout">
      <div className="fixed-header">
        <div className="compact-stats-row">
          <div className="mini-stat"><span className="label">ቀሪ ሂሳብ</span><span className="val green">{walletBalance} ETB</span></div>
          <div className="mini-stat"><span className="label">ካርቴላ</span><span className="val blue">{totalCardsSold}</span></div>
          <div className="mini-stat"><span className="label">ሽልማት</span><span className="val purple">{Math.floor(prizePool)} ETB</span></div>
        </div>

        <div className="lobby-header-row">
        <div className="lobby-timer-wrapper">
          <svg className="lobby-timer-svg" viewBox="0 0 50 50">
            <circle className="lobby-timer-bg" cx="25" cy="25" r={radius} />
            <circle
              className="lobby-timer-progress"
              cx="25" cy="25" r={radius}
              style={{ 
                strokeDasharray: `${circumference} ${circumference}`, 
                strokeDashoffset: strokeDashoffset, 
                stroke: timerColor 
              }}
            />
          </svg>
          <div className={`lobby-timer-text ${timeRemaining <= 10 ? 'pulse-urgent' : ''}`} style={{ color: timerColor }}>
            {timeRemaining}s
          </div>
        </div>
        <div className="compact-fee-row">
          <span className="fee-label">Fee:</span>
          <button className="mini-btn" onClick={() => handleFeeChange(-1)} disabled={currentFee === 10 || isProcessing}>-</button>
          <span className="fee-display">{currentFee} ETB</span>
          <button className="mini-btn" onClick={() => handleFeeChange(1)} disabled={currentFee === 50 || isProcessing}>+</button>
        </div>
      </div>

        <div className="selected-numbers-row">
        {message.text && <span className={"inline-notif " + (message.type || '')}>{message.text}</span>}
          {selectedCards.length === 0 ? (
            <span className="empty-text"><span className="gold-hint">እስከ አራት ካርቴላ መምረጥ ይችላሉ:: ጨዋታው በሁለት ዝግ ነው።</span></span>
          ) : (
            selectedCards.map(card => (
              <div key={card.cardId} className="selected-chip">
                #{formatNum(card.cardId)}
                <button onClick={() => handleCardClick(card.cardId)} className="chip-close">×</button>
              </div>
            ))
          )}
          {needsConfirmation && (
            <button className="confirm-inline" onClick={confirmFeeIncrease} disabled={isProcessing}>Confirm</button>
          )}
        </div>
        {message.text && }
      </div>

      <div className="scrollable-grid-area">
        <div className="cards-grid-8-modern">
          {allCards.map(cardNum => {
            const isSelected = selectedCards.some(c => c.cardId === cardNum)
            const isSold = soldCardIds.has(cardNum)
            let cls = 'card-btn-modern'
            if (isSelected) cls += ' selected-user'
            else if (isSold) cls += ' sold'
            
            return (
              <button 
                key={cardNum} 
                className={cls} 
                onClick={() => handleCardClick(cardNum)} 
                disabled={gameState !== 'WAITING' || (isSold && !isSelected)}
              >
                {formatNum(cardNum)}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default Lobby
