import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { ChatMessage, PortfolioData } from './useTerminal'
import { AudioManager } from './audio'

// ── Explorable, textured 3D room: drive Raj, chat, sit at the PC ─────────────

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

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const eio = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function lerpAngle(a: number, b: number, t: number) { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t }

const PC_POINT = new THREE.Vector3(0, 0, -1.7)
const PC_RADIUS = 1.5
const MON = new THREE.Vector3(0, 1.2, -3.15)

// ── material / geometry helpers ──────────────────────────────────────────────
const std = (color: number, roughness = 0.8, metalness = 0, emissive?: number, ei = 1) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness })
  if (emissive !== undefined) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = ei }
  return m
}
function rbox(w: number, h: number, d: number, mat: THREE.Material, r = 0.04) {
  const rad = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.max(0.005, rad)), mat)
}
const cyl = (rt: number, rb: number, h: number, s: number, m: THREE.Material) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), m)
const sph = (r: number, m: THREE.Material) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m)
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => { o.position.set(x, y, z); return o }

// ── canvas-texture generators (detail without asset files) ───────────────────
function makeTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  draw(cv.getContext('2d')!)
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]) }
  return t
}
const woodFloorTex = () => makeTex(512, 512, c => {
  const planks = 5, ph = 512 / planks, base = ['#b07e4e', '#a9764a', '#b8855a', '#a06f44', '#b27f52']
  for (let i = 0; i < planks; i++) {
    c.fillStyle = base[i % base.length]; c.fillRect(0, i * ph, 512, ph)
    for (let g = 0; g < 22; g++) { c.strokeStyle = `rgba(80,55,30,${0.04 + Math.random() * 0.05})`; c.lineWidth = 1 + Math.random(); c.beginPath(); const y = i * ph + Math.random() * ph; c.moveTo(0, y); c.bezierCurveTo(170, y + (Math.random() * 8 - 4), 340, y + (Math.random() * 8 - 4), 512, y + (Math.random() * 8 - 4)); c.stroke() }
    c.fillStyle = 'rgba(40,25,12,0.5)'; c.fillRect(0, i * ph, 512, 2)
    c.fillStyle = 'rgba(40,25,12,0.3)'; c.fillRect(Math.random() * 512, i * ph, 2, ph)
  }
}, [4, 4])
const wallTex = () => makeTex(256, 256, c => { c.fillStyle = '#ece6dc'; c.fillRect(0, 0, 256, 256); for (let i = 0; i < 2600; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.02})`; c.fillRect(Math.random() * 256, Math.random() * 256, 1, 1) } }, [3, 2])
const rugTex = () => makeTex(512, 512, c => {
  c.fillStyle = '#2a5b63'; c.fillRect(0, 0, 512, 512)
  c.strokeStyle = '#d9c08a'; c.lineWidth = 18; c.strokeRect(26, 26, 460, 460)
  c.strokeStyle = '#3f8893'; c.lineWidth = 8; c.strokeRect(58, 58, 396, 396)
  c.strokeStyle = 'rgba(217,192,138,0.7)'; c.lineWidth = 4
  for (let i = 0; i < 4; i++) { const s = 70 + i * 42; c.beginPath(); c.moveTo(256, 256 - s); c.lineTo(256 + s, 256); c.lineTo(256, 256 + s); c.lineTo(256 - s, 256); c.closePath(); c.stroke() }
})
const skyTex = () => makeTex(512, 640, c => {
  const g = c.createLinearGradient(0, 0, 0, 640); g.addColorStop(0, '#7db8e8'); g.addColorStop(0.6, '#c2e1f5'); g.addColorStop(1, '#e9f4e2'); c.fillStyle = g; c.fillRect(0, 0, 512, 640)
  const sg = c.createRadialGradient(150, 150, 8, 150, 150, 130); sg.addColorStop(0, 'rgba(255,250,225,0.95)'); sg.addColorStop(1, 'rgba(255,250,225,0)'); c.fillStyle = sg; c.fillRect(0, 0, 340, 340)
  c.fillStyle = 'rgba(255,255,255,0.85)';[[360, 120, 40], [402, 132, 55], [328, 140, 44], [150, 270, 38], [200, 280, 52]].forEach(([x, y, r]) => { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill() })
  c.fillStyle = '#5a7d4a'; c.beginPath(); c.moveTo(0, 520); c.quadraticCurveTo(128, 440, 256, 510); c.quadraticCurveTo(384, 470, 512, 520); c.lineTo(512, 640); c.lineTo(0, 640); c.fill()
  c.fillStyle = '#46663a'; c.beginPath(); c.moveTo(0, 580); c.quadraticCurveTo(160, 520, 320, 575); c.quadraticCurveTo(420, 545, 512, 580); c.lineTo(512, 640); c.lineTo(0, 640); c.fill()
})
const posterTex = (kind: number) => makeTex(400, 560, c => {
  if (kind === 0) { const g = c.createLinearGradient(0, 0, 400, 560); g.addColorStop(0, '#1d4ed8'); g.addColorStop(1, '#7c3aed'); c.fillStyle = g; c.fillRect(0, 0, 400, 560); c.fillStyle = 'rgba(255,255,255,0.92)'; c.textAlign = 'center'; c.font = 'bold 90px monospace'; c.fillText('</>', 200, 270); c.font = 'bold 38px monospace'; c.fillText('CODE', 200, 340) }
  else { const g = c.createLinearGradient(0, 0, 0, 560); g.addColorStop(0, '#fbbf24'); g.addColorStop(1, '#7c2d12'); c.fillStyle = g; c.fillRect(0, 0, 400, 560); c.fillStyle = 'rgba(255,255,255,0.92)'; c.beginPath(); c.arc(300, 150, 46, 0, 7); c.fill(); c.fillStyle = '#3b1d0e'; c.beginPath(); c.moveTo(0, 400); c.lineTo(120, 250); c.lineTo(220, 380); c.lineTo(300, 230); c.lineTo(400, 400); c.lineTo(400, 560); c.lineTo(0, 560); c.fill() }
})
const fabricTex = (base: string, line = 'rgba(0,0,0,0.06)') => makeTex(128, 128, c => { c.fillStyle = base; c.fillRect(0, 0, 128, 128); c.strokeStyle = line; c.lineWidth = 1; for (let i = 0; i < 128; i += 6) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 128); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(128, i); c.stroke() } }, [3, 3])
const duvetTex = (base: string) => makeTex(256, 256, c => { c.fillStyle = base; c.fillRect(0, 0, 256, 256); c.strokeStyle = 'rgba(0,0,0,0.10)'; c.lineWidth = 2; for (let i = -256; i < 256; i += 46) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 256, 256); c.stroke(); c.beginPath(); c.moveTo(i + 256, 0); c.lineTo(i, 256); c.stroke() } }, [2, 2])
const stdMap = (tex: THREE.Texture, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ map: tex, roughness: rough, metalness: metal })

function neonSign(text: string, color = '#2ee6a0') {
  return makeTex(512, 160, c => { c.clearRect(0, 0, 512, 160); c.font = 'bold 92px "Courier New",monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = color; c.shadowBlur = 30; c.fillStyle = color; c.fillText(text, 256, 86); c.fillText(text, 256, 86) })
}

// ── BED ──────────────────────────────────────────────────────────────────────
function buildBed() {
  const bed = new THREE.Group()
  const wood = std(0x6b4a2a, 0.5, 0.05)
  const sheet = stdMap(fabricTex('#eef2f7'), 0.9)
  const duvet = stdMap(duvetTex('#3b6db5'), 0.85)
  const pillow = stdMap(fabricTex('#f6f8fb'), 0.95)
  bed.add(at(rbox(2.0, 0.3, 2.5, wood, 0.05), 0, 0.2, 0))
  bed.add(at(rbox(2.0, 0.95, 0.14, wood, 0.05), 0, 0.68, -1.25))
  bed.add(at(rbox(1.9, 0.28, 2.4, sheet, 0.08), 0, 0.47, 0.03))
  bed.add(at(rbox(1.94, 0.18, 1.65, duvet, 0.08), 0, 0.62, 0.38))
  bed.add(at(rbox(1.94, 0.1, 0.42, sheet, 0.05), 0, 0.68, -0.46))
  ;[-0.45, 0.45].forEach(x => bed.add(at(rbox(0.72, 0.2, 0.46, pillow, 0.1), x, 0.64, -0.82)))
  bed.add(at(rbox(1.9, 0.1, 0.5, stdMap(fabricTex('#c2683f'), 0.9), 0.05), 0, 0.66, 0.98))
  bed.traverse(o => { const m = o as THREE.Mesh; m.castShadow = true; m.receiveShadow = true })
  return bed
}

// ── ROOM ─────────────────────────────────────────────────────────────────────
function buildRoom() {
  const room = new THREE.Group()
  const wallMat = stdMap(wallTex(), 0.95)
  const featureMat = std(0x28324a, 0.9)
  const woodMat = std(0x5a4124, 0.55, 0.1)
  const blackMat = std(0x16161c, 0.5, 0.2)
  const metalMat = std(0x6a7280, 0.35, 0.85)
  const fabricMat = std(0x2b2f38, 0.95)
  const trimMat = std(0xf6f2ea, 0.8)

  // floor + ceiling + walls
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 16), stdMap(woodFloorTex(), 0.7, 0.05)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; room.add(floor)
  const back = new THREE.Mesh(new THREE.PlaneGeometry(18, 10), featureMat); back.position.set(0, 5, -5); back.receiveShadow = true; room.add(back)
  const lw = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), wallMat); lw.rotation.y = Math.PI / 2; lw.position.set(-8, 5, 0); lw.receiveShadow = true; room.add(lw)
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), wallMat); rw.rotation.y = -Math.PI / 2; rw.position.set(8, 5, 0); rw.receiveShadow = true; room.add(rw)
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(18, 16), std(0xf4f1ea, 1)); ceil.rotation.x = Math.PI / 2; ceil.position.y = 10; room.add(ceil)
  ;[[0, -4.96, 18, 0], [-7.96, 0, 16, Math.PI / 2], [7.96, 0, 16, Math.PI / 2]].forEach(([x, z, w, ry]) => { const b = rbox(w as number, 0.2, 0.06, trimMat, 0.02); b.position.set(x as number, 0.1, z as number); b.rotation.y = ry as number; room.add(b) })

  // neon sign + posters on feature wall
  room.add(at(new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshBasicMaterial({ map: neonSign('<RAJ/>'), transparent: true })), 0, 3.6, -4.94))
  room.add(at(new THREE.PointLight(0x2ee6a0, 2.0, 6, 2), 0, 3.4, -4.2) as THREE.PointLight)
  ;[[-3.4, 0], [3.4, 1]].forEach(([x, k]) => { room.add(at(rbox(1.1, 1.5, 0.05, std(0x2a1c0e, 0.6), 0.02), x as number, 3.2, -4.93)); room.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.96, 1.36), stdMap(posterTex(k as number), 0.9)), x as number, 3.2, -4.9)) })

  // window with real view + frame + curtains
  const winView = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.9), new THREE.MeshBasicMaterial({ map: skyTex() })); winView.rotation.y = Math.PI / 2; at(winView, -7.88, 4, -1.6); room.add(winView)
  const wf = rbox(0.1, 3.1, 2.5, trimMat, 0.04); wf.rotation.y = Math.PI / 2; at(wf, -7.93, 4, -1.6); room.add(wf)
  const mull = rbox(0.06, 3, 0.06, trimMat, 0.02); mull.rotation.y = Math.PI / 2; at(mull, -7.86, 4, -1.6); room.add(mull)
  room.add(at(rbox(0.3, 0.12, 2.6, trimMat, 0.03), -7.8, 2.45, -1.6))
  ;[-2.85, -0.35].forEach(z => { const cur = rbox(0.08, 3.1, 0.5, stdMap(fabricTex('#7a93b8'), 0.9), 0.06); cur.rotation.y = Math.PI / 2; at(cur, -7.84, 4, z); room.add(cur) })

  // ── DESK
  const DZ = -3.0, DTOP = 0.75
  room.add((() => { const d = rbox(2.9, 0.08, 1.05, woodMat, 0.04); at(d, 0, DTOP, DZ); d.castShadow = true; d.receiveShadow = true; return d })())
  ;[-1.35, 1.35].forEach(x => { const p = rbox(0.08, DTOP, 0.95, woodMat, 0.02); at(p, x, DTOP / 2, DZ); p.castShadow = true; room.add(p) })
  room.add(at(rbox(2.7, 0.4, 0.05, woodMat, 0.02), 0, 0.5, DZ - 0.45))

  // monitor + canvas screen
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 600
  const ctx = cv.getContext('2d')!
  const screenTex = new THREE.CanvasTexture(cv)
  const screenMat = std(0x0a0a12, 0.3, 0.1, 0x00e676, 0.9); screenMat.map = screenTex; screenMat.emissiveMap = screenTex
  const drawIdleScreen = () => {
    const g = ctx.createLinearGradient(0, 0, 0, 600); g.addColorStop(0, '#0a1626'); g.addColorStop(1, '#0d2233'); ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 600)
    ctx.fillStyle = '#2ee6a0'; ctx.textAlign = 'center'; ctx.font = 'bold 86px monospace'; ctx.fillText('<RAJ/>', 512, 230)
    ctx.font = '28px monospace'; ctx.fillStyle = '#bfe8d0'; ctx.fillText('walk over & press  E  to log in', 512, 330)
    ctx.fillStyle = '#7fd6a0'; ctx.fillText('— or chat with me anywhere —', 512, 380)
    ctx.textAlign = 'left'; screenTex.needsUpdate = true
  }
  drawIdleScreen()
  room.add(at(rbox(1.55, 0.95, 0.06, blackMat, 0.03), MON.x, MON.y, MON.z))
  room.add(at(new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.82), screenMat), MON.x, MON.y, MON.z + 0.035))
  room.add(at(cyl(0.04, 0.05, 0.25, 12, metalMat), 0, 0.9, MON.z + 0.12))
  room.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.04, 20), blackMat), 0, DTOP + 0.06, MON.z + 0.12))

  // keyboard + keys + mouse + laptop + mug + plant + lamp
  room.add(at(rbox(0.86, 0.04, 0.3, std(0x202028, 0.6), 0.02), 0, DTOP + 0.06, -2.55))
  const keyMat = std(0x33343e, 0.5)
  for (let r = 0; r < 5; r++) for (let cc = 0; cc < 15; cc++) room.add(at(rbox(0.045, 0.02, 0.04, keyMat, 0.008), -0.39 + cc * 0.056, DTOP + 0.085, -2.66 + r * 0.052))
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.32), std(0x14141c, 0.95)); pad.rotation.x = -Math.PI / 2; at(pad, 0.62, DTOP + 0.045, -2.55); room.add(pad)
  room.add(at(rbox(0.09, 0.04, 0.15, std(0x26262e, 0.5), 0.03), 0.62, DTOP + 0.07, -2.55))
  room.add(at(rbox(0.5, 0.03, 0.35, std(0x3a3a44, 0.4, 0.6), 0.02), -1.0, DTOP + 0.06, -3.0))
  room.add(at(cyl(0.05, 0.055, 0.11, 14, std(0x2f6f8f, 0.4)), 0.95, DTOP + 0.115, -2.7))
  room.add(at(cyl(0.06, 0.075, 0.13, 12, std(0xb5651d, 0.8)), -0.75, DTOP + 0.11, -3.0))
  room.add(at(sph(0.13, std(0x2f9e44, 0.85)), -0.75, DTOP + 0.22, -3.0))
  room.add(at(cyl(0.08, 0.1, 0.04, 16, metalMat), 1.2, DTOP + 0.06, -3.05))
  const arm = rbox(0.03, 0.55, 0.03, metalMat, 0.01); at(arm, 1.2, DTOP + 0.34, -3.05); arm.rotation.z = 0.2; room.add(arm)
  room.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.16, 16, 1, true), std(0x2a2f3a, 0.6, 0.3, 0xffd9a0, 0.5)), 1.05, DTOP + 0.62, -3.0))
  room.add(at(new THREE.PointLight(0xffd9a0, 6, 4, 2), 1.0, DTOP + 0.55, -2.8) as THREE.PointLight)

  // ── OFFICE CHAIR
  const chair = new THREE.Group()
  chair.add(at(rbox(0.56, 0.12, 0.54, fabricMat, 0.08), 0, 0.5, -1.9))
  chair.add(at(rbox(0.54, 0.7, 0.12, fabricMat, 0.08), 0, 0.92, -2.16))
  chair.add(at(rbox(0.34, 0.2, 0.1, std(0x33343e, 0.7), 0.05), 0, 1.34, -2.18))
  ;[-0.32, 0.32].forEach(x => { chair.add(at(rbox(0.07, 0.06, 0.34, blackMat, 0.03), x, 0.66, -1.86)); chair.add(at(rbox(0.05, 0.18, 0.05, metalMat, 0.02), x, 0.56, -1.86)) })
  chair.add(at(cyl(0.045, 0.06, 0.42, 12, metalMat), 0, 0.27, -1.9))
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const leg = rbox(0.5, 0.04, 0.07, blackMat, 0.02); leg.position.set(Math.cos(a) * 0.22, 0.07, -1.9 + Math.sin(a) * 0.22); leg.rotation.y = a; chair.add(leg); chair.add(at(sph(0.05, blackMat), Math.cos(a) * 0.44, 0.05, -1.9 + Math.sin(a) * 0.44)) }
  chair.traverse(o => { (o as THREE.Mesh).castShadow = true }); room.add(chair)

  // ── BED (right-back) + nightstand
  const bed = buildBed(); bed.position.set(5.2, 0, -3.3); room.add(bed)
  room.add(at(rbox(0.6, 0.5, 0.5, woodMat, 0.03), 3.55, 0.25, -4.4))
  room.add(at(cyl(0.09, 0.11, 0.16, 12, std(0x9a4f2a, 0.8)), 3.55, 0.6, -4.4))
  room.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.2, 16, 1, true), std(0xf2e6c8, 0.6, 0, 0xffe6a0, 0.6)), 3.55, 0.82, -4.4))
  room.add(at(new THREE.PointLight(0xffe0a0, 4, 3, 2), 3.55, 0.95, -4.2) as THREE.PointLight)
  room.add(at(rbox(0.22, 0.04, 0.16, std(0xdc2626, 0.7), 0.01), 3.6, 0.53, -4.3))

  // ── BOOKSHELF (back-left) + fairy lights + decor
  room.add(at(rbox(0.4, 3.0, 1.6, woodMat, 0.03), -4.6, 1.5, -4.7))
  ;[0.4, 1.1, 1.8, 2.5].forEach(y => room.add(at(rbox(0.36, 0.05, 1.54, std(0x6b4d2c, 0.6), 0.01), -4.6, y, -4.7)))
  const bookCols = [0x2563eb, 0x7c3aed, 0xdc2626, 0x059669, 0xd97706, 0x0891b2, 0xbe185d, 0x4b5563, 0x16a34a]
  ;[0.66, 1.36, 2.06].forEach((yy, row) => bookCols.forEach((bc, i) => { if ((i + row) % 7 === 6) return; const h = 0.36 + ((i * 5 + row * 3) % 5) * 0.025; room.add(at(rbox(0.1, h, 0.26, std(bc, 0.85), 0.01), -5.2 + i * 0.135, yy + h / 2 - 0.05, -4.7)) }))
  room.add(at(sph(0.16, std(0x1f9e44, 0.9)), -4.0, 2.95, -4.7))
  room.add(at(cyl(0.08, 0.1, 0.14, 10, std(0xb5651d, 0.8)), -4.0, 2.83, -4.7))
  for (let i = 0; i < 10; i++) room.add(at(sph(0.025, std(0xfff2b0, 0.4, 0, 0xffd060, 2)), -5.3 + i * 0.16, 2.62, -4.55))

  // ── TALL FLOOR PLANT (corner)
  room.add(at(cyl(0.22, 0.16, 0.5, 16, std(0xb5651d, 0.8)), 6.8, 0.25, -4.4))
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const leaf = rbox(0.1, 1.0, 0.04, std(0x2f8e3f, 0.85), 0.04); leaf.position.set(6.8 + Math.cos(a) * 0.12, 0.95 + (i % 3) * 0.12, -4.4 + Math.sin(a) * 0.12); leaf.rotation.set(Math.cos(a) * 0.3, a, Math.sin(a) * 0.3); room.add(leaf) }

  // ── RUG, SOFA + COFFEE TABLE (lounge, front-left)
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.4), stdMap(rugTex(), 1)); rug.rotation.x = -Math.PI / 2; at(rug, 0, 0.006, -1.6); room.add(rug)
  const sofa = new THREE.Group(); const sofaMat = std(0x8a5a3c, 0.9)
  sofa.add(at(rbox(2.0, 0.45, 0.9, sofaMat, 0.12), 0, 0.35, 0))
  sofa.add(at(rbox(2.0, 0.6, 0.25, sofaMat, 0.12), 0, 0.7, -0.32))
  ;[-0.88, 0.88].forEach(x => sofa.add(at(rbox(0.24, 0.5, 0.9, sofaMat, 0.1), x, 0.5, 0)))
  ;[-0.5, 0.5].forEach(x => sofa.add(at(rbox(0.55, 0.12, 0.55, stdMap(fabricTex('#c97f4a'), 0.85), 0.08), x, 0.6, 0.05)))
  sofa.position.set(-5.4, 0, 2.6); sofa.rotation.y = 0.5; sofa.traverse(o => { (o as THREE.Mesh).castShadow = true }); room.add(sofa)
  const ctab = new THREE.Group()
  ctab.add(at(rbox(1.1, 0.08, 0.6, woodMat, 0.03), 0, 0.4, 0)); [[-0.45, -0.22], [0.45, -0.22], [-0.45, 0.22], [0.45, 0.22]].forEach(([x, z]) => ctab.add(at(rbox(0.06, 0.4, 0.06, woodMat, 0.02), x, 0.2, z)))
  ctab.add(at(rbox(0.3, 0.05, 0.22, std(0xdc2626, 0.7), 0.01), -0.2, 0.45, 0)); ctab.add(at(cyl(0.04, 0.045, 0.09, 12, std(0x2f6f8f, 0.4)), 0.25, 0.49, 0.05))
  ctab.position.set(-4.0, 0, 1.5); ctab.rotation.y = 0.5; ctab.traverse(o => { (o as THREE.Mesh).castShadow = true }); room.add(ctab)

  // ── WALL CLOCK (right wall) + ceiling light
  const clock = new THREE.Group(); clock.add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 24), std(0x1c1c22, 0.5))); const face = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), std(0xf4f1ea, 0.6)); face.position.y = 0.035; clock.add(face); clock.rotation.x = Math.PI / 2; clock.rotation.z = -Math.PI / 2; clock.position.set(7.9, 4.2, -1.6); room.add(clock)
  room.add(at(rbox(2.4, 0.1, 1.2, std(0xeae2d2, 0.6, 0, 0xfff4e0, 0.9), 0.04), 0, 9.9, -1))

  const monitorLight = new THREE.PointLight(0x2ee6a0, 1.2, 5, 2); monitorLight.position.set(0, MON.y, MON.z + 0.6); room.add(monitorLight)

  return { room, screenTex, screenMat, monitorLight }
}

// ── DESKTOP overlay ──────────────────────────────────────────────────────────
type DeskWin = null | 'projects' | 'experience' | 'skills' | 'about' | 'chat'
function Desktop({ portfolio, onLeave, chat, click }: {
  portfolio: PortfolioData | null; onLeave: () => void
  chat: { history: ChatMessage[]; thinking: boolean; send: (m: string) => void }; click: () => void
}) {
  const [win, setWin] = useState<DeskWin>(null)
  const [input, setInput] = useState('')
  const tref = useRef<HTMLDivElement>(null)
  useEffect(() => { const e = tref.current; if (e) e.scrollTop = e.scrollHeight }, [chat.history, chat.thinking, win])
  const profile = portfolio?.profile
  const icons: { id: DeskWin; label: string; svg: React.ReactNode }[] = [
    { id: 'projects', label: 'Projects', svg: <path d="M3 7h5l2 2h11v9H3z" /> },
    { id: 'experience', label: 'Experience', svg: <><rect x="3" y="7" width="18" height="13" rx="1" /><path d="M8 7V5h8v2" /></> },
    { id: 'skills', label: 'Skills', svg: <><rect x="4" y="12" width="3" height="8" /><rect x="10.5" y="7" width="3" height="13" /><rect x="17" y="3" width="3" height="17" /></> },
    { id: 'about', label: 'About', svg: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></> },
    { id: 'chat', label: 'RajBot', svg: <path d="M4 4h16v11H8l-4 4z" /> },
  ]
  const open = (id: DeskWin) => { click(); setWin(id) }
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(4,6,9,0.6)', backdropFilter: 'blur(6px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 'min(980px,94vw)', height: 'min(640px,88vh)', background: 'linear-gradient(160deg,#121418,#0d0f13)', border: `1px solid ${UI.border}`, borderRadius: 18, boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(16,185,129,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: UI.font }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: `1px solid ${UI.border}`, background: 'rgba(16,185,129,0.04)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, color: UI.ink, fontWeight: 700, letterSpacing: '0.02em' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: UI.gradient, boxShadow: '0 0 10px rgba(16,185,129,0.7)' }} />
            Raj OS
          </span>
          <div style={{ display: 'flex', gap: 8 }}>{win && <button onClick={() => { click(); setWin(null) }} style={deskBtn}>◂ Desktop</button>}<button onClick={onLeave} style={btn}>Leave (Esc)</button></div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {!win ? (
            <div style={{ flex: 1, padding: 30, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(124px,1fr))', gridAutoRows: 'min-content', gap: 22, alignContent: 'start' }}>
              {icons.map(ic => (
                <button key={ic.label} onClick={() => open(ic.id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 11, background: 'transparent', border: 'none', cursor: 'pointer', color: UI.ink2, padding: 12, borderRadius: 14, transition: 'background .15s' }} onMouseEnter={e => (e.currentTarget.style.background = UI.accentSoft)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ width: 60, height: 60, display: 'grid', placeItems: 'center', background: UI.accentSoft, border: `1px solid ${UI.borderAccent}`, borderRadius: 16 }}><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={UI.accent} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{ic.svg}</svg></span>
                  <span style={{ fontSize: '0.84rem', fontWeight: 500 }}>{ic.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div ref={tref} style={{ flex: 1, overflowY: 'auto', padding: 26, color: UI.ink2 }}>
              {win === 'projects' && <Win title="Projects">{(portfolio?.projects ?? []).map(p => (<div key={p.id} style={cardStyle}><div style={{ color: UI.ink, fontWeight: 700, fontSize: '1rem', marginBottom: 6 }}>{p.title}</div><div style={{ fontSize: '0.88rem', lineHeight: 1.55, color: UI.muted }}>{p.summary}</div>{(p.whatItDoes?.length ?? 0) > 0 && <ul style={{ margin: '10px 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>{p.whatItDoes!.slice(0, 5).map((w, j) => <li key={j} style={{ fontSize: '0.84rem', lineHeight: 1.5, color: UI.ink2, display: 'flex', gap: 8 }}><span style={{ color: UI.accent }}>▸</span>{w}</li>)}</ul>}{p.techStack?.length > 0 && <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>{p.techStack.map(t => <span key={t} style={tagStyle}>{t}</span>)}</div>}</div>))}</Win>}
              {win === 'experience' && <Win title="Experience">{(profile?.experience ?? []).map((e, i) => (<div key={i} style={cardStyle}><div style={{ color: UI.ink, fontWeight: 700, fontSize: '1rem' }}>{e.role} {e.company ? `· ${e.company}` : ''}</div>{e.dateRange && <div style={{ fontSize: '0.78rem', color: UI.accent, margin: '3px 0 8px', fontWeight: 500 }}>{e.dateRange}</div>}{e.summary && <div style={{ fontSize: '0.86rem', lineHeight: 1.55, color: UI.muted, marginBottom: 8 }}>{e.summary}</div>}{(e.highlights?.length ? e.highlights : e.items)?.map((it, j) => <div key={j} style={{ fontSize: '0.85rem', lineHeight: 1.5, color: UI.ink2, display: 'flex', gap: 8, marginBottom: 3 }}><span style={{ color: UI.accent }}>▸</span>{it}</div>)}</div>))}</Win>}
              {win === 'skills' && <Win title="Skills">{(profile?.skills ?? []).map((s, i) => (<div key={i} style={{ marginBottom: 18 }}><div style={{ color: UI.ink, fontWeight: 700, marginBottom: 9 }}>{s.category}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{s.items.map(it => <span key={it} style={tagStyle}>{it}</span>)}</div></div>))}</Win>}
              {win === 'about' && <Win title="About"><div style={{ fontSize: '1.2rem', color: UI.ink, fontWeight: 700 }}>{profile?.name}</div><div style={{ color: UI.accent, margin: '4px 0 14px', fontWeight: 500 }}>{profile?.headline} {profile?.location ? `· ${profile.location}` : ''}</div><div style={{ fontSize: '0.94rem', lineHeight: 1.65, whiteSpace: 'pre-wrap', color: UI.ink2 }}>{profile?.about}</div>{profile?.openToWork && <div style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', border: `1px solid ${UI.borderAccent}`, background: UI.accentSoft, borderRadius: 9, color: UI.accent, fontWeight: 600, fontSize: '0.85rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: UI.accent }} />Open to work</div>}</Win>}
              {win === 'chat' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ color: UI.ink, fontWeight: 700, fontSize: '1.1rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 9 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: UI.gradient }} />RajBot</div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto' }}>
                    {chat.history.map((m, i) => (<div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%', padding: '10px 14px', borderRadius: 12, whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.55, background: m.role === 'user' ? UI.accentSoft : 'rgba(255,255,255,0.05)', border: `1px solid ${m.role === 'user' ? UI.borderAccent : UI.border}`, color: m.role === 'user' ? UI.ink : UI.ink2 }}>{m.content}</div>))}
                    {chat.thinking && <div style={{ alignSelf: 'flex-start', color: UI.muted, fontSize: '0.88rem' }}>thinking…</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && input.trim()) { chat.send(input.trim()); setInput('') } }} placeholder="Ask about Raj's work…" autoFocus style={inputStyle} /><button onClick={() => { if (input.trim()) { chat.send(input.trim()); setInput('') } }} style={deskBtn}>Send</button></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
function Win({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div style={{ color: UI.ink, fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 16, borderBottom: `1px solid ${UI.border}`, paddingBottom: 10 }}>{title}</div>{children}</div>
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function Scene3D({ portfolio, chatHistory, chatThinking, sendChat, onExitClassic }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'loading' | 'intro' | 'roam' | 'pc'>('loading')
  const [err, setErr] = useState(false)
  const [near, setNear] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [input, setInput] = useState('')
  const [speech, setSpeech] = useState('')

  const modeRef = useRef(mode); modeRef.current = mode
  const mutedRef = useRef(muted); mutedRef.current = muted
  const keysRef = useRef<Set<string>>(new Set())
  const desiredAnimRef = useRef<AnimName>('idle')
  const apiRef = useRef<{ enterPC: () => boolean } | null>(null)
  const audioRef = useRef<AudioManager | null>(null)
  const setNearRef = useRef(setNear); setNearRef.current = setNear
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdfe7f0)
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

    const camera = new THREE.PerspectiveCamera(46, mount.clientWidth / mount.clientHeight, 0.05, 80)
    camera.position.set(0.6, 1.7, 5.2); camera.lookAt(0, 1.2, 0)

    scene.add(new THREE.HemisphereLight(0xdfeaff, 0xb08d5a, 1.1))
    const sun = new THREE.DirectionalLight(0xfff3e2, 2.0); sun.position.set(-9, 10, 4); sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 40
    sun.shadow.camera.left = -10; sun.shadow.camera.right = 10; sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10; sun.shadow.bias = -0.0007
    scene.add(sun)
    scene.add(at(new THREE.PointLight(0xfff4e0, 12, 26, 2), 0, 9.6, -1) as THREE.PointLight)

    const { room, monitorLight } = buildRoom(); scene.add(room)

    // audio
    const audio = new AudioManager(); audioRef.current = audio
    let audioKicked = false
    const kickAudio = () => { if (audioKicked) return; audioKicked = true; audio.resume().then(() => { if (!mutedRef.current) audio.startMusic() }) }

    // load character + anims
    const loader = new GLTFLoader()
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
        model.scale.setScalar(1.72 / sz.y)
        const bb2 = new THREE.Box3().setFromObject(model); const c = bb2.getCenter(new THREE.Vector3())
        model.position.x -= c.x; model.position.z -= c.z; model.position.y -= bb2.min.y
        charRoot = new THREE.Group(); charRoot.add(model); charRoot.position.set(0, 0, 1.0); scene.add(charRoot)
        walk.tracks.forEach(tr => { if (/Hips\.position$/i.test(tr.name)) { const v = tr.values as unknown as number[]; const x0 = v[0], z0 = v[2]; for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0 } } })
        mixer = new THREE.AnimationMixer(model)
        actions.idle = mixer.clipAction(idle); actions.walk = mixer.clipAction(walk); actions.talk1 = mixer.clipAction(talk1); actions.talk2 = mixer.clipAction(talk2); actions.greet = mixer.clipAction(greet); actions.think = mixer.clipAction(think)
        mixer.addEventListener('finished', e => { if ((e as unknown as { action: THREE.AnimationAction }).action === actions.greet) desiredAnimRef.current = 'idle' })
        actions.idle.play(); activeAction = actions.idle
        apiRef.current = { enterPC: () => { if (!charRoot) return false; const d = Math.hypot(charRoot.position.x - PC_POINT.x, charRoot.position.z - PC_POINT.z); if (d > PC_RADIUS) return false; charRoot.position.set(0, 0, -1.55); charRoot.rotation.y = Math.PI; return true } }
        setMode('intro')
      }).catch(() => { setErr(true); setMode('roam') })

    const camPos = new THREE.Vector3().copy(camera.position), camLook = new THREE.Vector3(0, 1.2, 0)
    const IA = new THREE.Vector3(0.6, 1.7, 5.2), IB = new THREE.Vector3(0, 2.3, 4.4)
    let introT = 0, wasNear = false, strideTimer = 0, raf = 0
    const tmp = new THREE.Vector3(), clock = new THREE.Clock()

    const onResize = () => { camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mount.clientWidth, mount.clientHeight) }
    window.addEventListener('resize', onResize)

    const animate = () => {
      raf = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime
      if (mixer) mixer.update(dt)
      const typing = !!document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)
      let moving = false

      if (charRoot && modeRef.current === 'roam' && !typing) {
        const k = keysRef.current; let dx = 0, dz = 0
        if (k.has('w') || k.has('arrowup')) dz -= 1
        if (k.has('s') || k.has('arrowdown')) dz += 1
        if (k.has('a') || k.has('arrowleft')) dx -= 1
        if (k.has('d') || k.has('arrowright')) dx += 1
        if (dx || dz) {
          moving = true; const len = Math.hypot(dx, dz); dx /= len; dz /= len
          charRoot.position.x = clamp(charRoot.position.x + dx * 2.0 * dt, -6.5, 6.5)
          charRoot.position.z = clamp(charRoot.position.z + dz * 2.0 * dt, -1.55, 3.2)
          charRoot.rotation.y = lerpAngle(charRoot.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 12))
        }
        const dPC = Math.hypot(charRoot.position.x - PC_POINT.x, charRoot.position.z - PC_POINT.z)
        if ((dPC <= PC_RADIUS) !== wasNear) { wasNear = dPC <= PC_RADIUS; setNearRef.current(wasNear) }
      }

      // footsteps
      if (moving) { strideTimer -= dt; if (strideTimer <= 0) { audioRef.current?.footstep(); strideTimer = 0.33 } } else strideTimer = 0

      let target: AnimName = moving ? 'walk' : desiredAnimRef.current
      if (modeRef.current === 'pc') target = desiredAnimRef.current === 'talk' ? 'talk' : 'idle'
      applyAnim(target)

      if (modeRef.current === 'intro') { introT += dt; const k = eio(clamp(introT / 3.2, 0, 1)); camPos.lerpVectors(IA, IB, k); camLook.set(0, lerp(1.2, 1.4, k), lerp(0, 1.0, k)) }
      else if (modeRef.current === 'roam' && charRoot) { const p = charRoot.position; camPos.lerp(tmp.set(p.x, 2.5, p.z + 4.2), 1 - Math.exp(-dt * 5)); camLook.lerp(tmp.set(p.x, 1.25, p.z - 0.4), 1 - Math.exp(-dt * 6)) }
      else if (modeRef.current === 'pc') { camPos.lerp(tmp.set(0, 1.55, -0.35), 1 - Math.exp(-dt * 4)); camLook.lerp(tmp.set(MON.x, MON.y, MON.z), 1 - Math.exp(-dt * 4)) }
      camera.position.copy(camPos); camera.lookAt(camLook)
      monitorLight.intensity = 1.0 + Math.sin(t * 2) * 0.2
      renderer.render(scene, camera)
    }
    animate()

    const kd = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      kickAudio()
      if (!!document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) e.preventDefault()
      keysRef.current.add(key)
      if (key === 'e' && modeRef.current === 'roam') { if (apiRef.current?.enterPC()) setMode('pc') }
      if (key === 'escape' && modeRef.current === 'pc') setMode('roam')
    }
    const ku = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase())
    const pd = () => kickAudio()
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('pointerdown', pd)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('pointerdown', pd)
      mixer?.stopAllAction(); apiRef.current = null; audio.dispose(); audioRef.current = null
      pmrem.dispose(); renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (mode !== 'intro') return
    desiredAnimRef.current = 'greet'
    setSpeech(`Hi! I'm ${portfolio?.profile?.name || 'Raj'} 👋  Use WASD / arrows to walk around — chat with me anytime, or head to my PC.`)
    const t = setTimeout(() => { setMode('roam'); setTimeout(() => setSpeech(''), 3500) }, 5500)
    return () => clearTimeout(t)
  }, [mode, portfolio])

  // PC login chime
  useEffect(() => { if (mode === 'pc') { audioRef.current?.resume(); audioRef.current?.pcOpen() } }, [mode])

  useEffect(() => { if (chatThinking) desiredAnimRef.current = 'think' }, [chatThinking])
  useEffect(() => {
    const last = chatHistory[chatHistory.length - 1]
    if (!last || last.role !== 'assistant' || chatThinking) return
    desiredAnimRef.current = 'talk'
    audioRef.current?.blipRecv()
    if (modeRef.current !== 'pc') setSpeech(last.content)
    const dur = Math.min(14000, Math.max(2800, last.content.length * 42))
    const t = setTimeout(() => { desiredAnimRef.current = 'idle' }, dur)
    return () => clearTimeout(t)
  }, [chatHistory, chatThinking])

  useEffect(() => { const el = transcriptRef.current; if (el) el.scrollTop = el.scrollHeight }, [chatHistory, chatThinking, chatOpen])

  const submit = () => { const v = input.trim(); if (!v || chatThinking) return; setInput(''); audioRef.current?.blipSend(); sendChat(v) }
  const press = (key: string, down: boolean) => { if (down) keysRef.current.add(key); else keysRef.current.delete(key) }
  const toggleMute = () => { const n = !muted; setMuted(n); audioRef.current?.setMuted(n); if (!n) audioRef.current?.resume().then(() => audioRef.current?.startMusic()) }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#dfe7f0', overflow: 'hidden', userSelect: 'none' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      <div style={{ position: 'absolute', top: 16, right: 18, display: 'flex', gap: 10, zIndex: 30 }}>
        <button onClick={toggleMute} style={btn} title="Sound">{muted ? '🔇' : '🔊'}</button>
        <button onClick={() => setChatOpen(o => !o)} style={chatOpen ? { ...btn, borderColor: UI.borderAccent, color: UI.accent } : btn}>{chatOpen ? '✕ Chat' : '💬 Chat'}</button>
        <button onClick={onExitClassic} style={btn}>← Classic site</button>
      </div>

      {speech && mode !== 'loading' && mode !== 'pc' && (
        <div style={{ position: 'absolute', top: '11%', left: '50%', transform: 'translateX(-50%)', maxWidth: 'min(700px,88vw)', background: UI.panel, border: `1px solid ${UI.border}`, borderRadius: 16, padding: '14px 22px', color: UI.ink, fontFamily: UI.font, fontSize: 'clamp(0.9rem,1.7vw,1.05rem)', lineHeight: 1.55, textAlign: 'center', backdropFilter: 'blur(12px)', pointerEvents: 'none', zIndex: 20, boxShadow: '0 12px 48px rgba(0,0,0,0.45)' }}>{speech}</div>
      )}

      {mode === 'roam' && (
        <>
          <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', color: UI.ink2, background: UI.panel, border: `1px solid ${UI.border}`, padding: '8px 18px', borderRadius: 20, fontFamily: UI.font, fontSize: '0.82rem', fontWeight: 500, zIndex: 15, backdropFilter: 'blur(10px)' }}>WASD / arrows to move{near ? '' : '  ·  approach the PC to log in'}</div>
          {near && <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translateX(-50%)', color: '#04140c', background: UI.gradient, padding: '11px 22px', borderRadius: 12, fontFamily: UI.font, fontWeight: 700, fontSize: '0.95rem', zIndex: 18, boxShadow: '0 8px 30px rgba(16,185,129,0.4)', cursor: 'pointer' }} onClick={() => { if (apiRef.current?.enterPC()) setMode('pc') }}>Press E to use the computer ▸</div>}
          <div style={{ position: 'absolute', bottom: 70, left: 24, zIndex: 22, display: 'grid', gridTemplateColumns: 'repeat(3,48px)', gridTemplateRows: 'repeat(3,48px)', gap: 6, touchAction: 'none' }}>
            {([['', 'w', ''], ['a', '', 'd'], ['', 's', '']] as const).flat().map((kk, i) => kk ? <button key={i} onPointerDown={e => { e.preventDefault(); press(kk, true) }} onPointerUp={() => press(kk, false)} onPointerLeave={() => press(kk, false)} style={dpad}>{kk.toUpperCase()}</button> : <span key={i} />)}
          </div>
        </>
      )}

      {chatOpen && mode !== 'pc' && (
        <div style={{ position: 'absolute', bottom: 0, right: 0, width: 'min(420px,96vw)', maxHeight: '62vh', display: 'flex', flexDirection: 'column', background: UI.panel, border: `1px solid ${UI.border}`, borderRadius: '16px 0 0 0', backdropFilter: 'blur(14px)', zIndex: 28, boxShadow: '0 -8px 40px rgba(0,0,0,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 16px 4px', color: UI.ink, fontFamily: UI.font, fontWeight: 700, fontSize: '0.92rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: UI.gradient }} />RajBot</div>
          <div ref={transcriptRef} style={{ overflowY: 'auto', padding: '10px 16px 6px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {chatHistory.length === 0 && <div style={{ color: UI.muted, fontFamily: UI.font, fontSize: '0.86rem' }}>Ask me about projects, experience, skills, or availability.</div>}
            {chatHistory.map((m, i) => <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '9px 13px', borderRadius: 12, whiteSpace: 'pre-wrap', fontFamily: UI.font, fontSize: '0.88rem', lineHeight: 1.55, background: m.role === 'user' ? UI.accentSoft : 'rgba(255,255,255,0.05)', border: `1px solid ${m.role === 'user' ? UI.borderAccent : UI.border}`, color: m.role === 'user' ? UI.ink : UI.ink2 }}>{m.content}</div>)}
            {chatThinking && <div style={{ alignSelf: 'flex-start', color: UI.muted, fontFamily: UI.font, fontSize: '0.86rem', padding: '4px 13px' }}>Raj is thinking…</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '10px 14px 14px' }}><input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} placeholder="Ask about Raj's work…" autoFocus style={inputStyle} /><button onClick={submit} disabled={chatThinking || !input.trim()} style={{ ...deskBtn, opacity: chatThinking || !input.trim() ? 0.4 : 1 }}>Send</button></div>
        </div>
      )}

      {mode === 'pc' && <Desktop portfolio={portfolio} onLeave={() => setMode('roam')} chat={{ history: chatHistory, thinking: chatThinking, send: (m) => { audioRef.current?.blipSend(); sendChat(m) } }} click={() => audioRef.current?.click()} />}

      {mode === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0a0b0d', color: UI.ink, fontFamily: UI.font, zIndex: 60, gap: 18 }}>
          <div style={{ fontWeight: 600, letterSpacing: '0.02em' }}>Building Raj's room…</div>
          <div style={{ width: 220, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}><div style={{ width: '55%', height: '100%', background: UI.gradient, animation: 's3dLoad 1.2s ease-in-out infinite' }} /></div>
        </div>
      )}
      {err && <div style={{ position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)', color: '#ff8080', fontFamily: 'monospace', fontSize: '0.82rem', zIndex: 60 }}>(avatar failed to load — chat still works)</div>}
      {mode === 'intro' && <button onClick={() => setMode('roam')} style={{ ...btn, position: 'absolute', bottom: 24, right: 28, zIndex: 30 }}>SKIP ▸</button>}

      <style>{`@keyframes s3dLoad{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}`}</style>
    </div>
  )
}

// ── Palette shared with the classic page (emerald + cyan on dark) ────────────
const UI = {
  accent: '#10b981',      // emerald
  accent2: '#22d3ee',     // cyan
  ink: '#fafafa',
  ink2: '#d4d4d8',
  muted: '#a1a1aa',
  panel: 'rgba(18,20,24,0.92)',
  panel2: 'rgba(24,27,33,0.7)',
  border: 'rgba(255,255,255,0.10)',
  borderAccent: 'rgba(16,185,129,0.45)',
  accentSoft: 'rgba(16,185,129,0.12)',
  font: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  gradient: 'linear-gradient(135deg, #10b981 0%, #22d3ee 100%)',
}

const btn: React.CSSProperties = { background: 'rgba(12,14,18,0.7)', border: `1px solid ${UI.border}`, color: UI.ink, fontFamily: UI.font, fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.02em', padding: '9px 14px', cursor: 'pointer', borderRadius: 10, backdropFilter: 'blur(10px)' }
const deskBtn: React.CSSProperties = { background: UI.accentSoft, border: `1px solid ${UI.borderAccent}`, color: UI.accent, fontFamily: UI.font, fontWeight: 600, fontSize: '0.78rem', padding: '8px 14px', cursor: 'pointer', borderRadius: 9 }
const dpad: React.CSSProperties = { background: 'rgba(16,185,129,0.14)', border: `1px solid ${UI.borderAccent}`, color: UI.accent, fontFamily: UI.font, fontWeight: 700, borderRadius: 12, cursor: 'pointer', touchAction: 'none', backdropFilter: 'blur(6px)' }
const inputStyle: React.CSSProperties = { flex: 1, background: 'rgba(0,0,0,0.4)', border: `1px solid ${UI.border}`, borderRadius: 10, color: UI.ink, fontFamily: UI.font, fontSize: '0.92rem', padding: '11px 14px', outline: 'none' }
const cardStyle: React.CSSProperties = { background: UI.panel2, border: `1px solid ${UI.border}`, borderRadius: 13, padding: '16px 18px', marginBottom: 14 }
const tagStyle: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 500, padding: '4px 10px', borderRadius: 7, background: UI.accentSoft, border: `1px solid ${UI.borderAccent}`, color: UI.accent, fontFamily: UI.font }
