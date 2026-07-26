import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { ChatMessage, PortfolioData, ProjectCard } from './useTerminal'
import { AudioManager } from './audio'
import { API_BASE } from '../usePortfolio'
import TerminalWindow from '../TerminalWindow'
import { fetchPublicReviews, initials } from '../reviews'
import type { Review } from '../reviews'

/**
 * THE STUDIO — a single interactive 3D desk scene (GROWON-style signature scene).
 *
 * A fixed cinematic camera frames a desk. Every prop on it is clickable:
 * some are hidden doorways into a portfolio page (monitor -> Work folders,
 * notebook -> About, mug -> Contact), some are playful visual twists (lamp
 * day/night, record player glow, pencil falls off the desk), some are just
 * decoration (chair, plant). RajBot lives in one shared terminal-styled chat
 * window (also used on the classic site) — no 3D avatar.
 */

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
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
  font: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  gradient: 'linear-gradient(135deg,#10b981 0%,#22d3ee 100%)',
}

interface Props {
  portfolio: PortfolioData | null
  chatHistory: ChatMessage[]
  chatThinking: boolean
  sendChat: (msg: string) => void
  onExitClassic: () => void
}

const DESK_MODEL = {
  desk: '/models/desk/desk.glb',
  lamp: '/models/desk/lamp.glb',
  keyboard: '/models/desk/keyboard.glb',
  mouse: '/models/desk/mouse.glb',
  plant: '/models/desk/plant.glb',
  notebook: '/models/desk/notebook.glb',
  mug: '/models/desk/mug.glb',
} as const
const ROBOT_URL = '/models/robot_mascot.glb'

const RESUME_URL = '/Raj_Sahoo_Resume.pdf'

type Overlay = 'work' | 'about' | 'contact' | 'guestbook' | null

// ── math helpers ─────────────────────────────────────────────────────────────
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const eio = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// Accepts "raj-sahoo", "cal.com/raj-sahoo", or a full https URL and returns a usable URL.
function normalizeCalUrl(raw: string): string {
  const v = (raw || '').trim().replace(/^@/, '')
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  if (/^cal\.com\//i.test(v) || v.includes('calendly.com')) return `https://${v}`
  return `https://cal.com/${v}`
}

function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch { return false }
}

// ── material helpers ─────────────────────────────────────────────────────────
const std = (color: number, roughness = 0.6, metalness = 0.2, emissive?: number, ei = 1) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness })
  if (emissive !== undefined) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = ei }
  return m
}
function rbox(w: number, h: number, d: number, mat: THREE.Material, r = 0.05) {
  const rad = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.max(0.004, rad)), mat)
}

// Rescale a loaded model to a target height, recenter it on X/Z, and drop its
// base to y=0 — so callers can just set group.position and stack things by
// world-space surface height, regardless of how the source asset was authored.
function normalizeModel(root: THREE.Object3D, targetHeight: number) {
  const bb = new THREE.Box3().setFromObject(root)
  const sz = bb.getSize(new THREE.Vector3())
  const scale = targetHeight / Math.max(sz.y, 0.0001)
  root.scale.setScalar(scale)
  const bb2 = new THREE.Box3().setFromObject(root)
  const c = bb2.getCenter(new THREE.Vector3())
  root.position.x -= c.x; root.position.z -= c.z; root.position.y -= bb2.min.y
  const sz2 = bb2.getSize(new THREE.Vector3())
  return { width: sz2.x, depth: sz2.z, height: sz2.y }
}

// ── procedural gaming chair (no free CC0 gaming-chair asset exists — built by
// hand: bucket seat, side bolsters, headrest, 5-star wheel base) ─────────────
function buildGamingChair(): THREE.Group {
  const group = new THREE.Group()
  // True near-black, distinctly darker than the desk's graphite tone, with a
  // bright accent so the silhouette still reads clearly against a dark room.
  const body = std(0x0c0d10, 0.5, 0.15)
  const accent = std(0x0a0b0d, 0.6, 0.5, C.emerald, 1.6)

  // 5-star wheel base
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), std(0x2a2d33, 0.4, 0.6))
  hub.position.y = 0.05; group.add(hub)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const spoke = rbox(0.22, 0.025, 0.04, std(0x1c1e23, 0.5, 0.4), 0.012)
    spoke.position.set(Math.cos(a) * 0.12, 0.045, Math.sin(a) * 0.12)
    spoke.rotation.y = -a
    group.add(spoke)
    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), std(0x0c0d10, 0.5, 0.2))
    wheel.position.set(Math.cos(a) * 0.21, 0.028, Math.sin(a) * 0.21)
    group.add(wheel)
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.32, 12), std(0x2a2d33, 0.4, 0.65))
  pole.position.y = 0.22; group.add(pole)

  // seat
  const seat = rbox(0.42, 0.09, 0.4, body, 0.05)
  seat.position.y = 0.42; group.add(seat)
  const seatPad = rbox(0.36, 0.02, 0.34, accent, 0.04)
  seatPad.position.y = 0.47; group.add(seatPad)

  // backrest with side bolsters — the shape that reads as "gaming chair".
  // Kept lower than a real gaming chair so it doesn't block the desk/monitor
  // from the fixed camera angle.
  const back = new THREE.Group(); back.position.set(0, 0.46, -0.18); back.rotation.x = -0.12
  const backPanel = rbox(0.4, 0.48, 0.09, body, 0.06)
  backPanel.position.y = 0.24; back.add(backPanel)
  ;[-1, 1].forEach(side => {
    const bolster = rbox(0.07, 0.46, 0.1, body, 0.04)
    bolster.position.set(side * 0.19, 0.24, 0.01)
    back.add(bolster)
    const stripe = rbox(0.02, 0.38, 0.02, accent, 0.01)
    stripe.position.set(side * 0.155, 0.24, 0.06)
    back.add(stripe)
  })
  const headrest = rbox(0.26, 0.14, 0.09, body, 0.05)
  headrest.position.set(0, 0.52, 0.02); headrest.rotation.x = 0.18; back.add(headrest)
  group.add(back)

  // armrests
  ;[-1, 1].forEach(side => {
    const post = rbox(0.035, 0.16, 0.035, std(0x2a2d33, 0.4, 0.6), 0.01)
    post.position.set(side * 0.22, 0.35, 0.08); group.add(post)
    const pad = rbox(0.09, 0.03, 0.22, body, 0.02)
    pad.position.set(side * 0.22, 0.435, 0.06); group.add(pad)
  })

  group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  return group
}

// ── procedural curved monitor (no free curved-monitor asset either — a bent
// screen segment reads unmistakably as "curved", which the flat Kenney
// monitor never could) ────────────────────────────────────────────────────
function buildCurvedMonitor(width: number, height: number): { group: THREE.Group; screenMat: THREE.MeshBasicMaterial } {
  const theta = 0.62
  const radius = width / theta

  // A CylinderGeometry's origin is its central AXIS, not the visible curved
  // surface — the surface sits a full `radius` away from it. Build the arc in
  // its own group, rotate it, then recenter X/Z on its real bounding box so
  // the surface (not empty air a meter off to the side) ends up at the origin
  // the caller positions.
  const raw = new THREE.Group()
  const bezel = new THREE.Mesh(
    new THREE.CylinderGeometry(radius + 0.012, radius + 0.012, height + 0.035, 40, 1, true, -theta / 2, theta),
    std(0x22252b, 0.5, 0.35),
  )
  raw.add(bezel)

  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 300
  const cx = cv.getContext('2d')!
  cx.fillStyle = '#0b1020'; cx.fillRect(0, 0, 512, 300)
  cx.fillStyle = '#10b981'; cx.fillRect(0, 0, 512, 26)
  cx.fillStyle = 'rgba(34,211,238,0.55)'
  for (let i = 0; i < 7; i++) cx.fillRect(24, 56 + i * 30, 130 + Math.sin(i * 1.3) * 90 + 90, 10)
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
  const screenMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  const screen = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 40, 1, true, -theta / 2, theta), screenMat)
  raw.add(screen)

  // No extra rotation here: a CylinderGeometry arc centered on thetaStart =
  // -theta/2 already has its midpoint facing local +Z by default, which is
  // exactly "toward the camera" in this scene — the previous 90° spin turned
  // the screen to face sideways instead.
  const bb = new THREE.Box3().setFromObject(raw)
  const c = bb.getCenter(new THREE.Vector3())
  raw.position.x -= c.x; raw.position.z -= c.z

  const group = new THREE.Group()
  group.add(raw)

  const standDrop = 0.2
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, standDrop * 0.75, 12), std(0x2a2d33, 0.45, 0.6))
  neck.position.set(0, -height / 2 - standDrop * 0.42, 0.03); group.add(neck)
  const base = rbox(0.24, 0.02, 0.16, std(0x22252b, 0.5, 0.45), 0.02)
  base.position.set(0, -height / 2 - standDrop + 0.01, 0.03); group.add(base)

  group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  return { group, screenMat }
}

