import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { ChatMessage, PortfolioData, ProjectCard } from './useTerminal'
import { AudioManager } from './audio'

/**
 * NEURAL STUDIO — a from-scratch 3D room.
 *
 * A dark cinematic studio floating in a void. The avatar spawns center-stage;
 * project "pillars" arc around the space. Walk (WASD / click-to-move / dpad) or
 * click a pillar to focus it — a holographic detail panel opens with the
 * project's summary, what-it-does, and stack. A persistent RajBot dock handles
 * chat. Everything reads the same live/fallback data as the classic page and
 * uses the site's emerald + cyan-on-dark palette.
 */

// ── Palette (shared with the classic page) ───────────────────────────────────
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

const MESH_URL = '/models/human.glb'
const ANIM = {
  idle: '/models/anim_idle.glb', walk: '/models/anim_walk.glb',
  talk1: '/models/anim_talk1.glb', talk2: '/models/anim_talk2.glb',
  greet: '/models/anim_expr1.glb', think: '/models/anim_expr2.glb',
} as const
type AnimName = 'idle' | 'walk' | 'talk' | 'greet' | 'think'

// ── math helpers ─────────────────────────────────────────────────────────────
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const eio = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function lerpAngle(a: number, b: number, t: number) { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t }

const FLOOR_RADIUS = 11        // walkable circular platform
const PILLAR_RING = 8.2        // radius the project pillars sit on
const FOCUS_DIST = 2.6         // how close the avatar must be to auto-focus a pillar

function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch { return false }
}

// A project pillar's live registration (position + data), shared between the
// three.js layer and the React overlay.
type PillarInfo = { index: number; project: ProjectCard; pos: THREE.Vector3; group: THREE.Group }

const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => { o.position.set(x, y, z); return o }

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

