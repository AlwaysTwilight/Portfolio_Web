// Injects review-aware JSON-LD (structured data) into the page at runtime.
// The static index.html already ships a Person schema; this enriches it with an
// AggregateRating + individual Review nodes once approved reviews are loaded, so
// search engines can surface star ratings. Safe no-op when there are no reviews.
import type { Review } from './reviews'

const SCRIPT_ID = 'ld-json-reviews'
const PERSON_URL = 'https://portfolio-web-five-tawny.vercel.app/'

export function injectReviewSchema(reviews: Review[], personName = 'Raj Sahoo'): void {
  if (typeof document === 'undefined') return

  // Remove any previously injected block so updates stay idempotent.
  document.getElementById(SCRIPT_ID)?.remove()

  const rated = reviews.filter(r => r.rating > 0)
  if (reviews.length === 0) return

  const person: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: personName,
    url: PERSON_URL,
  }

  if (rated.length > 0) {
    const avg = rated.reduce((sum, r) => sum + r.rating, 0) / rated.length
    person.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(avg * 10) / 10,
      reviewCount: rated.length,
      bestRating: 5,
      worstRating: 1,
    }
  }

  person.review = reviews.slice(0, 12).map(r => ({
    '@type': 'Review',
    reviewBody: r.review_text,
    author: {
      '@type': 'Person',
      name: r.name,
      ...(r.position || r.company ? { jobTitle: [r.position, r.company].filter(Boolean).join(', ') } : {}),
    },
    ...(r.rating > 0
      ? { reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 } }
      : {}),
  }))

  const script = document.createElement('script')
  script.id = SCRIPT_ID
  script.type = 'application/ld+json'
  script.text = JSON.stringify(person)
  document.head.appendChild(script)
}