// ── procedural digital desk clock (real time, redrawn once a minute) ────────
function buildDigitalClock(): { group: THREE.Group; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture } {
  const group = new THREE.Group()
  const body = rbox(0.14, 0.05, 0.05, std(0x1c1e23, 0.5, 0.3), 0.012)
  body.position.y = 0.025; group.add(body)
  const cv = document.createElement('canvas'); cv.width = 200; cv.height = 100
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#050705'; ctx.fillRect(0, 0, 200, 100)
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.032), new THREE.MeshBasicMaterial({ map: tex }))
  screen.position.set(0, 0.033, 0.026); group.add(screen)
  group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true })
  return { group, ctx, tex }
}

// ── procedural headphone stand + headphones ─────────────────────────────────
function buildHeadphoneStand(): THREE.Group {
  const group = new THREE.Group()
  const metal = std(0x2a2d33, 0.4, 0.6)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.012, 20), std(0x1c1e23, 0.5, 0.4))
  base.position.y = 0.006; group.add(base)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.22, 12), metal)
  pole.position.y = 0.12; group.add(pole)
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 8, 20, Math.PI), metal)
  hook.position.y = 0.23; hook.rotation.z = Math.PI; group.add(hook)

  // headphones hanging on the hook
  const cans = new THREE.Group(); cans.position.y = 0.185
  const cupMat = std(0x0e0f12, 0.5, 0.2, C.emerald, 0.5)
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 8, 20, Math.PI), std(0x14151a, 0.5, 0.2))
  band.rotation.z = Math.PI; cans.add(band)
  ;[-1, 1].forEach(side => {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.022, 16), cupMat)
    cup.rotation.z = Math.PI / 2
    cup.position.set(side * 0.052, -0.01, 0)
    cans.add(cup)
  })
  group.add(cans)

  group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  return group
}

// ── procedural guest book — a small maroon journal + pen, distinct from the
// emerald "about" notebook — opens the reviews/testimonials panel ──────────
function buildGuestbook(): THREE.Group {
  const group = new THREE.Group()
  const cover = rbox(0.09, 0.014, 0.12, std(0x5c1f24, 0.55, 0.1), 0.008)
  cover.position.y = 0.007; group.add(cover)
  const pages = rbox(0.084, 0.01, 0.112, std(0xf1ece0, 0.7, 0), 0.006)
  pages.position.y = 0.0155; group.add(pages)
  const spine = rbox(0.014, 0.016, 0.12, std(0x431217, 0.55, 0.1), 0.006)
  spine.position.set(-0.045, 0.008, 0); group.add(spine)
  const pen = new THREE.Group()
  const penBody = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 8), std(0xd4af37, 0.4, 0.6))
  penBody.rotation.z = Math.PI / 2; pen.add(penBody)
  const penTip = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.014, 8), std(0x2b2b2b, 0.5, 0.2))
  penTip.rotation.z = -Math.PI / 2; penTip.position.set(0.057, 0, 0); pen.add(penTip)
  pen.position.set(0.01, 0.023, 0.02); pen.rotation.y = 0.3
  group.add(pen)
  group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  return group
}

// Every clickable desk prop is tagged with one of these on its meshes' userData.
type PropKind = 'lamp' | 'monitor' | 'notebook' | 'mug' | 'record' | 'pencil' | 'chair' | 'plant' | 'robot' | 'guestbook'

// Labels for the keyboard-accessible object list — one real, focusable button
// per clickable prop, since a WebGL canvas has no native tab targets.
const KEYBOARD_PROPS: { kind: PropKind; label: string }[] = [
  { kind: 'monitor', label: 'Monitor — open Work' },
  { kind: 'notebook', label: 'Notebook — open About' },
  { kind: 'mug', label: 'Mug — open Contact' },
  { kind: 'guestbook', label: 'Guest book — reviews' },
  { kind: 'robot', label: 'Robot — chat with RajBot' },
  { kind: 'lamp', label: 'Lamp — toggle day/night' },
  { kind: 'record', label: 'Record player — toggle music' },
  { kind: 'pencil', label: 'Pencil — knock it off the desk' },
  { kind: 'chair', label: 'Chair (decorative)' },
  { kind: 'plant', label: 'Plant (decorative)' },
]

