import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Screen =
  | 'BOOT'
  | 'MENU'
  | 'WHO_AM_I'
  | 'PROJECTS'
  | 'PROJECT_DETAIL'
  | 'EXPERIENCE'
  | 'SKILLS'
  | 'RAJBOT'

export type ExperienceItem = {
  company: string
  role?: string
  dateRange?: string
  items: string[]
  highlights: string[]
}

export type SkillCategory = {
  category: string
  items: string[]
}

export type ProjectCard = {
  id: string
  title: string
  summary: string
  techStack: string[]
}

export type PortfolioData = {
  profile: {
    name: string
    location: string
    headline: string
    about: string
    openToWork: boolean
    currentLocation?: string
    experience: ExperienceItem[]
    skills: SkillCategory[]
  }
  projects: ProjectCard[]
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

// ── Hook ──────────────────────────────────────────────────────────────────────

const API_BASE = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_BASE_URL || 'http://localhost:8000'

export function useTerminal() {
  const [screen, setScreen]       = useState<Screen>('BOOT')
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
  const [bootDone, setBootDone]   = useState(false)
  const [activeProject, setActiveProject] = useState<ProjectCard | null>(null)
  const [chatHistory, setChatHistory]     = useState<ChatMessage[]>([])
  const [chatThinking, setChatThinking]   = useState(false)

  // ── Fetch portfolio on mount ──
  useEffect(() => {
    fetch(`${API_BASE}/portfolio`)
      .then(r => r.json())
      .then(d => setPortfolio(d as PortfolioData))
      .catch(() => {/* continue without data */})
  }, [])

  // ── Auto-advance from BOOT → MENU after boot anim ──
  const onBootComplete = useCallback(() => {
    setBootDone(true)
    setTimeout(() => setScreen('MENU'), 600)
  }, [])

  // ── Navigation ──
  const go = useCallback((s: Screen) => {
    if (s === 'RAJBOT' && chatHistory.length === 0) {
      setChatHistory([{
        role: 'assistant',
        content: "RAJ-BOT ONLINE. I'm Raj's AI assistant — ask me anything about his projects, experience, or skills. I answer from real project documents.",
      }])
    }
    setScreen(s)
  }, [chatHistory.length])

  const back = useCallback(() => {
    if (screen === 'PROJECT_DETAIL') { setActiveProject(null); setScreen('PROJECTS'); return }
    setScreen('MENU')
  }, [screen])

  const openProject = useCallback((p: ProjectCard) => {
    setActiveProject(p)
    setScreen('PROJECT_DETAIL')
  }, [])

  // ── Chat ──
  const sendChat = useCallback(async (message: string) => {
    if (!message.trim() || chatThinking) return
    const userMsg: ChatMessage = { role: 'user', content: message }
    setChatHistory(prev => [...prev, userMsg])
    setChatThinking(true)
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: chatHistory.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json() as { answer?: string; detail?: string }
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: data.answer || data.detail || 'Unable to respond.',
      }])
    } catch {
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: 'CONNECTION ERROR — check backend.',
      }])
    } finally {
      setChatThinking(false)
    }
  }, [chatHistory, chatThinking])

  return {
    screen,
    portfolio,
    bootDone,
    activeProject,
    chatHistory,
    chatThinking,
    onBootComplete,
    go,
    back,
    openProject,
    sendChat,
  }
}
