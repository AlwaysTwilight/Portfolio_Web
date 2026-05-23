import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import AdminPage from './AdminPage'
import PortfolioPage from './PortfolioPage'

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<PortfolioPage />} path="/" />
        <Route element={<AdminPage />} path="/admin" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </BrowserRouter>
  )
}

export default App
