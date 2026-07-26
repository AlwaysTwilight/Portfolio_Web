import { useEffect, useState } from 'react'

// ── Shared theme module ──────────────────────────────────────────────────────
// Single source of truth for the 3D room's visual language (colors, fonts,
// glass-panel treatment, motion gating). Pulls from the SAME tokens the
// classic site uses (styles.css --a / --a2, DM Sans / DM Mono) so the 3D room
// never drifts into a second competing design system.

// styles.css dark-mode --a / --a2 (the 3D room is always "dark").
export const C = {
  emerald: 0x10b981,
  cyan: 0x22d3ee,
  emeraldHex: '#10b981',
  cyanHex: '#22d3ee',
  ink: '#fafafa',
  ink2: '#d4d4d8',
  muted: '#a1a1aa',
  panel: 'rgba(14,16,20,0.92)',
  panelSolid: 'rgba(18,20,24,0.96)',
  border: 'rgba(255,255,255,0.10)',
  borderAccent: 'rgba(16,185,129,0.45)',
  accentSoft: 'rgba(16,185,129,0.12)',
  cyanSoft: 'rgba(34,211,238,0.12)',
  // Real loaded font stack (styles.css @import) — DM Sans is prose/UI,
  // DM Mono is the tracked-out uppercase HUD/system-text register.
  font: "'DM Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'DM Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  serif: "'DM Serif Display', ui-serif, Georgia, serif",
  gradient: 'linear-gradient(135deg,#10b981 0%,#22d3ee 100%)',
} as const

// Tracked-out uppercase mono style for HUD / system-log text.
export const hudText: React.CSSProperties = {
  fontFamily: C.mono,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  fontWeight: 500,
}

// Consistent glassmorphism helper — every floating panel/pill/modal in the
// hero + room should route through this so the "glass" reads as one system.
export function glass(opts: {
  strength?: 'light' | 'medium' | 'heavy'
  accent?: boolean
  radius?: number
} = {}): React.CSSProperties {
  const { strength = 'medium', accent = false, radius = 14 } = opts
  const blur = strength === 'light' ? 20 : strength === 'heavy' ? 44 : 30
  const sat = strength === 'light' ? 140 : strength === 'heavy' ? 200 : 170
  return {
    background: strength === 'heavy' ? C.panelSolid : C.panel,
    border: `1px solid ${accent ? C.borderAccent : C.border}`,
    borderRadius: radius,
    backdropFilter: `blur(${blur}px) saturate(${sat}%)`,
    WebkitBackdropFilter: `blur(${blur}px) saturate(${sat}%)`,
    boxShadow: accent
      ? '0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(34,211,238,0.10), 0 0 40px rgba(16,185,129,0.14)'
      : '0 12px 48px rgba(0,0,0,0.45)',
  }
}

// Glass pill (nav pills, HUD chips, buttons).
export function glassPill(active = false): React.CSSProperties {
  return {
    ...glass({ strength: 'light', accent: active, radius: 999 }),
    color: active ? C.emeraldHex : C.ink,
    fontFamily: C.font,
    fontWeight: 600,
    fontSize: '0.82rem',
    padding: '9px 18px',
    cursor: 'pointer',
    userSelect: 'none',
  }
}

// ── Motion gating ────────────────────────────────────────────────────────────

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** React hook: live-updates if the OS setting changes mid-session. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

/** React hook: true while the tab is hidden — gate ambient RAF/CSS-anim loops. */
export function useTabHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  return hidden
}

/** Narrow-viewport check for skipping heavy effects (postprocessing, etc). */
export function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 720
}
