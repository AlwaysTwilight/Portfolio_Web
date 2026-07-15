import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// Fire-and-forget: wake the backend (Render free tier spins down when idle)
// as early as possible so it's warm by the time the user opens the chatbot.
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
fetch(`${API_BASE}/health`).catch(() => {})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