export default function Scene3D({ portfolio, chatHistory, chatThinking, sendChat, onExitClassic }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'loading' | 'intro' | 'roam'>('loading')
  const [progress, setProgress] = useState(0)
  const [unsupported, setUnsupported] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  const [muted, setMuted] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [input, setInput] = useState('')
  const [speech, setSpeech] = useState('')

  // Active project panel (React overlay), + its projected screen position.
  const [activePillar, setActivePillar] = useState<number | null>(null)
  const [panelData, setPanelData] = useState<ProjectCard | null>(null)
  const [nearPillar, setNearPillar] = useState<number | null>(null)
  const [panelPos, setPanelPos] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false })

  const modeRef = useRef(mode); modeRef.current = mode
  const mutedRef = useRef(muted); mutedRef.current = muted
  const keysRef = useRef<Set<string>>(new Set())
  const desiredAnimRef = useRef<AnimName>('idle')
  const audioRef = useRef<AudioManager | null>(null)
  const pillarsRef = useRef<PillarInfo[]>([])
  const moveTargetRef = useRef<THREE.Vector3 | null>(null)
  const activePillarRef = useRef<number | null>(null); activePillarRef.current = activePillar
  const nearPillarRef = useRef<number | null>(null); nearPillarRef.current = nearPillar
  const focusPillarFn = useRef<((i: number) => void) | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const projects = portfolio?.projects ?? []

  // ── Build + drive the scene (once) ─────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    if (!webglSupported()) { setUnsupported(true); return }

    // ---- renderer ----
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1
    mount.appendChild(renderer.domElement)

    // ---- scene + fog + env ----
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x05070a)
    scene.fog = new THREE.FogExp2(0x05070a, 0.03)
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.02).texture

    const camera = new THREE.PerspectiveCamera(48, mount.clientWidth / mount.clientHeight, 0.05, 200)
    camera.position.set(0, 6, 13)
    camera.lookAt(0, 1.2, 0)

    // ---- lighting ----
    scene.add(new THREE.HemisphereLight(0x223044, 0x05070a, 0.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(6, 12, 8); key.castShadow = true
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.near = 1; key.shadow.camera.far = 50
    key.shadow.camera.left = -14; key.shadow.camera.right = 14; key.shadow.camera.top = 14; key.shadow.camera.bottom = -14; key.shadow.bias = -0.0004
    scene.add(key)
    const emeraldFill = new THREE.PointLight(C.emerald, 60, 30, 2); emeraldFill.position.set(-8, 5, -4); scene.add(emeraldFill)
    const cyanFill = new THREE.PointLight(C.cyan, 55, 30, 2); cyanFill.position.set(8, 4, 5); scene.add(cyanFill)

    // ---- environment group ----
    const env = new THREE.Group(); scene.add(env)

    // circular obsidian floor (subtly reflective via env map)
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.18, metalness: 0.9 })
    const floor = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_RADIUS, 64), floorMat)
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; env.add(floor)

    // glowing rim ring
    const rim = new THREE.Mesh(new THREE.RingGeometry(FLOOR_RADIUS - 0.12, FLOOR_RADIUS, 64),
      new THREE.MeshBasicMaterial({ color: C.emerald, side: THREE.DoubleSide }))
    rim.rotation.x = -Math.PI / 2; rim.position.y = 0.02; env.add(rim)

    // concentric floor guide circles (thin, faint)
    for (let i = 1; i <= 3; i++) {
      const r = (FLOOR_RADIUS / 4) * i
      const g = new THREE.Mesh(new THREE.RingGeometry(r - 0.015, r + 0.015, 64),
        new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.10, side: THREE.DoubleSide }))
      g.rotation.x = -Math.PI / 2; g.position.y = 0.012; env.add(g)
    }

    // starfield void
    const starGeo = new THREE.BufferGeometry()
    const starN = 1400, sp = new Float32Array(starN * 3)
    for (let i = 0; i < starN; i++) {
      const r = 30 + Math.random() * 90, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1)
      sp[i * 3] = r * Math.sin(ph) * Math.cos(th); sp[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.6 + 2; sp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th)
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fd8ff, size: 0.13, transparent: true, opacity: 0.7, sizeAttenuation: true }))
    scene.add(stars)

    // ── central "neural core": a pulsing icosahedron in a glass shell ──
    const core = new THREE.Group(); core.position.set(0, 3.4, -0.2); env.add(core)
    const coreInnerMat = new THREE.MeshStandardMaterial({ color: C.emerald, emissive: C.emerald, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.4 })
    const coreInner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), coreInnerMat); core.add(coreInner)
    const coreShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1),
      new THREE.MeshStandardMaterial({ color: C.cyan, emissive: C.cyan, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.14, wireframe: true }))
    core.add(coreShell)
    const coreLight = new THREE.PointLight(C.emerald, 40, 22, 2); core.add(coreLight)
    const orbits: THREE.Mesh[] = []
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5 + i * 0.35, 0.012, 8, 80),
        new THREE.MeshBasicMaterial({ color: i % 2 ? C.cyan : C.emerald, transparent: true, opacity: 0.5 }))
      ring.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
      core.add(ring); orbits.push(ring)
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.5, 3.4, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: C.emerald, transparent: true, opacity: 0.06, side: THREE.DoubleSide }))
    beam.position.set(0, 1.7, -0.2); env.add(beam)

    // ── project pillars arced around the ring ──
    const pillars: PillarInfo[] = []
    const buildPillars = (list: ProjectCard[]) => {
      for (const p of pillars) env.remove(p.group)
      pillars.length = 0
      const n = Math.max(list.length, 1)
      const arc = Math.PI * 1.72, start = -arc / 2 - Math.PI / 2
      list.forEach((project, i) => {
        const a = start + (arc * (n === 1 ? 0.5 : i / (n - 1)))
        const x = Math.cos(a) * PILLAR_RING, z = Math.sin(a) * PILLAR_RING
        const g = new THREE.Group(); g.position.set(x, 0, z); g.lookAt(0, 0, 0)
        g.add(at(rbox(1.5, 0.18, 1.5, std(0x0e1218, 0.4, 0.8), 0.05), 0, 0.09, 0))
        const mono = rbox(0.9, 3.0, 0.28, std(0x11161d, 0.35, 0.7), 0.06); mono.position.set(0, 1.65, 0); mono.castShadow = true; g.add(mono)
        const faceMat = new THREE.MeshStandardMaterial({ color: 0x0b0f14, emissive: i % 2 ? C.cyan : C.emerald, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.3 })
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 2.6), faceMat); face.position.set(0, 1.7, 0.145); g.add(face)
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256
        const cx = cv.getContext('2d')!
        cx.clearRect(0, 0, 256, 256)
        cx.fillStyle = i % 2 ? C.cyanHex : C.emeraldHex; cx.font = 'bold 150px Inter, Arial'; cx.textAlign = 'center'; cx.textBaseline = 'middle'
        cx.fillText(String(i + 1).padStart(2, '0'), 128, 128)
        const numTex = new THREE.CanvasTexture(cv); numTex.colorSpace = THREE.SRGBColorSpace
        const num = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: numTex, transparent: true }))
        num.position.set(0, 2.72, 0.15); num.name = 'num'; g.add(num)
        const halo = new THREE.PointLight(i % 2 ? C.cyan : C.emerald, 6, 5, 2); halo.position.set(0, 2.4, 0.5); g.add(halo)
        ;(g.userData as Record<string, unknown>).face = faceMat
        ;(g.userData as Record<string, unknown>).halo = halo
        env.add(g)
        pillars.push({ index: i, project, pos: new THREE.Vector3(x, 0, z), group: g })
      })
      pillarsRef.current = pillars
    }
    buildPillars(projects)

    // ── audio ──
    const audio = new AudioManager(); audioRef.current = audio
    let audioKicked = false
    const kickAudio = () => { if (audioKicked) return; audioKicked = true; audio.resume().then(() => { if (!mutedRef.current) audio.startMusic() }) }

    // ── loading manager (branded progress) ──
    const manager = new THREE.LoadingManager()
    manager.onProgress = (_u, loaded, total) => setProgress(Math.round((loaded / Math.max(total, 1)) * 100))
    const loader = new GLTFLoader(manager)

    let mixer: THREE.AnimationMixer | null = null
    const actions: Partial<Record<'idle' | 'walk' | 'talk1' | 'talk2' | 'greet' | 'think', THREE.AnimationAction>> = {}
    let activeAction: THREE.AnimationAction | null = null
    let talkToggle = 0
    let charRoot: THREE.Group | null = null

    const fade = (a: THREE.AnimationAction | undefined, loopOnce = false, dur = 0.3) => {
      if (!a || a === activeAction) return
      a.reset(); a.setLoop(loopOnce ? THREE.LoopOnce : THREE.LoopRepeat, loopOnce ? 1 : Infinity)
      a.clampWhenFinished = loopOnce; a.setEffectiveWeight(1); a.enabled = true
      if (activeAction) a.crossFadeFrom(activeAction, dur, false)
      a.play(); activeAction = a
    }
    const applyAnim = (t: AnimName) => {
      if (t === 'walk') return fade(actions.walk)
      if (t === 'idle') return fade(actions.idle)
      if (t === 'think') return fade(actions.think)
      if (t === 'greet') return fade(actions.greet, true, 0.25)
      if (t === 'talk') { if (activeAction === actions.talk1 || activeAction === actions.talk2) return; return fade((talkToggle++ % 2 === 0) ? actions.talk1 : actions.talk2) }
    }

    const la = (u: string) => loader.loadAsync(u).then(g => g.animations[0])
    Promise.all([loader.loadAsync(MESH_URL), la(ANIM.idle), la(ANIM.walk), la(ANIM.talk1), la(ANIM.talk2), la(ANIM.greet), la(ANIM.think)])
      .then(([meshG, idle, walk, talk1, talk2, greet, think]) => {
        const model = meshG.scene
        model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false } })
        const bb = new THREE.Box3().setFromObject(model); const sz = bb.getSize(new THREE.Vector3())
        model.scale.setScalar(1.75 / sz.y)
        const bb2 = new THREE.Box3().setFromObject(model); const c = bb2.getCenter(new THREE.Vector3())
        model.position.x -= c.x; model.position.z -= c.z; model.position.y -= bb2.min.y
        charRoot = new THREE.Group(); charRoot.add(model); charRoot.position.set(0, 0, 3.2); scene.add(charRoot)
        walk.tracks.forEach(tr => { if (/Hips\.position$/i.test(tr.name)) { const v = tr.values as unknown as number[]; const x0 = v[0], z0 = v[2]; for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0 } } })
        mixer = new THREE.AnimationMixer(model)
        actions.idle = mixer.clipAction(idle); actions.walk = mixer.clipAction(walk); actions.talk1 = mixer.clipAction(talk1); actions.talk2 = mixer.clipAction(talk2); actions.greet = mixer.clipAction(greet); actions.think = mixer.clipAction(think)
        mixer.addEventListener('finished', e => { if ((e as unknown as { action: THREE.AnimationAction }).action === actions.greet) desiredAnimRef.current = 'idle' })
        actions.idle.play(); activeAction = actions.idle
        setMode('intro')
      })
      .catch(() => { setAvatarError(true); setMode('roam') })

    // ── click-to-move + pillar pick (raycasting) ──
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const onCanvasClick = (ev: PointerEvent) => {
      kickAudio()
      if (modeRef.current === 'loading' || modeRef.current === 'intro') return
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const pillarMeshes: THREE.Object3D[] = []
      for (const p of pillars) p.group.traverse(o => { if ((o as THREE.Mesh).isMesh) { (o.userData as Record<string, unknown>).pillarIndex = p.index; pillarMeshes.push(o) } })
      const hitP = raycaster.intersectObjects(pillarMeshes, false)
      if (hitP.length) {
        const idx = (hitP[0].object.userData as Record<string, number>).pillarIndex
        const info = pillars[idx]
        if (info) { moveTargetRef.current = info.pos.clone().add(new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), info.pos).normalize().multiplyScalar(2.4)); focusPillarFn.current?.(idx) }
        return
      }
      const floorHit = raycaster.intersectObject(floor, false)
      if (floorHit.length) {
        const pt = floorHit[0].point
        const r = Math.hypot(pt.x, pt.z)
        if (r > FLOOR_RADIUS - 0.6) pt.multiplyScalar((FLOOR_RADIUS - 0.6) / r)
        moveTargetRef.current = new THREE.Vector3(pt.x, 0, pt.z)
      }
    }
    renderer.domElement.addEventListener('pointerdown', onCanvasClick)

    // ── camera + loop ──
    const camPos = new THREE.Vector3().copy(camera.position), camLook = new THREE.Vector3(0, 1.2, 0)
    const IA = new THREE.Vector3(0, 6, 13), IB = new THREE.Vector3(0, 3.0, 8.4)
    let introT = 0, strideTimer = 0, raf = 0
    const tmp = new THREE.Vector3(), clock = new THREE.Clock()

    const onResize = () => { camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mount.clientWidth, mount.clientHeight) }
    window.addEventListener('resize', onResize)

    const projectPanelAnchor = () => {
      const idx = activePillarRef.current
      if (idx == null) return
      const info = pillars[idx]; if (!info) return
      const world = info.pos.clone().add(new THREE.Vector3(0, 3.2, 0))
      const s = world.project(camera)
      const rect = renderer.domElement.getBoundingClientRect()
      const sx = (s.x * 0.5 + 0.5) * rect.width, sy = (-s.y * 0.5 + 0.5) * rect.height
      mount.dispatchEvent(new CustomEvent('panelpos', { detail: { x: sx, y: sy, visible: s.z < 1 } }))
    }

    const animate = () => {
      raf = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime
      if (mixer) mixer.update(dt)
      const typing = !!document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)
      let moving = false

      // core animation
      coreInner.rotation.y += dt * 0.5; coreInner.rotation.x += dt * 0.2
      coreInnerMat.emissiveIntensity = 2.0 + Math.sin(t * 2) * 0.6
      coreLight.intensity = 34 + Math.sin(t * 2) * 10
      coreShell.rotation.y -= dt * 0.15
      orbits.forEach((o, i) => { o.rotation.z += dt * (0.3 + i * 0.15); o.rotation.x += dt * 0.1 })
      stars.rotation.y += dt * 0.006

      // pillar idle pulse + focus glow
      for (const p of pillars) {
        const ud = p.group.userData as Record<string, unknown>
        const face = ud.face as THREE.MeshStandardMaterial
        const halo = ud.halo as THREE.PointLight
        const focused = activePillarRef.current === p.index || nearPillarRef.current === p.index
        const targetEi = focused ? 2.4 : 0.6 + Math.sin(t * 1.5 + p.index) * 0.15
        face.emissiveIntensity += (targetEi - face.emissiveIntensity) * Math.min(1, dt * 6)
        halo.intensity += ((focused ? 14 : 5) - halo.intensity) * Math.min(1, dt * 6)
        const num = p.group.getObjectByName('num')
        if (num) num.position.y = 2.72 + Math.sin(t * 1.2 + p.index) * 0.04
      }

      // ── movement ──
      if (charRoot && modeRef.current === 'roam' && !typing) {
        const k = keysRef.current; let dx = 0, dz = 0
        if (k.has('w') || k.has('arrowup')) dz -= 1
        if (k.has('s') || k.has('arrowdown')) dz += 1
        if (k.has('a') || k.has('arrowleft')) dx -= 1
        if (k.has('d') || k.has('arrowright')) dx += 1
        if (dx || dz) moveTargetRef.current = null

        if (!dx && !dz && moveTargetRef.current) {
          const to = moveTargetRef.current
          const ddx = to.x - charRoot.position.x, ddz = to.z - charRoot.position.z
          const dist = Math.hypot(ddx, ddz)
          if (dist > 0.12) { dx = ddx / dist; dz = ddz / dist } else moveTargetRef.current = null
        }
        if (dx || dz) {
          moving = true; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len
          const nx = charRoot.position.x + dx * 2.6 * dt
          const nz = charRoot.position.z + dz * 2.6 * dt
          const r = Math.hypot(nx, nz)
          if (r < FLOOR_RADIUS - 0.6) { charRoot.position.x = nx; charRoot.position.z = nz }
          charRoot.rotation.y = lerpAngle(charRoot.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 12))
        }
        let best = -1, bestD = FOCUS_DIST
        for (const p of pillars) { const d = Math.hypot(charRoot.position.x - p.pos.x, charRoot.position.z - p.pos.z); if (d < bestD) { bestD = d; best = p.index } }
        if (best !== nearPillarRef.current) { setNearPillar(best === -1 ? null : best); if (best !== -1) audioRef.current?.focusPing() }
      }

      if (moving) { strideTimer -= dt; if (strideTimer <= 0) { audioRef.current?.footstep(); strideTimer = 0.34 } } else strideTimer = 0

      const target: AnimName = moving ? 'walk' : desiredAnimRef.current
      applyAnim(target)

      // ── camera ──
      if (modeRef.current === 'intro') { introT += dt; const kk = eio(clamp(introT / 3.0, 0, 1)); camPos.lerpVectors(IA, IB, kk); camLook.set(0, lerp(3.4, 1.4, kk), lerp(-0.2, 2.5, kk)) }
      else if (modeRef.current === 'roam' && charRoot) {
        const p = charRoot.position
        camPos.lerp(tmp.set(p.x * 0.55, 3.4, p.z + 5.6), 1 - Math.exp(-dt * 3.2))
        camLook.lerp(tmp.set(p.x * 0.7, 1.3, p.z - 0.5), 1 - Math.exp(-dt * 4))
      }
      camera.position.copy(camPos); camera.lookAt(camLook)
      projectPanelAnchor()
      renderer.render(scene, camera)
    }
    animate()

    // keyboard
    const kd = (e: KeyboardEvent) => {
      const keyName = e.key.toLowerCase()
      kickAudio()
      if (!!document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(keyName)) e.preventDefault()
      keysRef.current.add(keyName)
      if (keyName === 'e' && nearPillarRef.current != null) focusPillarFn.current?.(nearPillarRef.current)
      if (keyName === 'escape') { setActivePillar(null); setPanelData(null) }
    }
    const ku = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase())
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)

    // expose rebuild for React (live-data pillar refresh)
    ;(mount as unknown as Record<string, unknown>).__rebuildPillars = buildPillars

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku)
      renderer.domElement.removeEventListener('pointerdown', onCanvasClick)
      mixer?.stopAllAction(); audio.dispose(); audioRef.current = null
      pmrem.dispose(); renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── focus a pillar → open its holographic panel ──
  const focusPillar = useCallback((i: number) => {
    const info = pillarsRef.current.find(p => p.index === i)
    if (!info) return
    audioRef.current?.panelOpen()
    setActivePillar(i)
    setPanelData(info.project)
    desiredAnimRef.current = 'talk'
    setTimeout(() => { if (desiredAnimRef.current === 'talk') desiredAnimRef.current = 'idle' }, 2600)
  }, [])
  useEffect(() => { focusPillarFn.current = focusPillar }, [focusPillar])

  // Rebuild pillars if the project list changes (e.g. live data arrives).
  useEffect(() => {
    const mount = mountRef.current as unknown as Record<string, unknown> | null
    const fn = mount?.__rebuildPillars as ((l: ProjectCard[]) => void) | undefined
    if (fn && projects.length) fn(projects)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length])

  // Track the projected panel anchor position (updated each frame by the scene).
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const onPos = (e: Event) => setPanelPos((e as CustomEvent).detail)
    mount.addEventListener('panelpos', onPos)
    return () => mount.removeEventListener('panelpos', onPos)
  }, [])

  // ── intro greeting ──
  useEffect(() => {
    if (mode !== 'intro') return
    desiredAnimRef.current = 'greet'
    const nm = portfolio?.profile?.name || 'Raj'
    setSpeech(`Welcome to my studio — I'm ${nm}. Walk around (WASD, or click the floor) and step up to a pillar to explore a project. Chat with me anytime.`)
    const t = setTimeout(() => { setMode('roam'); setTimeout(() => setSpeech(''), 4000) }, 5200)
    return () => clearTimeout(t)
  }, [mode, portfolio])

  // ── chat reactions ──
  useEffect(() => { if (chatThinking) desiredAnimRef.current = 'think' }, [chatThinking])
  useEffect(() => {
    const last = chatHistory[chatHistory.length - 1]
    if (!last || last.role !== 'assistant' || chatThinking) return
    desiredAnimRef.current = 'talk'
    audioRef.current?.blipRecv()
    if (!chatOpen) setSpeech(last.content)
    const dur = Math.min(14000, Math.max(2800, last.content.length * 42))
    const t = setTimeout(() => { desiredAnimRef.current = 'idle' }, dur)
    return () => clearTimeout(t)
  }, [chatHistory, chatThinking, chatOpen])

  useEffect(() => { const el = transcriptRef.current; if (el) el.scrollTop = el.scrollHeight }, [chatHistory, chatThinking, chatOpen])

  const submit = () => { const v = input.trim(); if (!v || chatThinking) return; setInput(''); audioRef.current?.blipSend(); sendChat(v) }
  const press = (keyName: string, down: boolean) => { if (down) keysRef.current.add(keyName); else keysRef.current.delete(keyName) }
  const toggleMute = () => { const n = !muted; setMuted(n); audioRef.current?.setMuted(n); if (!n) audioRef.current?.resume().then(() => audioRef.current?.startMusic()) }
  const closePanel = () => { setActivePillar(null); setPanelData(null) }

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
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, cursor: mode === 'roam' ? 'pointer' : 'default' }} />

      {/* top bar */}
      <div style={{ position: 'absolute', top: 16, left: 18, display: 'flex', alignItems: 'center', gap: 10, zIndex: 30, fontFamily: C.font }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, color: C.ink, fontWeight: 700, fontSize: '0.86rem', backdropFilter: 'blur(10px)' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: C.gradient, boxShadow: '0 0 12px rgba(16,185,129,0.8)' }} />
          Neural Studio
        </span>
      </div>
      <div style={{ position: 'absolute', top: 16, right: 18, display: 'flex', gap: 10, zIndex: 30 }}>
        <button onClick={toggleMute} style={ghostBtn} title="Sound">{muted ? '🔇' : '🔊'}</button>
        <button onClick={() => setChatOpen(o => !o)} style={chatOpen ? { ...ghostBtn, borderColor: C.borderAccent, color: C.emeraldHex } : ghostBtn}>{chatOpen ? '✕ Chat' : '💬 Chat'}</button>
        <button onClick={onExitClassic} style={ghostBtn}>← Classic site</button>
      </div>

      {/* speech bubble */}
      {speech && mode !== 'loading' && (
        <div style={{ position: 'absolute', top: '9%', left: '50%', transform: 'translateX(-50%)', maxWidth: 'min(680px,88vw)', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 22px', color: C.ink, fontFamily: C.font, fontSize: 'clamp(0.9rem,1.7vw,1.05rem)', lineHeight: 1.55, textAlign: 'center', backdropFilter: 'blur(12px)', pointerEvents: 'none', zIndex: 20, boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>{speech}</div>
      )}

      {/* roam HUD */}
      {mode === 'roam' && (
        <>
          <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', color: C.ink2, background: C.panel, border: `1px solid ${C.border}`, padding: '8px 18px', borderRadius: 20, fontFamily: C.font, fontSize: '0.8rem', fontWeight: 500, zIndex: 15, backdropFilter: 'blur(10px)', textAlign: 'center' }}>
            Click the floor or use WASD to move{nearPillar != null ? '  ·  press E to open this project' : '  ·  step up to a pillar'}
          </div>
          <div style={{ position: 'absolute', bottom: 64, left: 22, zIndex: 22, display: 'grid', gridTemplateColumns: 'repeat(3,46px)', gridTemplateRows: 'repeat(3,46px)', gap: 6, touchAction: 'none' }}>
            {([['', 'w', ''], ['a', '', 'd'], ['', 's', '']] as const).flat().map((kk, i) => kk ? <button key={i} onPointerDown={e => { e.preventDefault(); press(kk, true) }} onPointerUp={() => press(kk, false)} onPointerLeave={() => press(kk, false)} style={dpad}>{kk.toUpperCase()}</button> : <span key={i} />)}
          </div>
        </>
      )}

      {/* focus prompt near a pillar */}
      {mode === 'roam' && nearPillar != null && activePillar == null && (
        <button onClick={() => focusPillar(nearPillar)} style={{ position: 'absolute', top: '42%', left: '50%', transform: 'translateX(-50%)', color: '#04140c', background: C.gradient, padding: '11px 22px', borderRadius: 12, fontFamily: C.font, fontWeight: 700, fontSize: '0.92rem', zIndex: 18, boxShadow: '0 8px 30px rgba(16,185,129,0.4)', cursor: 'pointer', border: 'none' }}>
          Open “{projects[nearPillar]?.title}” ▸
        </button>
      )}

      {/* ── HOLOGRAPHIC PROJECT PANEL (anchored to pillar) ── */}
      {panelData && (
        <ProjectPanel data={panelData} anchor={panelPos} onClose={closePanel} onAsk={() => {
          setChatOpen(true)
          audioRef.current?.blipSend()
          sendChat(`Tell me about ${panelData.title}.`)
        }} />
      )}

      {/* ── RajBot chat dock ── */}
      {chatOpen && (
        <div style={{ position: 'absolute', bottom: 0, right: 0, width: 'min(430px,96vw)', maxHeight: '64vh', display: 'flex', flexDirection: 'column', background: C.panelSolid, border: `1px solid ${C.border}`, borderRadius: '16px 0 0 0', backdropFilter: 'blur(14px)', zIndex: 28, boxShadow: '0 -8px 40px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 16px 6px', color: C.ink, fontFamily: C.font, fontWeight: 700, fontSize: '0.95rem' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: C.gradient }} />RajBot
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: C.muted, fontWeight: 500 }}>grounded in real documents</span>
          </div>
          <div ref={transcriptRef} style={{ overflowY: 'auto', padding: '8px 16px 6px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {chatHistory.length === 0 && <div style={{ color: C.muted, fontFamily: C.font, fontSize: '0.86rem' }}>Ask me about Raj's projects, experience, skills, or availability.</div>}
            {chatHistory.map((m, i) => <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '9px 13px', borderRadius: 12, whiteSpace: 'pre-wrap', fontFamily: C.font, fontSize: '0.88rem', lineHeight: 1.55, background: m.role === 'user' ? C.accentSoft : 'rgba(255,255,255,0.05)', border: `1px solid ${m.role === 'user' ? C.borderAccent : C.border}`, color: m.role === 'user' ? C.ink : C.ink2 }}>{m.content}</div>)}
            {chatThinking && <div style={{ alignSelf: 'flex-start', color: C.muted, fontFamily: C.font, fontSize: '0.86rem', padding: '4px 13px' }}>Raj is thinking…</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '10px 14px 14px' }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} placeholder="Ask about Raj's work…" autoFocus style={inputStyle} />
            <button onClick={submit} disabled={chatThinking || !input.trim()} style={{ ...primaryBtn, opacity: chatThinking || !input.trim() ? 0.4 : 1 }}>Send</button>
          </div>
        </div>
      )}

      {/* ── loading overlay ── */}
      {mode === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#05070a', color: C.ink, fontFamily: C.font, zIndex: 60, gap: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '1.15rem', fontWeight: 700 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: C.gradient, boxShadow: '0 0 16px rgba(16,185,129,0.8)', animation: 's3dPulse 1.4s ease-in-out infinite' }} />
            Entering the Neural Studio
          </div>
          <div style={{ width: 260, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(6, progress)}%`, height: '100%', background: C.gradient, transition: 'width .25s ease', borderRadius: 3 }} />
          </div>
          <div style={{ color: C.muted, fontSize: '0.82rem', letterSpacing: '0.04em' }}>{progress < 100 ? `Loading assets… ${progress}%` : 'Assembling scene…'}</div>
        </div>
      )}

      {avatarError && <div style={{ position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)', color: '#fca5a5', fontFamily: C.font, fontSize: '0.82rem', zIndex: 60 }}>(avatar failed to load — the studio and chat still work)</div>}
      {mode === 'intro' && <button onClick={() => { setMode('roam'); setSpeech('') }} style={{ ...ghostBtn, position: 'absolute', bottom: 24, right: 28, zIndex: 30 }}>Skip intro ▸</button>}

      <style>{`@keyframes s3dPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.5);opacity:.6}}
        @keyframes s3dPanelIn{from{opacity:0;transform:translate(-50%,-46%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`}</style>
    </div>
  )
}

// ── Holographic project panel (React overlay anchored to the pillar) ─────────
function ProjectPanel({ data, anchor, onClose, onAsk }: {
  data: ProjectCard; anchor: { x: number; y: number; visible: boolean }; onClose: () => void; onAsk: () => void
}) {
  const style: React.CSSProperties = anchor.visible
    ? { position: 'absolute', left: clampPx(anchor.x), top: clampPx(anchor.y, true), transform: 'translate(-50%,-50%)' }
    : { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }
  return (
    <div style={{
      ...style, width: 'min(400px,90vw)', maxHeight: '70vh', overflowY: 'auto', zIndex: 40,
      background: C.panelSolid, border: `1px solid ${C.borderAccent}`, borderRadius: 16, padding: '20px 22px',
      backdropFilter: 'blur(16px)', boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(34,211,238,0.12), 0 0 40px rgba(16,185,129,0.15)',
      fontFamily: C.font, animation: 's3dPanelIn .28s cubic-bezier(.2,.8,.2,1)',
    }}>
      <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
      <div style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: C.emeraldHex, fontWeight: 600, marginBottom: 6 }}>Project</div>
      <div style={{ color: C.ink, fontWeight: 700, fontSize: '1.12rem', lineHeight: 1.25, marginBottom: 10, paddingRight: 18 }}>{data.title}</div>
      <div style={{ color: C.ink2, fontSize: '0.9rem', lineHeight: 1.6 }}>{data.summary}</div>
      {(data.whatItDoes?.length ?? 0) > 0 && (
        <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {data.whatItDoes!.slice(0, 5).map((w, j) => (
            <li key={j} style={{ display: 'flex', gap: 8, fontSize: '0.85rem', lineHeight: 1.5, color: C.ink2 }}><span style={{ color: C.emeraldHex }}>▸</span>{w}</li>
          ))}
        </ul>
      )}
      {data.techStack?.length > 0 && (
        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {data.techStack.map(t => <span key={t} style={{ fontSize: '0.72rem', fontWeight: 500, padding: '4px 10px', borderRadius: 7, background: C.cyanSoft, border: `1px solid rgba(34,211,238,0.35)`, color: C.cyanHex }}>{t}</span>)}
        </div>
      )}
      <button onClick={onAsk} style={{ ...primaryBtn, marginTop: 16, width: '100%', justifyContent: 'center' }}>💬 Ask RajBot about this</button>
    </div>
  )
}
function clampPx(v: number, isY = false) {
  const max = isY ? window.innerHeight - 40 : window.innerWidth - 40
  return `${Math.round(clamp(v, 40, max))}px`
}

// ── shared button styles ─────────────────────────────────────────────────────
const ghostBtn: React.CSSProperties = { background: 'rgba(12,14,18,0.7)', border: `1px solid ${C.border}`, color: C.ink, fontFamily: C.font, fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.02em', padding: '9px 14px', cursor: 'pointer', borderRadius: 10, backdropFilter: 'blur(10px)' }
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, background: C.gradient, border: 'none', color: '#04140c', fontFamily: C.font, fontSize: '0.82rem', fontWeight: 700, padding: '10px 16px', cursor: 'pointer', borderRadius: 10 }
const dpad: React.CSSProperties = { background: 'rgba(16,185,129,0.14)', border: `1px solid ${C.borderAccent}`, color: C.emeraldHex, fontFamily: C.font, fontWeight: 700, borderRadius: 12, cursor: 'pointer', touchAction: 'none', backdropFilter: 'blur(6px)' }
const inputStyle: React.CSSProperties = { flex: 1, background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`, borderRadius: 10, color: C.ink, fontFamily: C.font, fontSize: '0.92rem', padding: '11px 14px', outline: 'none' }
