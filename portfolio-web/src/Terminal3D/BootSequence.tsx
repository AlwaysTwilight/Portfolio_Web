import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { C, hudText } from './theme'

// ── Boot sequence ────────────────────────────────────────────────────────────
// Full-screen curtain shown while real assets (robot_mascot.glb) load. The
// percentage is tied to the REAL GLTFLoader progress passed in via
// `progress` (0-100) — it is not a disconnected fake timer. Once progress
// hits 100 AND a minimum readable duration has elapsed, the curtain hard-fades
// out (gsap opacity 1→0, ~0.6s ease-out) to reveal the hero underneath.

const STATUS_LINES = [
  'INITIALIZING NEURAL STUDIO',
  'LOADING AVATAR RIG',
  'CALIBRATING SCENE',
  'READY',
]

interface Props {
  progress: number // 0-100, real load progress
  onDone: () => void
}

export default function BootSequence({ progress, onDone }: Props) {
  const [lineIdx, setLineIdx] = useState(0)
  const [exiting, setExiting] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(false)
  const mountedAt = useRef(performance.now())

  // Cycle status lines on a timer, but pin to "READY" once progress completes.
  useEffect(() => {
    if (progress >= 100) { setLineIdx(STATUS_LINES.length - 1); return }
    const id = setInterval(() => {
      setLineIdx(i => (i + 1) % (STATUS_LINES.length - 1))
    }, 480)
    return () => clearInterval(id)
  }, [progress])

  // Fire the curtain fade once real loading is done AND a minimum
  // ~1.4s has elapsed (so it never flashes for fallback/cached-fast loads).
  useEffect(() => {
    if (progress < 100 || doneRef.current) return
    const elapsed = performance.now() - mountedAt.current
    const wait = Math.max(0, 1400 - elapsed)
    const t = setTimeout(() => {
      doneRef.current = true
      setExiting(true)
      const el = rootRef.current
      if (el) {
        gsap.to(el, { opacity: 0, duration: 0.6, ease: 'power2.out', onComplete: onDone })
      } else {
        onDone()
      }
    }, wait)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress])

  const pct = Math.round(Math.max(6, Math.min(100, progress)))

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute', inset: 0, zIndex: 80, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 26, background: '#05070a', color: C.ink,
        pointerEvents: exiting ? 'none' : 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{ ...hudText, fontSize: '0.78rem', color: C.emeraldHex }}>NEURAL_STUDIO</span>
        <span style={{ ...hudText, fontSize: '0.78rem', color: C.muted, letterSpacing: '0.1em' }}>v1.0</span>
      </div>

      <div style={{ fontFamily: C.mono, fontSize: 'clamp(2.6rem,9vw,4.4rem)', fontWeight: 500, letterSpacing: '0.02em', lineHeight: 1 }}>
        {pct}<span style={{ color: C.emeraldHex }}>%</span>
      </div>

      <div style={{ width: 'min(320px,70vw)', height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: C.gradient, transition: 'width .25s ease', borderRadius: 2 }} />
      </div>

      <div style={{ ...hudText, fontSize: '0.72rem', color: C.muted, height: 16 }}>
        {STATUS_LINES[lineIdx]}
      </div>
    </div>
  )
}
