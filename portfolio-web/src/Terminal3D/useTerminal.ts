import { useState, useEffect, useCallback } from 'react'
import { usePortfolio, cleanProjects, API_BASE } from '../usePortfolio'
import type { PortfolioPayload, ProjectCard } from '../usePortfolio'

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

// Re-export shared types so Scene3D keeps importing them from here.
export type {
  ExperienceItem,
  SkillCategory,
  ProjectCard,
  PortfolioPayload as PortfolioData,
} from '../usePortfolio'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTerminal() {
  const [screen, setScreen]       = useState<Screen>('BOOT')
  const [bootDone, setBootDone]   = useState(false)
  const [activeProject, setActiveProject] = useState<ProjectCard | null>(null)
  const [chatHistory, setChatHistory]     = useState<ChatMessage[]>([])
  const [chatThinking, setChatThinking]   = useState(false)

  // Same data source as the classic page: instant snapshot, then live swap.
  const { portfolio: rawPortfolio, isLive } = usePortfolio()
  // Present the same clean, filtered project set the classic page shows.
  const portfolio: PortfolioPayload = {
    ...rawPortfolio,
    projects: cleanProjects(rawPortfolio.projects),
  }

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
        content: isLive
          ? 'Connection error — please try again.'
          : "I'm just waking up the server (it sleeps when idle). Give me ~30s and ask again.",
      }])
    } finally {
      setChatThinking(false)
    }
  }, [chatHistory, chatThinking, isLive])

  return {
    screen,
    portfolio,
    isLive,
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
