import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import AdminPage from './AdminPage'
import PortfolioPage from './PortfolioPage'

function App() {
  const mode = (import.meta.env.VITE_APP_MODE || 'portfolio').toLowerCase()
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        {mode === 'admin' ? (
          <>
            <Route element={<AdminPage />} path="/" />
            <Route element={<Navigate replace to="/" />} path="*" />
          </>
        ) : (
          <>
            <Route element={<PortfolioPage />} path="/" />
            <Route element={<Navigate replace to="/" />} path="*" />
          </>
        )}
      </Routes>
    </BrowserRouter>
  )
}

export default App
