import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { API_BASE } from './usePortfolio'
import { submitReview } from './reviews'

// Public "leave a review" page (route: /review). Reviews are hidden until Raj
// approves them, so we say so up front. Skills to endorse are pulled live from
// the portfolio so the list always matches the site.

type SkillGroup = { category: string; items: string[] }

export default function ReviewPage() {
  const [params] = useSearchParams()
  const [skills, setSkills] = useState<string[]>([])

  const [name, setName] = useState('')
  const [position, setPosition] = useState('')
  const [company, setCompany] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [text, setText] = useState('')
  const [endorsed, setEndorsed] = useState<Set<string>>(new Set())
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  // Pre-fill from the chat handoff (?from=chat) — a friendly nudge, nothing more.
  useEffect(() => {
    if (params.get('from') === 'chat' && !text) {
      setText("I recently explored Raj's portfolio and chatbot — ")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load live skills for the endorsement chips.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/portfolio`)
        if (!res.ok) return
        const data = (await res.json()) as { skills?: SkillGroup[] }
        if (!alive) return
        const flat = (data.skills ?? []).flatMap(g => g.items).filter(Boolean)
        // De-dup, keep order, cap the list so it isn't overwhelming.
        setSkills(Array.from(new Set(flat)).slice(0, 24))
      } catch {
        /* skills are optional */
      }
    })()
    return () => { alive = false }
  }, [])

  const canSubmit = useMemo(
    () => name.trim().length > 0 && position.trim().length > 0 && text.trim().length >= 10 && status !== 'sending',
    [name, position, text, status],
  )

  function toggleSkill(skill: string) {
    setEndorsed(prev => {
      const next = new Set(prev)
      if (next.has(skill)) next.delete(skill)
      else if (next.size < 12) next.add(skill)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (website.trim()) return // bot
    if (!canSubmit) {
      setError('Please add your name, role, and a review of at least 10 characters.')
      return
    }
    setStatus('sending')
    try {
      await submitReview({
        name: name.trim(),
        position: position.trim(),
        company: company.trim(),
        linkedin_url: linkedin.trim(),
        rating,
        review_text: text.trim(),
        endorsed_skills: Array.from(endorsed),
        website,
      })
      setStatus('sent')
    } catch {
      setStatus('error')
      setError('Something went wrong. Please try again in a moment.')
    }
  }

  return (
    <div className="app" data-theme="dark">
      <div className="ambient" aria-hidden>
        <div className="amb-blob amb-blob--1" />
        <div className="amb-blob amb-blob--2" />
        <div className="grid-overlay" />
      </div>

      <header className="nav" role="banner">
        <div className="nav-inner">
          <Link className="nav-logo" to="/">
            <span className="logo-bracket">&lt;</span>
            <span className="logo-name">RS</span>
            <span className="logo-bracket">/&gt;</span>
          </Link>
          <nav className="nav-links">
            <Link className="nav-pill" to="/">← back to portfolio</Link>
          </nav>
        </div>
      </header>

      <main className="rvp-main">
        {status === 'sent' ? (
          <section className="rvp-card rvp-success">
            <div className="rvp-success-icon" aria-hidden>✓</div>
            <h1 className="rvp-title">Thank you!</h1>
            <p className="rvp-sub">
              Your review has been sent to Raj for a quick check. Once approved, it'll appear on the
              portfolio and in the 3D room. Really appreciate you taking the time.
            </p>
            <Link className="btn-primary" to="/">Back to portfolio</Link>
          </section>
        ) : (
          <section className="rvp-card">
            <span className="rvp-eyebrow">Leave a review</span>
            <h1 className="rvp-title">Worked with Raj? Share a few words.</h1>
            <p className="rvp-sub">
              Reviews are checked before they go live — nothing appears publicly until Raj approves it.
            </p>

            <form className="rvp-form" onSubmit={handleSubmit} noValidate>
              <div className="rvp-grid">
                <label className="rvp-field">
                  <span className="rvp-label">Your name<i>*</i></span>
                  <input className="rvp-input" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="Jane Doe" required />
                </label>
                <label className="rvp-field">
                  <span className="rvp-label">Role / position<i>*</i></span>
                  <input className="rvp-input" value={position} onChange={e => setPosition(e.target.value)} maxLength={120} placeholder="Engineering Manager" required />
                </label>
                <label className="rvp-field">
                  <span className="rvp-label">Company <em>(optional)</em></span>
                  <input className="rvp-input" value={company} onChange={e => setCompany(e.target.value)} maxLength={120} placeholder="Acme Inc." />
                </label>
                <label className="rvp-field">
                  <span className="rvp-label">LinkedIn <em>(optional, helps verify you)</em></span>
                  <input className="rvp-input" value={linkedin} onChange={e => setLinkedin(e.target.value)} maxLength={200} placeholder="https://linkedin.com/in/…" type="url" />
                </label>
              </div>

              <div className="rvp-field">
                <span className="rvp-label">Rating <em>(optional)</em></span>
                <div className="rvp-stars-input" onMouseLeave={() => setHoverRating(0)}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <button
                      key={i}
                      type="button"
                      className={(hoverRating || rating) >= i ? 'rvp-star on' : 'rvp-star'}
                      onMouseEnter={() => setHoverRating(i)}
                      onClick={() => setRating(r => (r === i ? 0 : i))}
                      aria-label={`${i} star${i > 1 ? 's' : ''}`}
                    >
                      ★
                    </button>
                  ))}
                  {rating > 0 && <button type="button" className="rvp-clear" onClick={() => setRating(0)}>clear</button>}
                </div>
              </div>

              <label className="rvp-field">
                <span className="rvp-label">Your review<i>*</i></span>
                <textarea
                  className="rvp-textarea"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  maxLength={2000}
                  rows={5}
                  placeholder="What was it like working with Raj? What did he build or help with?"
                  required
                />
                <span className="rvp-count">{text.length}/2000</span>
              </label>

              {skills.length > 0 && (
                <div className="rvp-field">
                  <span className="rvp-label">Endorse skills <em>(optional — tap any you'd vouch for)</em></span>
                  <div className="rvp-skill-chips">
                    {skills.map(skill => (
                      <button
                        key={skill}
                        type="button"
                        className={endorsed.has(skill) ? 'rvp-skill-chip on' : 'rvp-skill-chip'}
                        onClick={() => toggleSkill(skill)}
                        aria-pressed={endorsed.has(skill)}
                      >
                        {endorsed.has(skill) ? '✓ ' : ''}{skill}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Honeypot — visually hidden, ignored by humans. */}
              <input
                className="rvp-honeypot"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={e => setWebsite(e.target.value)}
                aria-hidden
              />

              {error && <p className="rvp-error">{error}</p>}

              <button className="btn-primary rvp-submit" type="submit" disabled={!canSubmit}>
                {status === 'sending' ? 'Sending…' : 'Submit review'}
              </button>
            </form>
          </section>
        )}
      </main>
    </div>
  )
}