export default function Scene3D({ portfolio, chatHistory, chatThinking, sendChat, onExitClassic }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'loading' | 'intro' | 'idle'>('loading')
  const [progress, setProgress] = useState(0)
  const [unsupported, setUnsupported] = useState(false)
  const [muted, setMuted] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [speech, setSpeech] = useState('')
  const [overlay, setOverlay] = useState<Overlay>(null)
  // Starts in bright "day" mode (lamp off) so the room is immediately
  // legible; clicking the lamp swaps to a moodier lamp-lit night look.
  const [lampOn, setLampOn] = useState(false)
  const [playing, setPlaying] = useState(false)

  const modeRef = useRef(mode); modeRef.current = mode
  const mutedRef = useRef(muted); mutedRef.current = muted
  const audioRef = useRef<AudioManager | null>(null)
  const lampOnRef = useRef(lampOn); lampOnRef.current = lampOn
  const playingRef = useRef(playing); playingRef.current = playing
  const overlayRef = useRef<Overlay>(null); overlayRef.current = overlay
  const onPropClickRef = useRef<((kind: PropKind) => void) | null>(null)

  const profile = portfolio?.profile
  const projects = portfolio?.projects ?? []

  // ── Build + drive the scene (once) ─────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    if (!webglSupported()) { setUnsupported(true); return }
    let unmounted = false

    // ---- renderer ----
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95
    mount.appendChild(renderer.domElement)

    // ---- scene ----
    // No scene.environment here on purpose: a bright IBL environment map
    // (like RoomEnvironment) adds ambient light to every material regardless
    // of direct lighting, which was overexposing these mostly-matte, already
    // light-colored Kenney props into a near-white wash. Direct lights only.
    // Background/fog/floor/wall colors are plain THREE.Color instances so the
    // lamp toggle can lerp them directly — a real day-mode/night-mode swap,
    // not just a brightness tweak.
    const scene = new THREE.Scene()
    const NIGHT_BG = new THREE.Color(0x050810), DAY_BG = new THREE.Color(0xaecbe8)
    scene.background = NIGHT_BG.clone()
    scene.fog = new THREE.FogExp2(0x0a1220, 0.045)

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.05, 200)
    // Raised and pulled back from the first pass — a lower/closer camera put
    // the chair's backrest directly between the lens and the monitor, and
    // cropped the room too tightly to read as a whole scene.
    const CAM_IDLE = new THREE.Vector3(0.2, 2.55, 5.4)
    const CAM_INTRO = new THREE.Vector3(1.1, 3.6, 7.4)
    const LOOK_BASE = new THREE.Vector3(0, 1.0, -0.35)
    camera.position.copy(CAM_INTRO); camera.lookAt(LOOK_BASE)

    // ---- lighting: night is a moody, lamp-lit room; day is a bright, neutral
    //      studio. The lamp toggle drives a full swap, not a subtle nudge. ----
    const hemi = new THREE.HemisphereLight(0x3a4658, 0x14100c, 0.4)
    scene.add(hemi)
    const key = new THREE.DirectionalLight(0xfff4e0, 0.8); key.position.set(4, 7, 5); key.castShadow = true
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.near = 1; key.shadow.camera.far = 20
    key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6; key.shadow.bias = -0.0004
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.18); fill.position.set(-4, 3, -3); scene.add(fill)
    // Tiny, tight-radius accent glow near the record player only — deliberately
    // too weak/close to tint the desk or the wood/carpet props.
    const cyanAccent = new THREE.PointLight(C.cyan, 0.5, 1.8, 2); cyanAccent.position.set(0, 1.3, -0.9); scene.add(cyanAccent)
    const lampLight = new THREE.PointLight(0xffc98a, 0, 3.4, 2)

    // ---- floor + backdrop wall + rug (an enclosed room, not open space) ----
    const env = new THREE.Group(); scene.add(env)
    const NIGHT_FLOOR = new THREE.Color(0x0a0d12), DAY_FLOOR = new THREE.Color(0xc7cdd6)
    const NIGHT_WALL = new THREE.Color(0x0c1018), DAY_WALL = new THREE.Color(0xdfe6ee)
    const floorMat = std(0x0a0d12, 0.75, 0.12)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48), floorMat)
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; env.add(floor)
    const wallMat = std(0x0c1018, 0.95, 0)
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), wallMat)
    wall.position.set(0, 3.4, -2.4); wall.receiveShadow = true; env.add(wall)
    const rug = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48), std(0x2a2f38, 0.9, 0))
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.005, 0.6); rug.receiveShadow = true; env.add(rug)

    // ── audio ──
    const audio = new AudioManager(); audioRef.current = audio
    let audioKicked = false
    // Just wakes up the audio context — music is the record player's job now,
    // not something that starts playing on its own the moment you load in.
    const kickAudio = () => { if (audioKicked) return; audioKicked = true; audio.resume() }

    // ── loading manager (branded progress) ──
    const manager = new THREE.LoadingManager()
    manager.onProgress = (_u, loaded, total) => setProgress(Math.round((loaded / Math.max(total, 1)) * 100))
    const loader = new GLTFLoader(manager)

    const raycastTargets: THREE.Object3D[] = []
    const tag = (group: THREE.Group, kind: PropKind) => {
      group.traverse(o => { if ((o as THREE.Mesh).isMesh) { (o.userData as Record<string, unknown>).kind = kind; raycastTargets.push(o) } })
    }

    // ── desk + props (real CC0 models, Kenney Furniture/Food Kit, plus
    //    procedural pieces where no free asset fit: gaming chair, curved
    //    monitor, record player, pencil, digital clock, headphone stand) ──
    let deskTopY = 0.72, deskW = 1.9, deskD = 0.95
    let recordDisc: THREE.Mesh | null = null, recordGlow: THREE.Mesh | null = null
    let pencilGroup: THREE.Group | null = null
    let lampBulbMat: THREE.MeshStandardMaterial | null = null
    let robotGroup: THREE.Group | null = null
    let robotMixer: THREE.AnimationMixer | null = null
    let kbGlowMat: THREE.MeshStandardMaterial | null = null, mouseGlowMat: THREE.MeshStandardMaterial | null = null
    let digitalClockCtx: CanvasRenderingContext2D | null = null, digitalClockTex: THREE.CanvasTexture | null = null
    let lastClockMinute = -1

    const gltf = (url: string) => loader.loadAsync(url).then(g => g.scene)
    // The robot mascot (3.6MB) loads on its own loader below, untracked by
    // `manager` — so it doesn't hold up the desk's much smaller props (a few
    // KB each) from finishing and letting the room go interactive.
    Promise.all([
      gltf(DESK_MODEL.desk), gltf(DESK_MODEL.lamp), gltf(DESK_MODEL.keyboard), gltf(DESK_MODEL.mouse),
      gltf(DESK_MODEL.plant), gltf(DESK_MODEL.notebook), gltf(DESK_MODEL.mug),
    ]).then(([deskS, lampS, keyboardS, mouseS, plantS, notebookS, mugS]) => {
      if (unmounted) return
      const setup = (m: THREE.Object3D) => m.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true } })
      ;[deskS, keyboardS, mouseS, plantS, notebookS, mugS].forEach(setup)

      // Desk — anchor of the whole layout. Bumped wider/deeper (via the
      // wrapping group's scale, so the centering normalizeModel already did
      // isn't thrown off) and recolored dark for a proper gaming-desk look
      // instead of the kit's default pastel wood tone.
      const deskDim = normalizeModel(deskS, 0.75)
      const DESK_BUMP = 1.4
      deskS.traverse(o => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const mm = mesh.material as THREE.MeshStandardMaterial
        // White top with dark legs — clean contrast against the black chair.
        if (mm?.name === 'wood') mm.color.set(0xf1efe8)
        if (mm?.name === 'metal') mm.color.set(0x24262b)
      })
      const deskGroup = new THREE.Group(); deskGroup.add(deskS)
      deskGroup.scale.set(DESK_BUMP, 1, DESK_BUMP)
      env.add(deskGroup)
      deskTopY = deskDim.height; deskW = deskDim.width * DESK_BUMP; deskD = deskDim.depth * DESK_BUMP

      // A thin RGB accent strip along the desk's front lip — always lit,
      // independent of the lamp/day-night state, the way a gaming desk's LED
      // strip would be.
      const rgbStrip = rbox(deskW * 0.9, 0.012, 0.012, std(0x0a0a0c, 0.6, 0.2, C.cyan, 1.1), 0.005)
      rgbStrip.position.set(0, deskTopY - 0.02, deskD * 0.5 - 0.01)
      env.add(rgbStrip)

      // Gaming chair — procedural (floor-standing, in front of the desk).
      const chairGroup = buildGamingChair()
      chairGroup.position.set(0, 0, deskD * 0.5 + 0.2); chairGroup.rotation.y = Math.PI
      env.add(chairGroup); tag(chairGroup, 'chair')

      // Desk mat — a dark blotter under the monitor/keyboard area, the kind of
      // small detail that sells "a real workspace" instead of bare wood.
      const deskMat = rbox(deskW * 0.5, 0.004, deskD * 0.55, std(0x1b1d22, 0.85, 0.05), 0.02)
      deskMat.position.set(-deskW * 0.02, deskTopY + 0.002, -deskD * 0.05)
      deskMat.receiveShadow = true; env.add(deskMat)

      // Curved monitor — procedural, hidden doorway to /work.
      const monW = 0.72, monH = 0.42
      const { group: monitorGroup, screenMat } = buildCurvedMonitor(monW, monH)
      monitorGroup.position.set(-deskW * 0.02, deskTopY + monH / 2 + 0.2, -deskD * 0.22)
      env.add(monitorGroup); tag(monitorGroup, 'monitor')
      void screenMat // brightness kept constant — a glowing screen reads well in both day and night mode

      // Keyboard + mouse, sitting on the mat in front of the monitor — each
      // gets a thin RGB underglow strip (color-cycled in the render loop)
      // for the gaming-gear look the flat Kenney models don't have on their own.
      const kbDim = normalizeModel(keyboardS, 0.035)
      const kbGroup = new THREE.Group(); kbGroup.add(keyboardS)
      kbGroup.position.set(monitorGroup.position.x, deskTopY + 0.006, -deskD * 0.02)
      env.add(kbGroup)
      const kbGlow = rbox(kbDim.width * 1.1, 0.006, kbDim.depth * 1.25, std(0x0a0a0c, 0.6, 0.2, 0xff2ea6, 1.6), 0.01)
      kbGlow.position.set(kbGroup.position.x, deskTopY + 0.001, kbGroup.position.z)
      env.add(kbGlow); kbGlowMat = kbGlow.material as THREE.MeshStandardMaterial

      const mouseDim = normalizeModel(mouseS, 0.032)
      const mouseGroup = new THREE.Group(); mouseGroup.add(mouseS)
      mouseGroup.position.set(monitorGroup.position.x + kbDim.width * 0.5 + 0.1, deskTopY + 0.006, -deskD * 0.02 + 0.03)
      mouseGroup.rotation.y = -0.15
      env.add(mouseGroup)
      const mouseGlow = new THREE.Mesh(new THREE.CylinderGeometry(mouseDim.width * 0.7, mouseDim.width * 0.7, 0.005, 20), std(0x0a0a0c, 0.6, 0.2, 0x00e5ff, 1.6))
      mouseGlow.position.set(mouseGroup.position.x, deskTopY + 0.001, mouseGroup.position.z)
      env.add(mouseGlow); mouseGlowMat = mouseGlow.material as THREE.MeshStandardMaterial

      // Mini robot mascot — the same model as the hero section — sits on the
      // desk (left side, well clear of the lamp on the right) and opens the
      // RajBot terminal when clicked. Loaded on its own loader (see below)
      // so its 3.6MB doesn't delay the rest of the desk.
      new GLTFLoader().loadAsync(ROBOT_URL).then(robotGltf => {
        if (unmounted) return
        const robotS = robotGltf.scene
        robotS.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true } })
        const holoNode = robotS.getObjectByName('holo')
        if (holoNode) holoNode.parent?.remove(holoNode)
        normalizeModel(robotS, 0.24)
        robotGroup = new THREE.Group(); robotGroup.add(robotS)
        robotGroup.position.set(-deskW * 0.42, deskTopY, deskD * 0.32)
        robotGroup.rotation.y = 0.6
        env.add(robotGroup); tag(robotGroup, 'robot')
        if (robotGltf.animations?.length) {
          robotMixer = new THREE.AnimationMixer(robotS)
          robotMixer.clipAction(robotGltf.animations[0]).play()
        }
      }).catch(() => { /* robot is cosmetic — a missing/slow load doesn't break anything else */ })

      // Lamp — day/night toggle.
      normalizeModel(lampS, 0.42)
      const lampGroup = new THREE.Group(); lampGroup.add(lampS)
      lampGroup.position.set(deskW * 0.36, deskTopY, -deskD * 0.12)
      env.add(lampGroup); tag(lampGroup, 'lamp')
      lampLight.position.set(lampGroup.position.x, deskTopY + 0.3, lampGroup.position.z); env.add(lampLight)
      // Target the bulb/shade material specifically (Kenney's lamp kit names it
      // "lamp"; the other material is "metal") — a brown fabric-shade color,
      // plus an actual emissive color (toggling emissiveIntensity on a black
      // emissive does nothing, which is why the toggle didn't work before).
      lampS.traverse(o => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat?.name === 'lamp') { mat.color.set(0x7a4a26); mat.emissive = new THREE.Color(0xffdb8a); mat.emissiveIntensity = 0; lampBulbMat = mat }
      })

      // Mug — hidden doorway to /contact.
      normalizeModel(mugS, 0.1)
      const mugGroup = new THREE.Group(); mugGroup.add(mugS)
      mugGroup.position.set(-deskW * 0.3, deskTopY, deskD * 0.1)
      env.add(mugGroup); tag(mugGroup, 'mug')

      // Notebook — hidden doorway to /about. Recolored off its default white
      // cover, which was disappearing entirely against the new white desk.
      normalizeModel(notebookS, 0.07)
      notebookS.traverse(o => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const mm = mesh.material as THREE.MeshStandardMaterial
        if (mm?.name === 'carpetWhite') mm.color.set(0x1f6f5c)
        if (mm?.name === 'carpetDarker') mm.color.set(0x123f34)
      })
      const notebookGroup = new THREE.Group(); notebookGroup.add(notebookS)
      notebookGroup.position.set(deskW * 0.02, deskTopY, deskD * 0.24)
      notebookGroup.rotation.y = 0.15
      env.add(notebookGroup); tag(notebookGroup, 'notebook')

      // Potted plant — decorative, floor-standing beside the desk.
      normalizeModel(plantS, 0.62)
      const plantGroup = new THREE.Group(); plantGroup.add(plantS)
      plantGroup.position.set(-deskW * 0.6, 0, -0.3)
      env.add(plantGroup); tag(plantGroup, 'plant')

      // Digital desk clock — real time, redrawn once a minute.
      const digitalClock = buildDigitalClock()
      digitalClock.group.position.set(deskW * 0.36, deskTopY, deskD * 0.16)
      env.add(digitalClock.group)
      digitalClockCtx = digitalClock.ctx; digitalClockTex = digitalClock.tex

      // Headphone stand, on the desk near the back-left corner.
      const headphones = buildHeadphoneStand()
      headphones.position.set(-deskW * 0.22, deskTopY, -deskD * 0.18)
      env.add(headphones)

      // Guest book — hidden doorway to the reviews/testimonials panel.
      const guestbook = buildGuestbook()
      guestbook.position.set(deskW * 0.4, deskTopY, deskD * 0.36)
      guestbook.rotation.y = -0.2
      env.add(guestbook); tag(guestbook, 'guestbook')

      // Small side table so the record player sits at height, not on the floor.
      const standH = 0.42
      const standGroup = new THREE.Group()
      const standTop = rbox(0.44, 0.03, 0.38, std(0x2a2018, 0.6, 0.1), 0.02)
      standTop.position.set(0, standH - 0.015, 0); standGroup.add(standTop)
      const legGeo = new THREE.CylinderGeometry(0.014, 0.014, standH - 0.03, 8)
      const legMat = std(0x1c150f, 0.65, 0.1)
      ;[[0.18, 0.15], [0.18, -0.15], [-0.18, 0.15], [-0.18, -0.15]].forEach(([lx, lz]) => {
        standGroup.add(at(new THREE.Mesh(legGeo, legMat), lx, (standH - 0.03) / 2, lz))
      })
      standGroup.position.set(-deskW * 0.6 - 0.4, 0, -0.05)
      standGroup.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
      env.add(standGroup)

      // ── Record player — procedural (playing = glow-ring toggle) ──
      const rp = new THREE.Group()
      rp.add(at(rbox(0.34, 0.045, 0.28, std(0x171310, 0.55, 0.25), 0.02), 0, 0.0225, 0))
      recordDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.006, 40), std(0x0b0b0d, 0.35, 0.6))
      recordDisc.position.set(0, 0.048, 0); rp.add(recordDisc)
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.008, 24), std(C.emerald, 0.4, 0.3, C.emerald, 0.6))
      label.position.set(0, 0.052, 0); rp.add(label)
      const arm = new THREE.Group(); arm.position.set(0.13, 0.05, -0.1)
      arm.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 10), std(0x8a8a90, 0.4, 0.7)), 0.07, 0, 0.02))
      arm.rotation.y = 0.5
      rp.add(arm)
      recordGlow = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.006, 8, 48), new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0 }))
      recordGlow.rotation.x = -Math.PI / 2; recordGlow.position.set(0, 0.05, 0); rp.add(recordGlow)
      rp.position.set(standGroup.position.x, standH, standGroup.position.z)
      rp.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
      env.add(rp); tag(rp, 'record')

      // ── Pencil — procedural (falls off the desk gag) ──
      pencilGroup = new THREE.Group()
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 8), std(0xd9a24a, 0.6, 0))
      body.rotation.z = Math.PI / 2; pencilGroup.add(body)
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.02, 8), std(0x2b2b2b, 0.5, 0))
      tip.rotation.z = -Math.PI / 2; tip.position.set(0.09, 0, 0); pencilGroup.add(tip)
      pencilGroup.position.set(deskW * 0.16, deskTopY + 0.006, deskD * 0.3)
      pencilGroup.rotation.y = 0.4
      env.add(pencilGroup); tag(pencilGroup, 'pencil')
      ;(pencilGroup.userData as Record<string, unknown>).rest = { pos: pencilGroup.position.clone(), rot: pencilGroup.rotation.clone() }
      ;(pencilGroup.userData as Record<string, unknown>).state = 'resting' // resting | falling | fallen | returning
      ;(pencilGroup.userData as Record<string, unknown>).t = 0
    }).catch(() => { /* desk props are cosmetic — scene still works without them */ })

    // No 3D avatar — RajBot lives in the terminal (monitor) and the chat dock.
    // Move past the loading curtain once every queued asset (desk props) settles.
    manager.onLoad = () => setMode('intro')

    // ── click handling (raycast against every tagged prop) ──
    // Clicks and camera-orbit drags share the same pointer: a press that moves
    // more than a few px before release is a drag (orbit), not a click.
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let punchT = 0 // decorative-click camera punch feedback

    const runPropRaycast = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(raycastTargets, false)
      if (!hits.length) return
      const kind = (hits[0].object.userData as Record<string, PropKind>).kind
      if (!kind) return
      // Pencil's fall/return state machine lives entirely in this closure
      // (driven by the render loop below) — trigger it directly here.
      if (kind === 'pencil') {
        if (pencilGroup) {
          const ud = pencilGroup.userData as { state: string; t: number }
          if (ud.state === 'resting') { ud.state = 'falling'; ud.t = 0; audio.click() }
        }
        return
      }
      onPropClickRef.current?.(kind)
    }

    // ── orbit (yaw only, clamped well short of a full turn) + zoom ──
    const YAW_MAX = 0.5 // ~28.6°: enough to peek around the desk, never behind it
    const DIST_MIN = 4.0, DIST_MAX = 7.5
    const BASE_RADIUS = Math.hypot(CAM_IDLE.x - LOOK_BASE.x, CAM_IDLE.z - LOOK_BASE.z)
    const BASE_HEIGHT = CAM_IDLE.y - LOOK_BASE.y
    const BASE_ANGLE = Math.atan2(CAM_IDLE.x - LOOK_BASE.x, CAM_IDLE.z - LOOK_BASE.z)
    let camYaw = 0, camDist = BASE_RADIUS
    const orbitPos = (yaw: number, dist: number) => {
      const a = BASE_ANGLE + yaw
      return new THREE.Vector3(
        LOOK_BASE.x + Math.sin(a) * dist,
        LOOK_BASE.y + BASE_HEIGHT * (dist / BASE_RADIUS),
        LOOK_BASE.z + Math.cos(a) * dist,
      )
    }

    let dragActive = false, dragMoved = false, dragStartX = 0, dragStartYaw = 0
    const DRAG_THRESHOLD = 6
    const onPointerDown = (ev: PointerEvent) => {
      kickAudio()
      if (modeRef.current === 'loading') return
      dragActive = true; dragMoved = false; dragStartX = ev.clientX; dragStartYaw = camYaw
    }
    const onPointerMoveDrag = (ev: PointerEvent) => {
      if (!dragActive || overlayRef.current != null || pinching) return
      const dx = ev.clientX - dragStartX
      if (Math.abs(dx) > DRAG_THRESHOLD) dragMoved = true
      if (dragMoved) camYaw = clamp(dragStartYaw + dx * 0.005, -YAW_MAX, YAW_MAX)
    }
    const onPointerUp = (ev: PointerEvent) => {
      if (!dragActive) return
      dragActive = false
      if (dragMoved || modeRef.current === 'loading') return
      runPropRaycast(ev)
    }
    const onWheel = (ev: WheelEvent) => {
      if (overlayRef.current != null || modeRef.current === 'loading') return
      ev.preventDefault()
      camDist = clamp(camDist + ev.deltaY * 0.0035, DIST_MIN, DIST_MAX)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMoveDrag)
    window.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    // ── pinch-to-zoom (touch has no wheel event) ──
    let pinching = false, pinchStartDist = 0, pinchStartCamDist = camDist
    const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length === 2) {
        pinching = true; dragActive = false
        pinchStartDist = touchDist(ev.touches); pinchStartCamDist = camDist
      }
    }
    const onTouchMove = (ev: TouchEvent) => {
      if (!pinching || ev.touches.length !== 2 || overlayRef.current != null) return
      ev.preventDefault()
      const d = touchDist(ev.touches)
      camDist = clamp(pinchStartCamDist * (pinchStartDist / Math.max(d, 1)), DIST_MIN, DIST_MAX)
    }
    const onTouchEnd = (ev: TouchEvent) => { if (ev.touches.length < 2) pinching = false }
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true })
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false })
    renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: true })
    renderer.domElement.addEventListener('touchcancel', onTouchEnd, { passive: true })

    // ── camera + loop ──
    const camPos = new THREE.Vector3().copy(camera.position), camLook = new THREE.Vector3().copy(LOOK_BASE)
    let introT = 0, raf = 0
    const clock = new THREE.Clock()

    const onResize = () => { camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mount.clientWidth, mount.clientHeight) }
    window.addEventListener('resize', onResize)

    const animate = () => {
      raf = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05)
      // Lamp toggle = a real night/day mode swap, not a brightness nudge:
      // background, fog, floor, and walls all lerp together with the lights.
      const night = lampOnRef.current
      const k = Math.min(1, dt * 2.4)
      hemi.intensity += ((night ? 0.4 : 1.0) - hemi.intensity) * k
      key.intensity += ((night ? 0.6 : 1.4) - key.intensity) * k
      fill.intensity += ((night ? 0.24 : 0.4) - fill.intensity) * k
      lampLight.intensity += ((night ? 6.5 : 0) - lampLight.intensity) * k
      if (lampBulbMat) { const ei = night ? 1.7 : 0; lampBulbMat.emissiveIntensity += (ei - (lampBulbMat.emissiveIntensity || 0)) * k }
      ;(scene.background as THREE.Color).lerp(night ? NIGHT_BG : DAY_BG, k)
      scene.fog!.color.lerp(night ? NIGHT_BG : DAY_BG, k)
      ;(scene.fog as THREE.FogExp2).density += ((night ? 0.045 : 0.015) - (scene.fog as THREE.FogExp2).density) * k

      floorMat.color.lerp(night ? NIGHT_FLOOR : DAY_FLOOR, k)
      wallMat.color.lerp(night ? NIGHT_WALL : DAY_WALL, k)

      // digital desk clock — redraws its face only when the minute changes
      if (digitalClockCtx && digitalClockTex) {
        const now = new Date()
        if (now.getMinutes() !== lastClockMinute) {
          lastClockMinute = now.getMinutes()
          const hh = String(now.getHours()).padStart(2, '0')
          const mm = String(now.getMinutes()).padStart(2, '0')
          digitalClockCtx.fillStyle = '#050705'; digitalClockCtx.fillRect(0, 0, 200, 100)
          digitalClockCtx.fillStyle = '#5affb0'; digitalClockCtx.font = 'bold 52px monospace'
          digitalClockCtx.textAlign = 'center'; digitalClockCtx.textBaseline = 'middle'
          digitalClockCtx.fillText(`${hh}:${mm}`, 100, 52)
          digitalClockTex.needsUpdate = true
        }
      }

      // RGB gaming peripherals — cycling underglow
      const hue = (clock.elapsedTime * 0.12) % 1
      if (kbGlowMat) kbGlowMat.emissive.setHSL(hue, 1, 0.5)
      if (mouseGlowMat) mouseGlowMat.emissive.setHSL((hue + 0.45) % 1, 1, 0.5)

      // record player spin + glow
      if (recordDisc) recordDisc.rotation.y += (playingRef.current ? dt * 3.6 : dt * 0.05)
      if (recordGlow) { const g = recordGlow.material as THREE.MeshBasicMaterial; const target = playingRef.current ? 0.85 : 0; g.opacity += (target - g.opacity) * Math.min(1, dt * 4) }

      // pencil gag animation
      if (pencilGroup) {
        const ud = pencilGroup.userData as { state: string; t: number; rest: { pos: THREE.Vector3; rot: THREE.Euler } }
        if (ud.state === 'falling') {
          ud.t += dt / 0.6
          const k = clamp(ud.t, 0, 1)
          pencilGroup.position.y = lerp(ud.rest.pos.y, 0.015, eio(k))
          pencilGroup.position.z = lerp(ud.rest.pos.z, ud.rest.pos.z + 0.55, k)
          pencilGroup.rotation.x = lerp(0, Math.PI * 2.2, k)
          pencilGroup.rotation.z = lerp(ud.rest.rot.z, ud.rest.rot.z + 0.6, k)
          if (k >= 1) { ud.state = 'fallen'; ud.t = 0 }
        } else if (ud.state === 'fallen') {
          ud.t += dt
          if (ud.t > 3.2) { ud.state = 'returning'; ud.t = 0 }
        } else if (ud.state === 'returning') {
          ud.t += dt / 0.5
          const k = clamp(ud.t, 0, 1)
          pencilGroup.position.y = lerp(0.015, ud.rest.pos.y, eio(k))
          pencilGroup.position.z = lerp(ud.rest.pos.z + 0.55, ud.rest.pos.z, k)
          pencilGroup.rotation.x = lerp(Math.PI * 2.2, 0, k)
          pencilGroup.rotation.z = lerp(ud.rest.rot.z + 0.6, ud.rest.rot.z, k)
          if (k >= 1) { ud.state = 'resting'; ud.t = 0; pencilGroup.rotation.copy(ud.rest.rot) }
        }
      }

      // mini robot — idle bob + its own embedded animation, if it has one
      if (robotMixer) robotMixer.update(dt)
      if (robotGroup) robotGroup.rotation.y = 0.6 + Math.sin(clock.elapsedTime * 0.8) * 0.06

      // ── camera ──
      if (modeRef.current === 'intro') {
        introT += dt; const kk = eio(clamp(introT / 2.6, 0, 1))
        camPos.lerpVectors(CAM_INTRO, CAM_IDLE, kk); camLook.copy(LOOK_BASE)
      } else {
        const focused = overlayRef.current != null
        const orbited = orbitPos(camYaw, camDist)
        const basePos = focused ? orbited.lerp(LOOK_BASE, 0.18) : orbited
        camPos.lerp(basePos, 1 - Math.exp(-dt * 3))
        // A fixed look-at — no mouse-tracking parallax (that read as the room
        // sliding around). Orbit/zoom above are the only camera movement now,
        // both clamped so you can never see behind the desk or past the walls.
        if (punchT > 0) punchT -= dt
        const punch = Math.sin(punchT * 26) * punchT * 0.03
        const target = new THREE.Vector3(LOOK_BASE.x + punch, LOOK_BASE.y, LOOK_BASE.z)
        camLook.lerp(target, 1 - Math.exp(-dt * 4))
      }
      camera.position.copy(camPos); camera.lookAt(camLook)
      renderer.render(scene, camera)
    }
    animate()

    // expose tiny hooks so the React-side buttons can reach into this closure
    const mountHooks = mount as unknown as Record<string, unknown>
    mountHooks.__punch = () => { punchT = 0.4 }
    mountHooks.__nudgeYaw = (delta: number) => { camYaw = clamp(camYaw + delta, -YAW_MAX, YAW_MAX) }
    mountHooks.__nudgeZoom = (delta: number) => { camDist = clamp(camDist + delta, DIST_MIN, DIST_MAX) }
    mountHooks.__triggerPencil = () => {
      if (!pencilGroup) return
      const ud = pencilGroup.userData as { state: string; t: number }
      if (ud.state === 'resting') { ud.state = 'falling'; ud.t = 0; audio.click() }
    }

    return () => {
      unmounted = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMoveDrag)
      window.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('touchstart', onTouchStart)
      renderer.domElement.removeEventListener('touchmove', onTouchMove)
      renderer.domElement.removeEventListener('touchend', onTouchEnd)
      renderer.domElement.removeEventListener('touchcancel', onTouchEnd)
      robotMixer?.stopAllAction()
      audio.dispose(); audioRef.current = null
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── handle a click on a tagged 3D prop ──
  const handlePropClick = useCallback((kind: PropKind) => {
    const a = audioRef.current
    switch (kind) {
      case 'lamp':
        setLampOn(v => !v); a?.click(); break
      case 'record': {
        const next = !playingRef.current
        setPlaying(next)
        if (next) a?.startMusic(); else a?.stopMusic()
        a?.click(); break
      }
      case 'monitor':
        setOverlay('work'); a?.pcOpen(); break
      case 'notebook':
        setOverlay('about'); a?.panelOpen(); break
      case 'mug':
        setOverlay('contact'); a?.panelOpen(); break
      case 'robot':
        setChatOpen(true); a?.panelOpen(); break
      case 'guestbook':
        setOverlay('guestbook'); a?.panelOpen(); break
      case 'chair': case 'plant': {
        const mount = mountRef.current as unknown as Record<string, unknown> | null
        const punch = mount?.__punch as (() => void) | undefined
        punch?.(); a?.click(); break
      }
    }
  }, [])
  useEffect(() => { onPropClickRef.current = handlePropClick }, [handlePropClick])

  // ── intro greeting ──
  useEffect(() => {
    if (mode !== 'intro') return
    const nm = profile?.name || 'Raj'
    setSpeech(`Welcome to my studio — I'm ${nm}. Click around: the monitor, notebook, and mug are all doorways, and the little robot on the desk will chat with you. Everything else has a surprise too.`)
    const t = setTimeout(() => { setMode('idle'); setTimeout(() => setSpeech(''), 4000) }, 4400)
    return () => clearTimeout(t)
  }, [mode, profile])

  // ── chat reactions (speech bubble only — no avatar to animate) ──
  useEffect(() => {
    const last = chatHistory[chatHistory.length - 1]
    if (!last || last.role !== 'assistant' || chatThinking) return
    audioRef.current?.blipRecv()
    if (!chatOpen) setSpeech(last.content)
  }, [chatHistory, chatThinking, chatOpen])

  const toggleMute = () => { const n = !muted; setMuted(n); audioRef.current?.setMuted(n); if (!n) audioRef.current?.resume() }
  const askAbout = (title: string) => { setChatOpen(true); audioRef.current?.blipSend(); sendChat(`Tell me about ${title}.`) }
  const closeOverlay = () => setOverlay(null)
  const nudgeYaw = (delta: number) => { const m = mountRef.current as unknown as Record<string, unknown> | null; (m?.__nudgeYaw as ((d: number) => void) | undefined)?.(delta) }
  const nudgeZoom = (delta: number) => { const m = mountRef.current as unknown as Record<string, unknown> | null; (m?.__nudgeZoom as ((d: number) => void) | undefined)?.(delta) }
  const triggerProp = (kind: PropKind) => {
    if (kind === 'pencil') {
      const m = mountRef.current as unknown as Record<string, unknown> | null
      ;(m?.__triggerPencil as (() => void) | undefined)?.()
      return
    }
    handlePropClick(kind)
  }

  // ── WebGL-unsupported fallback ──
  if (unsupported) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#0a0b0d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, fontFamily: C.font, color: C.ink, textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>3D isn't available on this device</div>
        <div style={{ color: C.muted, maxWidth: 420, lineHeight: 1.6 }}>Your browser doesn't support WebGL, so the interactive studio can't load. The full portfolio is available on the classic site.</div>
        <button onClick={onExitClassic} style={{ ...primaryBtn }}>← Go to classic site</button>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#05070a', overflow: 'hidden', userSelect: 'none' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, cursor: mode === 'idle' ? 'pointer' : 'default' }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10, boxShadow: 'inset 0 0 min(18vw,220px) rgba(0,0,0,0.55)' }} />

      {/* Keyboard access to every clickable desk prop — a WebGL canvas can't be
          tabbed into natively, so this is a real, labeled button per object.
          Visually hidden until it (or the one before it) has keyboard focus,
          so mouse users never see it. */}
      {mode === 'idle' && (
        <nav aria-label="Interactive desk objects" style={{ position: 'absolute', top: 60, left: 18, zIndex: 35 }}>
          {KEYBOARD_PROPS.map(({ kind, label }) => (
            <button key={kind} className="kbd-object-link" onClick={() => triggerProp(kind)}>{label}</button>
          ))}
        </nav>
      )}

      {/* top bar */}
      <div style={{ position: 'absolute', top: 16, left: 18, display: 'flex', alignItems: 'center', gap: 10, zIndex: 30, fontFamily: C.font }}>
        <button onClick={toggleMute} style={ghostBtn} title="Sound">{muted ? '🔇' : '🔊'}</button>
      </div>
      <div style={{ position: 'absolute', top: 16, right: 18, display: 'flex', gap: 10, zIndex: 30 }}>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setMenuOpen(o => !o)} style={ghostBtn}>{menuOpen ? '✕' : '···'}</button>
          {menuOpen && (
            <div style={{ position: 'absolute', top: '110%', right: 0, minWidth: 160, background: C.panelSolid, border: `1px solid ${C.border}`, borderRadius: 12, padding: 6, backdropFilter: 'blur(16px)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
              {([['about', 'About'], ['work', 'Work'], ['contact', 'Contact'], ['guestbook', 'Reviews']] as const).map(([k, label]) => (
                <button key={k} onClick={() => { setOverlay(k); setMenuOpen(false); audioRef.current?.panelOpen() }} style={menuItem}>{label}</button>
              ))}
              <div style={{ height: 1, background: C.border, margin: '6px 4px' }} />
              <button onClick={() => { setMenuOpen(false); onExitClassic() }} style={menuItem}>← Classic site</button>
            </div>
          )}
        </div>
      </div>

      {/* speech bubble */}
      {speech && mode !== 'loading' && (
        <div style={{ position: 'absolute', top: '9%', left: '50%', transform: 'translateX(-50%)', maxWidth: 'min(680px,88vw)', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 22px', color: C.ink, fontFamily: C.font, fontSize: 'clamp(0.9rem,1.7vw,1.05rem)', lineHeight: 1.55, textAlign: 'center', backdropFilter: 'blur(12px)', pointerEvents: 'none', zIndex: 20, boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>{speech}</div>
      )}

      {/* idle hint */}
      {mode === 'idle' && overlay == null && (
        <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', color: C.ink2, background: C.panel, border: `1px solid ${C.border}`, padding: '8px 18px', borderRadius: 20, fontFamily: C.font, fontSize: '0.8rem', fontWeight: 500, zIndex: 15, backdropFilter: 'blur(10px)', textAlign: 'center' }}>
          Click around the desk — every object has a purpose
        </div>
      )}

      {/* camera controls — orbit (clamped, no full turn) + zoom */}
      {mode === 'idle' && overlay == null && (
        <div style={{ position: 'absolute', bottom: 18, right: 18, display: 'flex', gap: 6, zIndex: 15 }}>
          <button onClick={() => nudgeYaw(-0.16)} style={camBtn} title="Look left" aria-label="Look left">◀</button>
          <button onClick={() => nudgeZoom(-0.8)} style={camBtn} title="Zoom in" aria-label="Zoom in">＋</button>
          <button onClick={() => nudgeZoom(0.8)} style={camBtn} title="Zoom out" aria-label="Zoom out">－</button>
          <button onClick={() => nudgeYaw(0.16)} style={camBtn} title="Look right" aria-label="Look right">▶</button>
        </div>
      )}

      {/* ── overlays ── */}
      {overlay === 'work' && <FolderPanel profile={profile} projects={projects} onClose={closeOverlay} onAsk={askAbout} />}
      {overlay === 'about' && <AboutPanel profile={profile} onClose={closeOverlay} onAsk={() => askAbout('your background and experience')} />}
      {overlay === 'contact' && <ContactPanel profile={profile} scheduling={portfolio?.scheduling} onClose={closeOverlay} />}
      {overlay === 'guestbook' && <GuestbookPanel scheduling={portfolio?.scheduling} onClose={closeOverlay} onOpenContact={() => setOverlay('contact')} />}

      {/* ── RajBot terminal chat (shared with the classic site) ── */}
      {chatOpen && (
        <TerminalWindow
          name={profile?.name || 'Raj'}
          messages={chatHistory}
          thinking={chatThinking}
          onSend={msg => { audioRef.current?.blipSend(); sendChat(msg) }}
          onClose={() => setChatOpen(false)}
          defaultMaximized
          suggestions={chatHistory.length === 0 ? [
            'Show me his best work', "What's he shipping right now?", 'How do I hire him?',
          ] : []}
        />
      )}

      {/* ── loading overlay ── */}
      {mode === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#05070a', color: C.ink, fontFamily: C.font, zIndex: 60, gap: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '1.15rem', fontWeight: 700 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: C.gradient, boxShadow: '0 0 16px rgba(16,185,129,0.8)', animation: 's3dPulse 1.4s ease-in-out infinite' }} />
            Entering the studio
          </div>
          <div style={{ width: 260, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(6, progress)}%`, height: '100%', background: C.gradient, transition: 'width .25s ease', borderRadius: 3 }} />
          </div>
          <div style={{ color: C.muted, fontSize: '0.82rem', letterSpacing: '0.04em' }}>{progress < 100 ? `Loading assets… ${progress}%` : 'Assembling scene…'}</div>
        </div>
      )}

      {mode === 'intro' && <button onClick={() => { setMode('idle'); setSpeech('') }} style={{ ...ghostBtn, position: 'absolute', bottom: 24, right: 28, zIndex: 30 }}>Skip intro ▸</button>}

      <style>{`@keyframes s3dPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.5);opacity:.6}}
        @keyframes s3dPanelIn{from{opacity:0;transform:translate(-50%,-46%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
        @keyframes s3dSlideIn{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
        .kbd-object-link{position:absolute;top:0;left:0;display:block;background:${C.panelSolid};color:${C.ink};font-family:${C.font};font-size:0.82rem;font-weight:600;padding:9px 14px;border-radius:10px;border:1px solid ${C.borderAccent};white-space:nowrap;opacity:0;pointer-events:none;transform:translateY(-8px);transition:opacity .12s,transform .12s;}
        .kbd-object-link:focus{opacity:1;pointer-events:auto;transform:translateY(0);outline:2px solid ${C.emeraldHex};outline-offset:2px;}`}</style>
    </div>
  )
}

const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => { o.position.set(x, y, z); return o }

// ── monitor doorway — a small folder browser (Projects / Experience / Skills) ──
type FolderKey = 'projects' | 'experience' | 'skills'
const FOLDERS: { key: FolderKey; label: string; icon: string }[] = [
  { key: 'projects', label: 'Projects', icon: '📁' },
  { key: 'experience', label: 'Experience', icon: '📁' },
  { key: 'skills', label: 'Skills', icon: '📁' },
]

function FolderPanel({ profile, projects, onClose, onAsk }: {
  profile: PortfolioData['profile'] | undefined; projects: ProjectCard[]; onClose: () => void; onAsk: (title: string) => void
}) {
  const [open, setOpen] = useState<FolderKey | null>('projects')

  return (
    <PanelShell title="Work" wide onClose={onClose}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        {FOLDERS.map(f => (
          <button key={f.key} onClick={() => setOpen(f.key)} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 18px',
            borderRadius: 12, cursor: 'pointer', fontFamily: C.font, fontSize: '0.8rem', fontWeight: 600,
            background: open === f.key ? C.accentSoft : 'rgba(255,255,255,0.04)',
            border: `1px solid ${open === f.key ? C.borderAccent : C.border}`,
            color: open === f.key ? C.emeraldHex : C.ink2,
          }}>
            <span style={{ fontSize: 22 }}>{f.icon}</span>{f.label}
          </button>
        ))}
      </div>

      {open === 'projects' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
          {projects.map(p => (
            <div key={p.id} style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}` }}>
              <div style={{ color: C.ink, fontWeight: 700, fontSize: '0.98rem', marginBottom: 6 }}>{p.title}</div>
              <div style={{ color: C.ink2, fontSize: '0.85rem', lineHeight: 1.55, marginBottom: 10 }}>{p.summary}</div>
              {p.techStack?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                  {p.techStack.slice(0, 5).map(t => <span key={t} style={{ fontSize: '0.68rem', fontWeight: 500, padding: '3px 8px', borderRadius: 6, background: C.cyanSoft, border: '1px solid rgba(34,211,238,0.3)', color: C.cyanHex }}>{t}</span>)}
                </div>
              )}
              <button onClick={() => onAsk(p.title)} style={{ ...primaryBtn, width: '100%', justifyContent: 'center', fontSize: '0.76rem', padding: '8px 12px' }}>💬 Ask RajBot about this</button>
            </div>
          ))}
          {projects.length === 0 && <div style={{ color: C.muted, fontFamily: C.font, fontSize: '0.88rem' }}>Projects are loading…</div>}
        </div>
      )}

      {open === 'experience' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(profile?.experience ?? []).map((e, i) => (
            <div key={i} style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}` }}>
              <div style={{ color: C.ink, fontWeight: 700, fontSize: '0.95rem' }}>{e.role || e.company}{e.role && e.company ? ` · ${e.company}` : ''}</div>
              {e.dateRange && <div style={{ color: C.muted, fontSize: '0.76rem', marginTop: 2 }}>{e.dateRange}</div>}
              {e.summary && <p style={{ color: C.ink2, fontSize: '0.85rem', lineHeight: 1.55, margin: '8px 0 0' }}>{e.summary}</p>}
              {e.highlights?.length > 0 && (
                <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {e.highlights.slice(0, 4).map((h, j) => <li key={j} style={{ display: 'flex', gap: 8, fontSize: '0.82rem', color: C.ink2 }}><span style={{ color: C.emeraldHex }}>▸</span>{h}</li>)}
                </ul>
              )}
            </div>
          ))}
          {(profile?.experience ?? []).length === 0 && <div style={{ color: C.muted, fontFamily: C.font, fontSize: '0.88rem' }}>Experience is loading…</div>}
        </div>
      )}

      {open === 'skills' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(profile?.skills ?? []).map(s => (
            <div key={s.category}>
              <div style={{ color: C.emeraldHex, fontSize: '0.78rem', fontWeight: 700, marginBottom: 5 }}>{s.category}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {s.items.map(it => <span key={it} style={{ fontSize: '0.76rem', padding: '4px 10px', borderRadius: 7, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: C.ink2 }}>{it}</span>)}
              </div>
            </div>
          ))}
          {(profile?.skills ?? []).length === 0 && <div style={{ color: C.muted, fontFamily: C.font, fontSize: '0.88rem' }}>Skills are loading…</div>}
        </div>
      )}
    </PanelShell>
  )
}

// ── /about overlay — notebook doorway (open book: bio + envelope with RESUME/FAQ) ──
const FAQS = (name: string, open: boolean, loc: string, roles: string) => [
  { q: 'Are you currently open to work?', a: open ? `Yes — ${name} is actively looking for new opportunities.` : `Not actively looking right now, but always open to a great conversation.` },
  { q: 'Where are you located, and open to relocating?', a: loc },
  { q: 'What kind of roles are you looking for?', a: roles },
  { q: 'Can I see your résumé?', a: 'Yes — open the RESUME card to the left, or download it directly from there.' },
  { q: 'Do you work remote, hybrid, or on-site?', a: 'Open to any of the three depending on the role and team — happy to discuss what works best.' },
  { q: 'What tech stacks are you strongest in?', a: 'Check the résumé card for the current breakdown — it stays in sync with the live skills list.' },
  { q: "What's the best way to reach you?", a: 'Use the Contact panel (click the mug on the desk), or email directly — either works.' },
  { q: 'How do we start a conversation?', a: "Send a message through Contact, or just ask RajBot here — I'll pass it along." },
]

function AboutPanel({ profile, onClose, onAsk }: { profile: PortfolioData['profile'] | undefined; onClose: () => void; onAsk: () => void }) {
  const [zoom, setZoom] = useState<'resume' | 'faq' | null>(null)
  const name = profile?.name || 'Raj'
  const loc = [profile?.currentLocation, profile?.desiredLocations?.length ? `open to ${profile.desiredLocations.join(', ')}` : null].filter(Boolean).join(' — ') || 'Flexible on location.'
  const roles = profile?.headline || 'Roles matching my experience and skills below.'
  const faqs = FAQS(name, !!profile?.openToWork, loc, roles)
  const skills = (profile?.skills ?? []).slice(0, 3)

  return (
    <PanelShell title="About" wide onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: zoom ? '1fr' : 'minmax(220px,1.1fr) minmax(200px,0.9fr)', gap: 20 }}>
        {!zoom && (
          <div>
            <div style={{ color: C.emeraldHex, fontFamily: C.font, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>{profile?.eyebrow || 'About'}</div>
            <div style={{ color: C.ink, fontFamily: C.font, fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.3, marginBottom: 10 }}>{profile?.headline || `Hi, I'm ${name}.`}</div>
            <p style={{ color: C.ink2, fontFamily: C.font, fontSize: '0.88rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{profile?.about || 'Building things end to end — from data pipelines to production apps.'}</p>
            <button onClick={onAsk} style={{ ...primaryBtn, marginTop: 14 }}>💬 Ask RajBot to walk you through it</button>
          </div>
        )}

        {zoom == null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: '0.72rem', color: C.muted, fontFamily: C.font, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Tucked in the envelope</div>
            <button onClick={() => setZoom('resume')} style={envelopeCard}>
              <span style={{ fontSize: 20 }}>📄</span>
              <div><div style={{ color: C.ink, fontWeight: 700, fontSize: '0.88rem' }}>RESUME</div><div style={{ color: C.muted, fontSize: '0.76rem' }}>Quick highlights + download</div></div>
            </button>
            <button onClick={() => setZoom('faq')} style={envelopeCard}>
              <span style={{ fontSize: 20 }}>📋</span>
              <div><div style={{ color: C.ink, fontWeight: 700, fontSize: '0.88rem' }}>FAQ</div><div style={{ color: C.muted, fontSize: '0.76rem' }}>What recruiters usually ask</div></div>
            </button>
          </div>
        )}

        {zoom === 'resume' && (
          <div>
            <button onClick={() => setZoom(null)} style={{ ...ghostBtn, marginBottom: 12 }}>◂ Back</button>
            <div style={{ color: C.ink, fontWeight: 700, fontSize: '1rem', marginBottom: 10 }}>Résumé highlights</div>
            {skills.map(s => (
              <div key={s.category} style={{ marginBottom: 10 }}>
                <div style={{ color: C.emeraldHex, fontSize: '0.76rem', fontWeight: 700, marginBottom: 3 }}>{s.category}</div>
                <div style={{ color: C.ink2, fontSize: '0.84rem', lineHeight: 1.5 }}>{s.items.join(' · ')}</div>
              </div>
            ))}
            <a href={RESUME_URL} download="Raj_Sahoo_Resume.pdf" style={{ ...primaryBtn, marginTop: 10, textDecoration: 'none', width: '100%', justifyContent: 'center' }}>⬇ Download résumé (PDF)</a>
          </div>
        )}

        {zoom === 'faq' && (
          <div>
            <button onClick={() => setZoom(null)} style={{ ...ghostBtn, marginBottom: 12 }}>◂ Back</button>
            <FaqAccordion items={faqs} />
          </div>
        )}
      </div>
    </PanelShell>
  )
}

