import { useEffect, useState } from 'react'
import fallbackData from './portfolioFallback.json'

// ── Shared portfolio types (single source of truth for both the classic page
//    and the 3D room, so the two never drift) ────────────────────────────────

export type ExperienceItem = {
  company: string
  role?: string
  dateRange?: string
  summary?: string
  items: string[]
  highlights: string[]
}

export type SkillCategory = { category: string; items: string[] }

export type ProjectCard = {
  id: string
  title: string
  summary: string
  techStack: string[]
  sourcePath?: string
  isVisible?: boolean
  whatItDoes?: string[]
}

export type SocialLinks = { linkedin?: string; github?: string; email?: string }

export type Scheduling = { calLink?: string; enabled?: boolean; headline?: string; subtext?: string }

export type SectionConfig = { id: string; label: string; visible: boolean }

export type PortfolioPayload = {
  profile: {
    name: string
    location: string
    headline: string
    about: string
    eyebrow?: string
    openToWork: boolean
    currentLocation?: string
    desiredLocations?: string[]
    experience: ExperienceItem[]
    skills: SkillCategory[]
    resumeProjects?: string[]
    socialLinks?: SocialLinks
  }
  projects: ProjectCard[]
  scheduling?: Scheduling
  sections?: SectionConfig[]
}

// Bundled snapshot — renders instantly while the backend/DB cold-starts.
export const FALLBACK_PORTFOLIO = fallbackData as unknown as PortfolioPayload

export const API_BASE =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_BASE_URL || 'http://localhost:8000'

// Drop malformed project cards (resume parser sometimes captures a tech-stack
// line as a title with a placeholder summary). Shared by both surfaces.
const PLACEHOLDER_SUMMARY_RE = /upload this project'?s document/i
export function isValidProject(p: { title?: string; summary?: string }): boolean {
  const title = (p.title || '').trim()
  if (!title) return false
  if (PLACEHOLDER_SUMMARY_RE.test(p.summary || '')) return false
  const commaParts = title.split(',').map(s => s.trim()).filter(Boolean)
  if (commaParts.length >= 3) return false
  return true
}

export function cleanProjects(projects: ProjectCard[] | undefined): ProjectCard[] {
  return (projects ?? []).filter(p => p.isVisible !== false && isValidProject(p))
}

/**
 * Shared data hook. Starts from the bundled snapshot so any surface renders full
 * content immediately, then swaps to live `/portfolio` data. Retries every 4s
 * until the backend (which spins down on inactivity) responds.
 */
export function usePortfolio() {
  const [portfolio, setPortfolio] = useState<PortfolioPayload>(FALLBACK_PORTFOLIO)
  const [isLive, setIsLive] = useState(false)

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/portfolio`)
      if (!res.ok) return
      const d = (await res.json()) as PortfolioPayload
      setPortfolio(d)
      setIsLive(true)
    } catch {
      /* keep showing the snapshot */
    }
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (isLive) return
    const t = setInterval(() => { void load() }, 4_000)
    return () => clearInterval(t)
  }, [isLive])

  // Once live, refresh slowly + react to admin BroadcastChannel updates.
  useEffect(() => {
    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('portfolio-updates') : null
    if (bc) bc.onmessage = (e: MessageEvent) => { if (e.data?.type === 'data-updated') void load() }
    const t = setInterval(() => { void load() }, 30_000)
    return () => { bc?.close(); clearInterval(t) }
  }, [])

  return { portfolio, isLive, reload: load }
}
