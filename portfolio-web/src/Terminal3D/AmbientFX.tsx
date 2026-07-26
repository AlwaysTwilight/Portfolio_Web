import { useMemo } from 'react'
import { useReducedMotion, useTabHidden } from './theme'

// ── Ambient overlay layer ────────────────────────────────────────────────────
// Pure CSS/DOM overlay: film grain, scanlines, a breathing vignette. Cheap
// (no canvas RAF loop — grain is a static repeating data-URI, scanlines are a
// repeating-linear-gradient, the vignette pulse is a CSS keyframe). Gated
// behind prefers-reduced-motion and paused when the tab is hidden, so it never
// competes with the WebGL render loop for frame budget.

// Tiny 64x64 noise tile, generated once and reused as a data URI so there's no
// per-frame canvas redraw cost.
function makeGrainDataUri(): string {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const imgData = ctx.createImageData(size, size)
  for (let i = 0; i < imgData.data.length; i += 4) {
    const v = Math.random() * 255
    imgData.data[i] = v; imgData.data[i + 1] = v; imgData.data[i + 2] = v
    imgData.data[i + 3] = 255
  }
  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

let cachedGrain: string | null = null

interface Props {
  /** Overall opacity multiplier — dial down for the classic site so it never fights text readability. */
  intensity?: number
  /** Skip the scanline layer (mainly for the classic site where it reads as noise, not signal). */
  scanlines?: boolean
}

export default function AmbientFX({ intensity = 1, scanlines = true }: Props) {
  const reduced = useReducedMotion()
  const hidden = useTabHidden()
  const grain = useMemo(() => {
    if (typeof document === 'undefined') return ''
    if (!cachedGrain) cachedGrain = makeGrainDataUri()
    return cachedGrain
  }, [])

  const paused = reduced || hidden

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }} aria-hidden>
      {/* film grain */}
      {grain && (
        <div style={{
          position: 'absolute', inset: -2, backgroundImage: `url(${grain})`,
          backgroundSize: '64px 64px', opacity: 0.07 * intensity, mixBlendMode: 'overlay',
          animation: paused ? 'none' : 'ambGrain 0.5s steps(2) infinite',
        }} />
      )}
      {/* scanlines */}
      {scanlines && (
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0px, rgba(0,0,0,0.14) 1px, transparent 1px, transparent 3px)',
          opacity: 0.12 * intensity, mixBlendMode: 'multiply',
        }} />
      )}
      {/* breathing vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 35%, rgba(2,3,5,0.7) 100%)',
        opacity: paused ? 0.55 * intensity : undefined,
        animation: paused ? 'none' : `ambVignette 12s ease-in-out infinite`,
      }} />
      <style>{`
        @keyframes ambGrain { 0% { transform: translate(0,0) } 50% { transform: translate(-1.5%,1%) } 100% { transform: translate(1%,-1.5%) } }
        @keyframes ambVignette { 0%,100% { opacity: ${0.46 * intensity} } 50% { opacity: ${0.6 * intensity} } }
      `}</style>
    </div>
  )
}
