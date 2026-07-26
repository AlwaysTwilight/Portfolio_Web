// Shared types + API helpers for the reviews / testimonials feature.
// Kept separate so PortfolioPage, ReviewPage, the carousel, and the 3D room
// all consume the same shapes and never drift.
import { API_BASE } from './usePortfolio'

export type Review = {
  review_id: string
  name: string
  position: string
  company: string
  review_text: string
  rating: number
  linkedin_url: string
  endorsed_skills: string[]
  status: string
  created_at: string
  approved_at?: string | null
}

export type PublicReviews = {
  reviews: Review[]
  endorsements: Record<string, number>
}

export type ReviewSubmission = {
  name: string
  position: string
  review_text: string
  company?: string
  rating?: number
  linkedin_url?: string
  endorsed_skills?: string[]
  website?: string // honeypot
}

export async function fetchPublicReviews(): Promise<PublicReviews> {
  try {
    const res = await fetch(`${API_BASE}/reviews`)
    if (!res.ok) return { reviews: [], endorsements: {} }
    return (await res.json()) as PublicReviews
  } catch {
    return { reviews: [], endorsements: {} }
  }
}

export async function submitReview(payload: ReviewSubmission): Promise<{ ok: boolean; stored: boolean }> {
  const res = await fetch(`${API_BASE}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as { ok: boolean; stored: boolean }
}

// Fire-and-forget analytics. Never throws, never blocks the UI.
export function trackEvent(eventType: string, target = ''): void {
  try {
    void fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: eventType, target }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}
