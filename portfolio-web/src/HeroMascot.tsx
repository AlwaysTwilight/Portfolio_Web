import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { prefersReducedMotion, useTabHidden } from './Terminal3D/theme'

// ── HeroMascot ───────────────────────────────────────────────────────────────
// The robot mascot lives IN the hero section (filling the empty space to the
// right, alongside the stats card) — NOT a small corner-docked widget. This is
// deliberately a SEPARATE, much lighter Three.js context from the 3D Studio's
// full free-roam scene: one mesh, one light rig, a capped-size canvas, no
// postprocessing, no movement logic.
//
// Behavior:
//  - On mount: plays the robot's one baked clip ("Take 001", a wave/gesture)
//    ONCE as a greeting, paired with a speech bubble. No idle spin/rotation —
//    the model just sits still between clip plays.
//  - After the greeting: settles into a loop of the SAME clip (it reads as
//    idle-with-occasional-wave) — no separate procedural idle motion layered
//    on top, and specifically no continuous rotation.
//  - Head + eyes track the mouse cursor position on the page (found via bone
//    name matching against the robot's rig — head/neck/eye* nodes per the
//    earlier model inspection). Body stays put; only the head (and eye nodes,
//    if they are real transformable nodes rather than pure morph targets)
//    turn toward the cursor, clamped to a small natural range.
//  - `pulse` (nav-click reactions) still does a small one-shot nod, since that
//    was working and the user didn't object to it — only the continuous idle
//    spin was called out as unwanted.
//
// Perf gating: paused when scrolled off-screen (IntersectionObserver) or when
// the tab is hidden (useTabHidden) or the user prefers reduced motion (static
// pose only, no RAF loop at all in that case).

const MASCOT_URL = '/models/robot_mascot.glb'

interface Props {
  /** Bump this number to trigger a one-shot "reaction" nod/pulse. */
  pulse?: number
  width?: number
  height?: number
}

function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch { return false }
}

// Bone-name matchers for the head/eye rig (case-insensitive substring match —
// exact names in the source FBX->GLB conversion weren't documented, so we
// match loosely against the "head/neck/eye" vocabulary noted during asset
// inspection).
const HEAD_RE = /head/i
const EYE_RE = /eye/i
const NECK_RE = /neck/i

