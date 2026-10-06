import { API_BASE } from "./apiBase";
import { useState, useEffect } from 'react'
import Lobby from './Lobby'
import LiveGame from './LiveGame'
import { io } from 'socket.io-client'

const socket = io(API_BASE, { reconnection: true, reconnectionDelay: 1000 })

function App() {
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

  // ==========================================
  // PREMIUM WELCOME SCREEN
  // ==========================================
  if (gameState === null) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
        overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        {/* CSS Animations */}
        <style>{`
          @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
          }
          @keyframes pulseGlow {
            0%, 100% { box-shadow: 0 0 20px rgba(0, 255, 136, 0.4), inset 0 0 20px rgba(0, 255, 136, 0.2); }
            50% { box-shadow: 0 0 40px rgba(0, 255, 136, 0.8), inset 0 0 30px rgba(0, 255, 136, 0.4); }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>

        {/* Glowing Bingo Ball */}
        <div style={{
          width: '80px', height: '80px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #00ff88 0%, #00b36b 100%)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          animation: 'float 3s ease-in-out infinite, pulseGlow 2s ease-in-out infinite',
          marginBottom: '30px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)'
        }}>
          <span style={{
            fontSize: '2.5rem', fontWeight: '900', color: '#0f172a',
            textShadow: '0 2px 4px rgba(255,255,255,0.3)'
          }}>B</span>
        </div>

        {/* Title */}
        <h1 style={{
          color: '#ffffff', fontSize: '2rem', fontWeight: '800',
          margin: '0 0 10px 0', letterSpacing: '1px',
          textShadow: '0 4px 10px rgba(0,0,0,0.5)',
          animation: 'fadeIn 0.8s ease-out'
        }}>
          DASHEN <span style={{ color: '#00ff88' }}>BINGO</span>
        </h1>

        {/* Subtitle / Status */}
        <p style={{
          color: '#94a3b8', fontSize: '1rem', fontWeight: '500',
          margin: 0, animation: 'fadeIn 1.2s ease-out'
        }}>
          Connecting to server...
        </p>
      </div>
    )
  }

  // ==========================================
  // MAIN APP ROUTING
  // ==========================================
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
