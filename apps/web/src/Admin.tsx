import { useState } from 'react'
import { API_BASE } from './apiBase'

export default function Admin() {
  const [botCount, setBotCount] = useState(30)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const handleUpdate = async () => {
    if (botCount < 0 || botCount > 200) {
      setMessage('❌ Count must be between 0 and 200')
      return
    }
    
    setLoading(true)
    setMessage('⏳ Updating...')
    
    try {
      const response = await fetch(`${API_BASE}/api/admin/set-bot-count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: botCount })
      })
      
      const data = await response.json()
      
      if (response.ok) {
        setMessage(`✅ Success! Next lobby will have ${data.currentCount} bots.`)
      } else {
        setMessage(`❌ Error: ${data.error}`)
      }
    } catch (error) {
      setMessage('❌ Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ 
      padding: '20px', 
      maxWidth: '400px', 
      margin: '0 auto', 
      fontFamily: 'system-ui, sans-serif',
      color: '#fff',
      textAlign: 'center'
    }}>
      <h2 style={{ color: '#00ff88' }}>🤖 Admin Bot Control</h2>
      <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Set the number of bot players for the next lobby.</p>
      
      <div style={{ margin: '20px 0' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Target Bot Count:</label>
        <input 
          type="number" 
          value={botCount} 
          onChange={(e) => setBotCount(parseInt(e.target.value) || 0)}
          min="0" 
          max="200"
          style={{
            width: '100%', padding: '12px', fontSize: '1.2rem', borderRadius: '8px',
            border: '2px solid #00ff88', backgroundColor: '#1e293b', color: '#fff', textAlign: 'center', outline: 'none'
          }}
        />
      </div>

      <button 
        onClick={handleUpdate}
        disabled={loading}
        style={{
          width: '100%', padding: '14px', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '8px',
          border: 'none', backgroundColor: loading ? '#475569' : '#00ff88', color: '#0f172a',
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
      >
        {loading ? 'Updating...' : 'Update Bot Count'}
      </button>

      {message && (
        <div style={{ 
          marginTop: '20px', padding: '12px', borderRadius: '8px', 
          backgroundColor: message.includes('Success') ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 77, 77, 0.1)',
          color: message.includes('Success') ? '#00ff88' : '#ff4d4d',
          border: `1px solid ${message.includes('Success') ? '#00ff88' : '#ff4d4d'}`
        }}>
          {message}
        </div>
      )}
    </div>
  )
}
