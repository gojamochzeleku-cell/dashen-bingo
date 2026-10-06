import { API_BASE } from "./apiBase";
import { useState, useEffect } from 'react'
import Lobby from './Lobby'
import LiveGame from './LiveGame'
import Admin from './Admin'
import { io } from 'socket.io-client'

const socket = io(API_BASE, { reconnection: true, reconnectionDelay: 1000 })

function App() {
  const [gameState, setGameState] = useState<string | null>(null)
  const [showAdmin, setShowAdmin] = useState(false)

  useEffect(() => {
    const handleSync = (data: any) => {
      console.log('🔄 [APP] Received Sync State:', data.state)
      setGameState(data.state)
    }
    socket.on('game:sync', handleSync)

    socket.on('game:stats', (data: any) => {
      setGameState(data.state)
    })

    socket.on('game:stateChange', (data: any) => {
      setGameState(data.state)
    })

    return () => {
      socket.off('game:sync', handleSync)
      socket.off('game:stats')
      socket.off('game:stateChange')
    }
  }, [])

  if (showAdmin) {
    return (
      <div style={{ backgroundColor: '#0f172a', minHeight: '100vh' }}>
        <button 
          onClick={() => setShowAdmin(false)}
          style={{
            position: 'absolute', top: '20px', left: '20px',
            background: 'transparent', border: '1px solid #fff', color: '#fff',
            padding: '8px 16px', borderRadius: '6px', cursor: 'pointer'
          }}
        >
          ← Back to Game
        </button>
        <Admin />
      </div>
    )
  }

  if (gameState === null) {
    return (
      <div style={{ 
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', 
        height: '100vh', backgroundColor: '#0f172a', color: '#00ff88', fontSize: '1.5rem', fontWeight: 'bold' 
      }}>
        <div style={{
          width: '40px', height: '40px', border: '4px solid rgba(0, 255, 136, 0.3)',
          borderTop: '4px solid #00ff88', borderRadius: '50%', animation: 'spin 1s linear infinite'
        }}></div>
        <p style={{ marginTop: '20px' }}>Connecting to server...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div className="app-container">
      {gameState === 'CALLING' || gameState === 'COMPLETED' ? (
        <LiveGame />
      ) : (
        <Lobby />
      )}
      
      {/* Hidden Admin Access: Tap the bottom right corner 3 times, or just add a small button */}
      <button 
        onClick={() => setShowAdmin(true)}
        style={{
          position: 'fixed', bottom: '10px', right: '10px',
          background: 'rgba(255,255,255,0.1)', border: 'none', color: 'rgba(255,255,255,0.3)',
          width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', fontSize: '0.7rem'
        }}
        title="Admin Panel"
      >
        ⚙️
      </button>
    </div>
  )
}

export default App
