import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../usePortfolio'
import { fetchPublicReviews, initials } from '../reviews'
import type { Review } from '../reviews'

// Neural Studio overlays: a Testimonials panel + a Guest Book corkboard, plus a
// lightweight achievements toast system. Rendered as HTML over the 3D canvas so
// the Three.js scene stays untouched. Styling mirrors Scene3D's dark glass panels.

const PANEL = 'rgba(18,20,24,0.96)'
const BORDER = 'rgba(255,255,255,0.1)'
const BORDER_ACCENT = 'rgba(16,185,129,0.4)'
const INK = '#f4f4f7'
const INK2 = '#c4c4d0'
const MUTED = '#8a8aa0'
const EMERALD = '#10b981'
const GRADIENT = 'linear-gradient(135deg,#10b981,#22d3ee)'
const FONT = "'DM Sans', ui-sans-serif, system-ui, sans-serif"

type GuestNote = { note_id: string; name: string; note: string; created_at: string }

const ghostBtn: React.CSSProperties = {
  background: 'rgba(12,14,18,0.7)', border: `1px solid ${BORDER}`, color: INK,
  fontFamily: FONT, fontSize: '0.8rem', fontWeight: 600, padding: '9px 14px',
  cursor: 'pointer', borderRadius: 10, backdropFilter: 'blur(20px) saturate(160%)',
}
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  background: GRADIENT, border: 'none', color: '#04140c', fontFamily: FONT,
  fontSize: '0.82rem', fontWeight: 700, padding: '10px 16px', cursor: 'pointer', borderRadius: 10,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.05)',
  border: `1px solid ${BORDER}`, color: INK, fontFamily: FONT, fontSize: '0.86rem', boxSizing: 'border-box',
}

// ── Achievements ──────────────────────────────────────────────────────────────
export type AchievementId = 'explorer' | 'reviewer' | 'guest' | 'chatter'
const ACHIEVEMENTS: Record<AchievementId, { title: string; desc: string; icon: string }> = {
  explorer: { title: 'Explorer', desc: 'You viewed every project pillar', icon: '🧭' },
  reviewer: { title: 'Kind Words', desc: 'You left Raj a review', icon: '⭐' },
  guest:    { title: 'Signed the Book', desc: 'You left a note in the guest book', icon: '📖' },
  chatter:  { title: 'Curious Mind', desc: 'You chatted with RajBot', icon: '💬' },
}

export function useAchievements() {
  const [unlocked, setUnlocked] = useState<Set<AchievementId>>(new Set())
  const [toast, setToast] = useState<AchievementId | null>(null)
  const unlockedRef = useRef(unlocked)
  unlockedRef.current = unlocked

  const unlock = (id: AchievementId) => {
    if (unlockedRef.current.has(id)) return
    setUnlocked(prev => new Set(prev).add(id))
    setToast(id)
    window.setTimeout(() => setToast(t => (t === id ? null : t)), 4200)
  }
  return { unlocked, toast, unlock }
}

