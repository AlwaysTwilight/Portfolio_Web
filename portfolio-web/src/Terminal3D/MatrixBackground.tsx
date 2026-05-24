import { useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// ── Matrix rain rendered on a canvas texture ─────────────────────────────────

function MatrixPlane() {
  const meshRef = useRef<THREE.Mesh>(null)
  const textureRef = useRef<THREE.CanvasTexture | null>(null)
  const matrixCtxRef = useRef<{
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
    cols: number
    drops: number[]
    chars: string
  } | null>(null)

  useEffect(() => {
    const W = 800, H = 500
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!
    const fontSize = 13
    const cols = Math.floor(W / fontSize)
    const drops = Array.from({ length: cols }, () => Math.random() * H / fontSize | 0)
    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/\\|{}[]!?'

    const texture = new THREE.CanvasTexture(canvas)
    textureRef.current = texture

    matrixCtxRef.current = { canvas, ctx, cols, drops, chars }

    if (meshRef.current) {
      ;(meshRef.current.material as THREE.MeshBasicMaterial).map = texture
    }

    return () => { texture.dispose() }
  }, [])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (!matrixCtxRef.current || !textureRef.current) return

    const { canvas, ctx, cols, drops, chars } = matrixCtxRef.current

    // Fade existing frame
    ctx.fillStyle = 'rgba(2, 14, 3, 0.06)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const fontSize = 13
    ctx.font = `${fontSize}px monospace`

    for (let i = 0; i < cols; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)]
      const x = i * fontSize
      const y = drops[i] * fontSize

      // Brighter leading character
      ctx.fillStyle = i % 5 === 0 ? '#aaffaa' : '#00b32d'
      ctx.fillText(char, x, y)

      // Occasionally bright white flash at the front
      if (Math.random() > 0.97) {
        ctx.fillStyle = '#ccffcc'
        ctx.fillText(char, x, y)
      }

      if (y > canvas.height && Math.random() > 0.975) {
        drops[i] = 0
      }
      drops[i] += 0.45 + Math.sin(t + i) * 0.05
    }

    textureRef.current.needsUpdate = true
  })

  return (
    <mesh ref={meshRef} position={[0, 0, -2]}>
      <planeGeometry args={[10, 7]} />
      <meshBasicMaterial transparent opacity={0.55} toneMapped={false} />
    </mesh>
  )
}

// ── Floating particles with depth ────────────────────────────────────────────

function FloatingParticles() {
  const pointsRef = useRef<THREE.Points>(null)
  const posRef = useRef<Float32Array | null>(null)

  useEffect(() => {
    const count = 350
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 12
      pos[i * 3 + 1] = (Math.random() - 0.5) * 8
      pos[i * 3 + 2] = (Math.random() - 0.5) * 6
    }
    posRef.current = pos
    if (pointsRef.current) {
      pointsRef.current.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(pos, 3)
      )
    }
  }, [])

  useFrame(({ clock }) => {
    if (!pointsRef.current || !posRef.current) return
    const t = clock.getElapsedTime()
    const pos = posRef.current
    const count = pos.length / 3

    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] -= 0.004 + (i % 3) * 0.001
      if (pos[i * 3 + 1] < -4) pos[i * 3 + 1] = 4
      // gentle horizontal wave
      pos[i * 3] += Math.sin(t * 0.3 + i * 0.7) * 0.0006
    }

    ;(pointsRef.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    pointsRef.current.rotation.y = Math.sin(t * 0.05) * 0.04
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry />
      <pointsMaterial
        size={0.025}
        color="#00ff41"
        transparent
        opacity={0.55}
        sizeAttenuation
      />
    </points>
  )
}

// ── Camera breathe ────────────────────────────────────────────────────────────

function CameraBreath() {
  useFrame(({ camera, clock }) => {
    const t = clock.getElapsedTime()
    camera.position.x = Math.sin(t * 0.18) * 0.12
    camera.position.y = Math.cos(t * 0.13) * 0.06
    camera.lookAt(0, 0, 0)
  })
  return null
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MatrixBackground() {
  return (
    <Canvas
      className="t3d-canvas"
      camera={{ position: [0, 0, 3], fov: 60 }}
      gl={{ antialias: false }}
    >
      <color attach="background" args={['#020e03']} />
      <MatrixPlane />
      <FloatingParticles />
      <CameraBreath />
    </Canvas>
  )
}