export default function HeroMascot({ pulse = 0, width = 340, height = 380 }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(true)
  const [greeting, setGreeting] = useState(true)
  const tabHidden = useTabHidden()
  const reduced = prefersReducedMotion()

  const reactRef = useRef(0) // >0 while a nav-click reaction nod is playing (seconds remaining)
  const pulseSeenRef = useRef(0)
  // Normalized pointer position in [-1, 1], updated on pointermove anywhere on
  // the page (so the robot can "watch" the visitor even off-canvas).
  const pointerRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (pulse > pulseSeenRef.current) { reactRef.current = 0.6; pulseSeenRef.current = pulse }
  }, [pulse])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Track the mouse anywhere on the page (not just over the canvas) so the
  // robot can watch the visitor as they read/scroll nearby copy.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointerRef.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointerRef.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const onGreetDone = useCallback(() => setGreeting(false), [])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    if (!webglSupported()) { setFailed(true); return }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setSize(width, height)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.05, 30)
    camera.position.set(0, 1.5, 4.6)
    camera.lookAt(0, 1.05, 0)

    scene.add(new THREE.HemisphereLight(0x223044, 0x05070a, 0.95))
    const key = new THREE.DirectionalLight(0xffffff, 1.7)
    key.position.set(2.5, 4, 3)
    scene.add(key)
    const rim = new THREE.PointLight(0x22d3ee, 20, 9, 2)
    rim.position.set(-1.8, 2, -1.4)
    scene.add(rim)
    const fill = new THREE.PointLight(0x10b981, 16, 9, 2)
    fill.position.set(1.6, 1, 1.3)
    scene.add(fill)

    // soft ground glow disc
    const glowCv = document.createElement('canvas')
    glowCv.width = 128; glowCv.height = 128
    const glowCx = glowCv.getContext('2d')!
    const grad = glowCx.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(16,185,129,0.45)')
    grad.addColorStop(0.6, 'rgba(16,185,129,0.12)')
    grad.addColorStop(1, 'rgba(16,185,129,0)')
    glowCx.fillStyle = grad
    glowCx.fillRect(0, 0, 128, 128)
    const glowTex = new THREE.CanvasTexture(glowCv)
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.3, 32),
      new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.6, depthWrite: false }),
    )
    glow.rotation.x = -Math.PI / 2
    glow.position.y = 0.01
    scene.add(glow)

    let mixer: THREE.AnimationMixer | null = null
    let action: THREE.AnimationAction | null = null
    let root: THREE.Group | null = null
    let headBone: THREE.Object3D | null = null
    let neckBone: THREE.Object3D | null = null
    const eyeBones: THREE.Object3D[] = []
    // Base (rest-pose) local quaternions for the head/neck/eyes, captured once
    // after load, so cursor-tracking offsets from rest rather than drifting.
    let headBaseQuat: THREE.Quaternion | null = null
    let neckBaseQuat: THREE.Quaternion | null = null
    const eyeBaseQuats: THREE.Quaternion[] = []

    // Guards against React StrictMode's dev-only double-invoke of this effect
    // (mount -> cleanup -> mount again): without this, a loader callback from
    // an already-cleaned-up first pass can still fire and mutate a disposed
    // scene / fire a second greeting timer, so the greeting bubble would show
    // for only a fraction of its intended window instead of the full ~2.6s.
    let cancelled = false
    const loader = new GLTFLoader()
    loader.load(
      MASCOT_URL,
      (gltf) => {
        if (cancelled) return
        const model = gltf.scene
        // The source asset's "holo" node is a Maya MASH-scattered cluster of
        // orbiting toy shapes (gears/pyramids/tori/etc) plus a ground platform,
        // animated on the same clip as the robot's arm. At this close-up hero
        // framing those shapes swing through the frame as a giant slashing bar
        // right across the robot's neck/face — remove the whole node so only
        // the actual robot (bot_geo) renders. Bounding-box/scale is computed
        // AFTER this removal so the toy cluster doesn't skew centering either.
        const holoNode = model.getObjectByName('holo')
        if (holoNode) holoNode.parent?.remove(holoNode)
        model.traverse(o => {
          const m = o as THREE.Mesh
          if (m.isMesh) m.frustumCulled = false
          if (HEAD_RE.test(o.name) && !NECK_RE.test(o.name) && !headBone) headBone = o
          if (NECK_RE.test(o.name) && !neckBone) neckBone = o
          if (EYE_RE.test(o.name)) eyeBones.push(o)
        })
        const bb = new THREE.Box3().setFromObject(model)
        const sz = bb.getSize(new THREE.Vector3())
        const targetHeight = 2.15
        model.scale.setScalar(targetHeight / Math.max(sz.y, 0.001))
        const bb2 = new THREE.Box3().setFromObject(model)
        const c = bb2.getCenter(new THREE.Vector3())
        model.position.x -= c.x; model.position.z -= c.z; model.position.y -= bb2.min.y
        root = new THREE.Group()
        root.add(model)
        scene.add(root)

        headBaseQuat = headBone ? headBone.quaternion.clone() : null
        neckBaseQuat = neckBone ? neckBone.quaternion.clone() : null
        eyeBones.forEach(b => eyeBaseQuats.push(b.quaternion.clone()))

        if (gltf.animations?.length) {
          mixer = new THREE.AnimationMixer(model)
          action = mixer.clipAction(gltf.animations[0])
          action.setLoop(THREE.LoopRepeat, Infinity)
          action.play()
        }
        setReady(true)
      },
      undefined,
      () => setFailed(true),
    )

    let raf = 0
    const clock = new THREE.Clock()
    const tmpEuler = new THREE.Euler()
    const tmpQuat = new THREE.Quaternion()
    const animate = () => {
      raf = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05)
      const t = clock.elapsedTime
      if (mixer) mixer.update(dt)
      glow.material && ((glow.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t * 1.3) * 0.1)

      // Cursor tracking: turn head/neck/eyes toward the pointer. Body (root)
      // is intentionally left untouched — no spin, no idle rotation.
      const px = THREE.MathUtils.clamp(pointerRef.current.x, -1, 1)
      const py = THREE.MathUtils.clamp(pointerRef.current.y, -1, 1)
      const yaw = px * 0.35   // radians, small natural range
      const pitch = -py * 0.2
      if (headBone && headBaseQuat) {
        tmpEuler.set(pitch, yaw, 0, 'YXZ')
        tmpQuat.setFromEuler(tmpEuler)
        headBone.quaternion.copy(headBaseQuat).multiply(tmpQuat)
      }
      if (neckBone && neckBaseQuat) {
        tmpEuler.set(pitch * 0.4, yaw * 0.4, 0, 'YXZ')
        tmpQuat.setFromEuler(tmpEuler)
        neckBone.quaternion.copy(neckBaseQuat).multiply(tmpQuat)
      }
      eyeBones.forEach((b, i) => {
        const base = eyeBaseQuats[i]
        if (!base) return
        tmpEuler.set(pitch * 0.6, yaw * 0.6, 0, 'YXZ')
        tmpQuat.setFromEuler(tmpEuler)
        b.quaternion.copy(base).multiply(tmpQuat)
      })

      if (root) {
        // Nav-click reaction: a quick friendly nod/scale pulse only — no
        // continuous idle motion on the root.
        if (reactRef.current > 0) {
          reactRef.current -= dt
          const k = Math.max(0, reactRef.current) / 0.6
          const wave = Math.sin((1 - k) * Math.PI * 3) * k
          root.rotation.z = wave * 0.07
          const s = 1 + wave * 0.04
          root.scale.setScalar(s)
        } else {
          root.rotation.z = 0
          root.scale.setScalar(1)
        }
      }
      renderer.render(scene, camera)
    }
    if (!reduced) animate()
    else renderer.render(scene, camera)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      mixer?.stopAllAction()
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, reduced])

  // Greeting window: the clip plays once (~2.6s, matches the wave gesture
  // length observed during asset inspection) with a speech bubble, then we
  // drop into the ordinary idle-loop + cursor-tracking state.
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(onGreetDone, 2600)
    return () => clearTimeout(t)
  }, [ready, onGreetDone])

  const paused = !visible || tabHidden

  return (
    <div
      ref={wrapRef}
      style={{
        width, height, position: 'relative',
        opacity: ready ? 1 : 0, transition: 'opacity .5s ease',
        filter: paused ? 'saturate(0.9)' : 'none',
      }}
    >
      <div ref={mountRef} style={{ width, height }} aria-hidden />
      {ready && greeting && (
        <div className="mascot-greet-bubble" role="status">
          Hey, I'm Raj's assistant — welcome! 👋
        </div>
      )}
      {failed && null}
    </div>
  )
}
