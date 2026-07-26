import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Review } from './reviews'
import { initials } from './reviews'

// Auto-rotating testimonials carousel. Shows 1 / 2 / 3 cards per view depending
// on viewport width, auto-advances every 6s, pauses on hover/focus, supports
// arrows, dots, and touch swipe. Purely presentational — data is passed in.

function useCardsPerView(): number {
  const [n, setN] = useState(() => (typeof window === 'undefined' ? 1 : cardsForWidth(window.innerWidth)))
  useEffect(() => {
    const onResize = () => setN(cardsForWidth(window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return n
}

function cardsForWidth(w: number): number {
  if (w >= 1080) return 3
  if (w >= 720) return 2
  return 1
}

function Stars({ rating }: { rating: number }) {
  if (!rating) return null
  return (
    <div className="rv-stars" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className={i <= rating ? 'rv-star on' : 'rv-star'}>★</span>
      ))}
    </div>
  )
}

function ReviewCardView({ review }: { review: Review }) {
  const role = [review.position, review.company].filter(Boolean).join(' · ')
  return (
    <article className="rv-card">
      <div className="rv-quote-mark" aria-hidden>“</div>
      <Stars rating={review.rating} />
      <p className="rv-text">{review.review_text}</p>
      <div className="rv-person">
        <div className="rv-avatar" aria-hidden>{initials(review.name)}</div>
        <div className="rv-person-meta">
          <div className="rv-name-row">
            <span className="rv-name">{review.name}</span>
            {review.linkedin_url && (
              <a
                className="rv-linkedin"
                href={review.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${review.name} on LinkedIn`}
                title="Verified via LinkedIn"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
                  <path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.4c0-1.3 0-2.95-1.8-2.95s-2.08 1.4-2.08 2.85V21H9z"/>
                </svg>
              </a>
            )}
          </div>
          {role && <span className="rv-role">{role}</span>}
        </div>
      </div>
      {review.endorsed_skills.length > 0 && (
        <div className="rv-endorse-row">
          {review.endorsed_skills.slice(0, 4).map(s => (
            <span className="rv-endorse-chip" key={s}>✓ {s}</span>
          ))}
        </div>
      )}
    </article>
  )
}

export default function ReviewsCarousel({
  reviews,
  endorsements,
}: {
  reviews: Review[]
  endorsements: Record<string, number>
}) {
  const perView = useCardsPerView()
  const [page, setPage] = useState(0)
  const [paused, setPaused] = useState(false)
  const touchStartX = useRef<number | null>(null)

  const pageCount = Math.max(1, Math.ceil(reviews.length / perView))

  // Keep the page in range if perView changes (resize) or list shrinks.
  useEffect(() => {
    setPage(p => Math.min(p, pageCount - 1))
  }, [pageCount])

  const go = useCallback((dir: number) => {
    setPage(p => (p + dir + pageCount) % pageCount)
  }, [pageCount])

  // Auto-advance.
  useEffect(() => {
    if (paused || pageCount <= 1) return
    const t = setInterval(() => setPage(p => (p + 1) % pageCount), 6000)
    return () => clearInterval(t)
  }, [paused, pageCount])

  const topEndorsements = useMemo(
    () =>
      Object.entries(endorsements)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6),
    [endorsements],
  )

  if (reviews.length === 0) return null

  const start = page * perView
  const visible = reviews.slice(start, start + perView)
  // Pad the last page so the grid keeps a stable width.
  const placeholders = perView - visible.length

  return (
    <div className="rv-carousel-wrap">
      {topEndorsements.length > 0 && (
        <div className="rv-endorsements" aria-label="Skill endorsements from reviewers">
          {topEndorsements.map(([skill, count]) => (
            <span className="rv-endorse-agg" key={skill}>
              <strong>{skill}</strong>
              <span className="rv-endorse-count">✓ {count}</span>
            </span>
          ))}
        </div>
      )}

      <div
        className="rv-carousel"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        onTouchStart={e => { touchStartX.current = e.touches[0].clientX }}
        onTouchEnd={e => {
          if (touchStartX.current == null) return
          const dx = e.changedTouches[0].clientX - touchStartX.current
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
          touchStartX.current = null
        }}
      >
        {pageCount > 1 && (
          <button className="rv-arrow rv-arrow--prev" onClick={() => go(-1)} aria-label="Previous reviews" type="button">
            ‹
          </button>
        )}

        <div className="rv-track" style={{ gridTemplateColumns: `repeat(${perView}, 1fr)` }}>
          {visible.map(r => (
            <ReviewCardView key={r.review_id} review={r} />
          ))}
          {Array.from({ length: placeholders }).map((_, i) => (
            <div key={`ph-${i}`} className="rv-card rv-card--ghost" aria-hidden />
          ))}
        </div>

        {pageCount > 1 && (
          <button className="rv-arrow rv-arrow--next" onClick={() => go(1)} aria-label="Next reviews" type="button">
            ›
          </button>
        )}
      </div>

      {pageCount > 1 && (
        <div className="rv-dots" role="tablist" aria-label="Review pages">
          {Array.from({ length: pageCount }).map((_, i) => (
            <button
              key={i}
              className={i === page ? 'rv-dot on' : 'rv-dot'}
              onClick={() => setPage(i)}
              aria-label={`Go to review page ${i + 1}`}
              aria-selected={i === page}
              role="tab"
              type="button"
            />
          ))}
        </div>
      )}
    </div>
  )
}
