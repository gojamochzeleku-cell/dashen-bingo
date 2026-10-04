import { API_BASE } from "./apiBase";
import { useState, useEffect } from 'react'
import Lobby from './Lobby'
import LiveGame from './LiveGame'
import { io } from 'socket.io-client'

const socket = io(API_BASE)

function App() {
  // Default to WAITING, but this will update instantly on connect
  const [gameState, setGameState] = useState('WAITING')

  useEffect(() => {
    // 1. Listen for the immediate sync when connecting
    socket.on('game:sync', (data) => {
      console.log('Received Sync State:', data.state)
      setGameState(data.state)
    })

    // 2. Listen for live updates
    socket.on('game:stats', (data) => {
      setGameState(data.state)
    })

    socket.on('game:stateChange', (data) => {
      setGameState(data.state)
    })

    // Cleanup listeners
    return () => {
      socket.off('game:sync')
      socket.off('game:stats')
      socket.off('game:stateChange')
    }
  }, [])

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