function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((it, i) => (
        <div key={i} style={{ borderRadius: 10, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
          <button onClick={() => setOpen(o => (o === i ? null : i))} style={{ width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.03)', border: 'none', color: C.ink, fontFamily: C.font, fontWeight: 600, fontSize: '0.84rem', padding: '10px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            {it.q}<span style={{ color: C.muted }}>{open === i ? '−' : '+'}</span>
          </button>
          {open === i && <div style={{ padding: '0 12px 12px', color: C.ink2, fontSize: '0.82rem', lineHeight: 1.55, fontFamily: C.font }}>{it.a}</div>}
        </div>
      ))}
    </div>
  )
}

// ── /contact overlay — mug doorway ────────────────────────────────────────────
function ContactPanel({ profile, scheduling, onClose }: { profile: PortfolioData['profile'] | undefined; scheduling: PortfolioData['scheduling']; onClose: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')
  const social = profile?.socialLinks
  const schedulingEnabled = Boolean(scheduling?.enabled && scheduling?.calLink)

  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
  const submit = async () => {
    setError('')
    const n = name.trim(), em = email.trim(), msg = message.trim()
    if (!n) { setError('Please enter your name.'); return }
    if (!EMAIL_RE.test(em)) { setError('Please enter a valid email.'); return }
    if (msg.length < 2) { setError('Please write a short message.'); return }
    setStatus('sending')
    try {
      const res = await fetch(`${API_BASE}/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, email: em, message: msg, source: 'form' }) })
      if (!res.ok) throw new Error()
      setStatus('sent'); setName(''); setEmail(''); setMessage('')
    } catch { setStatus('error'); setError('Something went wrong — please email directly instead.') }
  }

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(380px,92vw)', zIndex: 44, background: C.panelSolid, borderLeft: `1px solid ${C.borderAccent}`, padding: '22px 22px', overflowY: 'auto', backdropFilter: 'blur(24px) saturate(180%)', boxShadow: '-20px 0 60px rgba(0,0,0,0.55)', fontFamily: C.font, animation: 's3dSlideIn .28s cubic-bezier(.2,.8,.2,1)' }}>
      <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 14, right: 16, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18 }}>✕</button>
      <div style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: C.emeraldHex, fontWeight: 700, marginBottom: 14 }}>Contact</div>

      {(social?.email || social?.linkedin || social?.github) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {social?.email && <a href={`mailto:${social.email}`} style={chip}>✉ Email</a>}
          {social?.linkedin && <a href={social.linkedin} target="_blank" rel="noopener noreferrer" style={chip}>in LinkedIn</a>}
          {social?.github && <a href={social.github} target="_blank" rel="noopener noreferrer" style={chip}>⌨ GitHub</a>}
        </div>
      )}

      {schedulingEnabled && (
        <div style={{ padding: '14px 16px', borderRadius: 12, background: C.accentSoft, border: `1px solid ${C.borderAccent}`, marginBottom: 18 }}>
          <div style={{ color: C.ink, fontWeight: 700, fontSize: '0.88rem', marginBottom: 4 }}>{scheduling?.headline || 'Schedule a call'}</div>
          <p style={{ color: C.ink2, fontSize: '0.8rem', lineHeight: 1.5, margin: '0 0 10px' }}>
            {scheduling?.subtext || "Book a 30-minute call — pick a time that works and you'll get a Google Meet link automatically."}
          </p>
          <a href={normalizeCalUrl(scheduling!.calLink!)} target="_blank" rel="noopener noreferrer" style={{ ...primaryBtn, width: '100%', justifyContent: 'center', textDecoration: 'none' }}>📅 Book a time</a>
        </div>
      )}

      {status === 'sent' ? (
        <p style={{ color: C.ink2, fontSize: '0.9rem', lineHeight: 1.6 }}>Thanks for reaching out — I'll get back to you soon.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={formInput} />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" type="email" style={formInput} />
          <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="What's on your mind?" rows={5} style={{ ...formInput, resize: 'vertical', lineHeight: 1.5 }} />
          {error && <span style={{ color: '#fca5a5', fontSize: '0.78rem' }}>{error}</span>}
          <button onClick={submit} disabled={status === 'sending'} style={{ ...primaryBtn, justifyContent: 'center', opacity: status === 'sending' ? 0.6 : 1 }}>{status === 'sending' ? 'Sending…' : 'Send inquiry'}</button>
        </div>
      )}
    </div>
  )
}

// ── /guestbook overlay — guest book doorway: read approved testimonials,
// leave a quick note, or jump to the full review form ────────────────────────
function GuestbookPanel({ scheduling, onClose, onOpenContact }: { scheduling: PortfolioData['scheduling']; onClose: () => void; onOpenContact: () => void }) {
  const [reviews, setReviews] = useState<Review[]>([])
  const schedulingEnabled = Boolean(scheduling?.enabled && scheduling?.calLink)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  useEffect(() => {
    let alive = true
    void (async () => {
      const data = await fetchPublicReviews()
      if (alive) setReviews(data.reviews)
    })()
    return () => { alive = false }
  }, [])

  const submitNote = async () => {
    if (website.trim()) return
    if (name.trim().length < 1 || note.trim().length < 2) { setStatus('error'); return }
    setStatus('sending')
    try {
      const res = await fetch(`${API_BASE}/guestbook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), note: note.trim(), website }),
      })
      if (!res.ok) throw new Error()
      setStatus('sent'); setName(''); setNote('')
    } catch { setStatus('error') }
  }

  return (
    <PanelShell title="Guest Book" wide onClose={onClose}>
      <p style={{ color: C.ink2, fontFamily: C.font, fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 16px' }}>
        Worked with Raj, or just passing through? Leave a quick note below, or read what others have said.
      </p>

      {status === 'sent' ? (
        <p style={{ color: C.emeraldHex, fontFamily: C.font, fontSize: '0.88rem', marginBottom: 18 }}>Thanks for signing — it'll show up here once approved.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={80} style={formInput} />
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Leave a note…" maxLength={280} rows={2} style={{ ...formInput, resize: 'vertical', lineHeight: 1.5 }} />
          <input value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
          {status === 'error' && <span style={{ color: '#fca5a5', fontFamily: C.font, fontSize: '0.78rem' }}>Please add your name and a short note.</span>}
          <button onClick={submitNote} disabled={status === 'sending'} style={{ ...primaryBtn, opacity: status === 'sending' ? 0.6 : 1 }}>{status === 'sending' ? 'Pinning…' : '📌 Pin a note'}</button>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <a href="/review?from=3d" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: C.font, fontSize: '0.8rem', fontWeight: 700, color: C.emeraldHex, border: `1px solid ${C.borderAccent}`, borderRadius: 10, padding: '9px 14px', textDecoration: 'none' }}>
          ✍️ Leave a full review
        </a>
        <button onClick={onOpenContact} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: C.font, fontSize: '0.8rem', fontWeight: 700, color: C.ink2, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 14px', cursor: 'pointer' }}>
          ✉️ Send a private message
        </button>
        {schedulingEnabled && (
          <a href={normalizeCalUrl(scheduling!.calLink!)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: C.font, fontSize: '0.8rem', fontWeight: 700, color: C.ink2, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 14px', textDecoration: 'none' }}>
            📅 Schedule a call
          </a>
        )}
      </div>

      <div style={{ fontSize: '0.72rem', color: C.muted, fontFamily: C.font, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>What people have said</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {reviews.length === 0 && <p style={{ color: C.muted, fontFamily: C.font, fontSize: '0.86rem' }}>No reviews yet — be the first.</p>}
        {reviews.map(r => (
          <div key={r.review_id} style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}` }}>
            {r.rating > 0 && <div style={{ color: '#f59e0b', fontSize: '0.8rem', marginBottom: 4 }}>{'★'.repeat(r.rating)}</div>}
            <p style={{ color: C.ink2, fontFamily: C.font, fontSize: '0.86rem', lineHeight: 1.55, margin: '0 0 8px' }}>&ldquo;{r.review_text}&rdquo;</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', background: C.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.64rem', fontWeight: 700, color: '#04140c', fontFamily: C.font }}>{initials(r.name)}</span>
              <span style={{ color: C.muted, fontFamily: C.font, fontSize: '0.76rem' }}>
                <strong style={{ color: C.ink }}>{r.name}</strong>{[r.position, r.company].filter(Boolean).length > 0 ? ` · ${[r.position, r.company].filter(Boolean).join(' · ')}` : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}

// ── shared panel shell (About/Work modals) ────────────────────────────────────
function PanelShell({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: wide ? 'min(760px,94vw)' : 'min(420px,92vw)', maxHeight: '82vh', overflowY: 'auto', zIndex: 42,
      background: C.panelSolid, border: `1px solid ${C.borderAccent}`, borderRadius: 18, padding: '24px 26px',
      backdropFilter: 'blur(30px) saturate(180%)', boxShadow: '0 24px 70px rgba(0,0,0,0.6), 0 0 40px rgba(16,185,129,0.14)',
      fontFamily: C.font, animation: 's3dPanelIn .28s cubic-bezier(.2,.8,.2,1)',
    }}>
      <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 16, right: 18, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18 }}>✕</button>
      <div style={{ fontSize: '0.72rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: C.emeraldHex, fontWeight: 700, marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  )
}

// ── shared styles ─────────────────────────────────────────────────────────────
const ghostBtn: React.CSSProperties = { background: 'rgba(12,14,18,0.7)', border: `1px solid ${C.border}`, color: C.ink, fontFamily: C.font, fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.02em', padding: '9px 14px', cursor: 'pointer', borderRadius: 10, backdropFilter: 'blur(10px)' }
const camBtn: React.CSSProperties = { width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(12,14,18,0.7)', border: `1px solid ${C.border}`, color: C.ink2, fontFamily: C.font, fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', borderRadius: 9, backdropFilter: 'blur(10px)' }
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, background: C.gradient, border: 'none', color: '#04140c', fontFamily: C.font, fontSize: '0.82rem', fontWeight: 700, padding: '10px 16px', cursor: 'pointer', borderRadius: 10 }
const formInput: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: C.ink, fontFamily: C.font, fontSize: '0.86rem', boxSizing: 'border-box', outline: 'none' }
const menuItem: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: C.ink, fontFamily: C.font, fontSize: '0.84rem', fontWeight: 600, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }
const envelopeCard: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, cursor: 'pointer' }
const chip: React.CSSProperties = { fontSize: '0.76rem', fontWeight: 600, padding: '6px 12px', borderRadius: 8, background: C.accentSoft, border: `1px solid ${C.borderAccent}`, color: C.emeraldHex, textDecoration: 'none' }