export function AchievementToast({ id }: { id: AchievementId | null }) {
  if (!id) return null
  const a = ACHIEVEMENTS[id]
  return (
    <div style={{
      position: 'absolute', top: 74, left: '50%', transform: 'translateX(-50%)', zIndex: 45,
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
      background: PANEL, border: `1px solid ${BORDER_ACCENT}`, borderRadius: 14,
      backdropFilter: 'blur(28px) saturate(180%)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      fontFamily: FONT, animation: 'rxToastIn .4s cubic-bezier(.2,.8,.2,1)',
    }}>
      <span style={{ fontSize: 26 }}>{a.icon}</span>
      <div>
        <div style={{ fontSize: '0.7rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: EMERALD, fontWeight: 700 }}>Achievement unlocked</div>
        <div style={{ color: INK, fontWeight: 700, fontSize: '0.95rem' }}>{a.title}</div>
        <div style={{ color: MUTED, fontSize: '0.78rem' }}>{a.desc}</div>
      </div>
      <style>{`@keyframes rxToastIn{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}`}</style>
    </div>
  )
}

// ── Testimonials panel ─────────────────────────────────────────────────────────
function TestimonialsPanel({ reviews, onClose }: { reviews: Review[]; onClose: () => void }) {
  return (
    <PanelShell title="Testimonials" onClose={onClose}>
      {reviews.length === 0 ? (
        <p style={{ color: MUTED, fontFamily: FONT, fontSize: '0.88rem' }}>No reviews yet — be the first to leave one.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reviews.map(r => (
            <div key={r.review_id} style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }}>
              {r.rating > 0 && <div style={{ color: '#f59e0b', fontSize: '0.8rem', marginBottom: 4 }}>{'★'.repeat(r.rating)}</div>}
              <p style={{ color: INK2, fontFamily: FONT, fontSize: '0.86rem', lineHeight: 1.55, margin: '0 0 8px' }}>“{r.review_text}”</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.66rem', fontWeight: 700, color: '#04140c', fontFamily: FONT }}>{initials(r.name)}</span>
                <span style={{ color: MUTED, fontFamily: FONT, fontSize: '0.76rem' }}>
                  <strong style={{ color: INK }}>{r.name}</strong>{[r.position, r.company].filter(Boolean).length > 0 ? ` · ${[r.position, r.company].filter(Boolean).join(' · ')}` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <a href="/review?from=3d" target="_blank" rel="noopener noreferrer" style={{ ...primaryBtn, marginTop: 14, width: '100%', textDecoration: 'none' }}>✍️ Leave a review</a>
    </PanelShell>
  )
}

// ── Guest book ──────────────────────────────────────────────────────────────────
function GuestBookPanel({ onClose, onSigned }: { onClose: () => void; onSigned: () => void }) {
  const [notes, setNotes] = useState<GuestNote[]>([])
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/guestbook`)
        if (!res.ok) return
        const data = (await res.json()) as { notes: GuestNote[] }
        if (alive) setNotes(data.notes || [])
      } catch { /* optional */ }
    })()
    return () => { alive = false }
  }, [])

  async function submit() {
    if (website.trim()) return
    if (name.trim().length < 1 || note.trim().length < 2) { setStatus('error'); return }
    setStatus('sending')
    try {
      const res = await fetch(`${API_BASE}/guestbook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), note: note.trim(), website }),
      })
      if (!res.ok) throw new Error()
      setStatus('sent'); setName(''); setNote(''); onSigned()
    } catch { setStatus('error') }
  }

  return (
    <PanelShell title="Guest Book" onClose={onClose}>
      {status === 'sent' ? (
        <p style={{ color: INK2, fontFamily: FONT, fontSize: '0.88rem', lineHeight: 1.5 }}>
          Thanks for signing! Your note will appear on the board once Raj approves it.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={80} style={inputStyle} />
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Leave a note…" maxLength={280} rows={3} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          <input value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
          {status === 'error' && <span style={{ color: '#fca5a5', fontFamily: FONT, fontSize: '0.78rem' }}>Please add your name and a short note.</span>}
          <button onClick={submit} disabled={status === 'sending'} style={{ ...primaryBtn, opacity: status === 'sending' ? 0.5 : 1 }}>
            {status === 'sending' ? 'Pinning…' : '📌 Pin to board'}
          </button>
        </div>
      )}

      {notes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10 }}>
          {notes.map((n, i) => (
            <div key={n.note_id} style={{
              padding: '10px 11px', borderRadius: 4, background: i % 2 ? '#ffe0e6' : '#fff6c8', color: '#3a3320',
              fontFamily: FONT, fontSize: '0.78rem', lineHeight: 1.4, boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
              transform: `rotate(${i % 2 ? 1.3 : -1.4}deg)`,
            }}>
              {n.note}
              <span style={{ display: 'block', marginTop: 6, fontSize: '0.68rem', fontWeight: 700, opacity: 0.65 }}>— {n.name}</span>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  )
}

function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: 'min(440px,92vw)', maxHeight: '78vh', overflowY: 'auto', zIndex: 42,
      background: PANEL, border: `1px solid ${BORDER_ACCENT}`, borderRadius: 16, padding: '20px 22px',
      backdropFilter: 'blur(40px) saturate(190%)', boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(16,185,129,0.14)',
      fontFamily: FONT, animation: 'rxPanelIn .28s cubic-bezier(.2,.8,.2,1)',
    }}>
      <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 12, right: 14, background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', fontSize: 18 }}>✕</button>
      <div style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: EMERALD, fontWeight: 700, marginBottom: 12 }}>{title}</div>
      {children}
      <style>{`@keyframes rxPanelIn{from{opacity:0;transform:translate(-50%,-46%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`}</style>
    </div>
  )
}

// ── Public overlay: HUD buttons + panels ────────────────────────────────────────
export default function RoomExtras({ onReviewerAchievement, onGuestAchievement }: {
  onReviewerAchievement: () => void
  onGuestAchievement: () => void
}) {
  const [open, setOpen] = useState<null | 'reviews' | 'guest'>(null)
  const [reviews, setReviews] = useState<Review[]>([])

  useEffect(() => {
    let alive = true
    void (async () => {
      const data = await fetchPublicReviews()
      if (alive) setReviews(data.reviews)
    })()
    // If the visitor arrives back from leaving a review (?from=3d flow), we can't
    // know for sure — the achievement fires when they open the review link instead.
    return () => { alive = false }
  }, [])

  return (
    <>
      <div style={{ position: 'absolute', bottom: 18, right: 18, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 25 }}>
        <button onClick={() => { setOpen('reviews') }} style={ghostBtn} title="Testimonials">⭐ Testimonials</button>
        <button onClick={() => { setOpen('guest') }} style={ghostBtn} title="Guest book">📖 Guest book</button>
      </div>

      {open === 'reviews' && (
        <TestimonialsPanel
          reviews={reviews}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'guest' && (
        <GuestBookPanel
          onClose={() => setOpen(null)}
          onSigned={onGuestAchievement}
        />
      )}
      {/* Reviewer achievement is triggered when the visitor opens the review page. */}
      <ReviewLinkWatcher onOpen={onReviewerAchievement} />
    </>
  )
}

// Fires the "reviewer" achievement when any /review link inside the room is clicked.
function ReviewLinkWatcher({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('a')
      if (target && target.getAttribute('href')?.startsWith('/review')) onOpen()
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [onOpen])
  return null
}
