import { API_BASE } from "./apiBase";
import { useState, useEffect } from 'react'
import Lobby from './Lobby'
import LiveGame from './LiveGame'
import { io } from 'socket.io-client'

const socket = io(API_BASE, { reconnection: true, reconnectionDelay: 1000 })

function App() {
  // Start as null to show the "Connecting..." screen first
  const [gameState, setGameState] = useState<string | null>(null)

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

  // 1. FIRST: Show "Connecting to server..." UI
  if (gameState === null) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh', 
        backgroundColor: '#0f172a', 
        color: '#00ff88', 
        fontSize: '1.5rem',
        fontWeight: 'bold',
        fontFamily: 'sans-serif',
        gap: '15px'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '4px solid rgba(0, 255, 136, 0.3)',
          borderTop: '4px solid #00ff88',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}></div>
        <p>Connecting to server...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // 2. NEXT: Show the actual current state (No frozen lobby flash!)
  return (
    <div className="app-container">
      {gameState === 'CALLING' || gameState === 'COMPLETED' ? (
        <LiveGame />
      ) : (
        <Lobby />
      )}
    </div>
  )
}

export default App
