import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react'

const Terminal3D = lazy(() => import('./Terminal3D'))

// ─── Types ────────────────────────────────────────────────────────────────────

type ExperienceItem = {
  company: string
  role?: string
  dateRange?: string
  summary?: string
  items: string[]
  highlights: string[]
}

type SkillCategory = {
  category: string
  items: string[]
}

type ProjectCard = {
  id: string
  title: string
  summary: string
  techStack: string[]
  sourcePath: string
  isVisible?: boolean
  whatItDoes?: string[]
}

type SocialLinks = {
  linkedin?: string
  github?: string
  email?: string
}

type Scheduling = {
  calLink?: string
  enabled?: boolean
  headline?: string
  subtext?: string
}

type SectionConfig = {
  id: string
  label: string
  visible: boolean
}

type PortfolioPayload = {
  profile: {
    name: string
    location: string
    headline: string
    about: string
    eyebrow?: string
    openToWork: boolean
    currentLocation?: string
    desiredLocations?: string[]
    experience: ExperienceItem[]
    skills: SkillCategory[]
    resumeProjects: string[]
    socialLinks?: SocialLinks
  }
  projects: ProjectCard[]
  scheduling?: Scheduling
  sections?: SectionConfig[]
}

type ChatMessage = { role: 'user' | 'assistant'; content: string }

// Conversational contact-capture state machine for the chatbot.
type ContactFlow = {
  active: boolean
  step: 'name' | 'email' | 'message' | 'confirm' | null
  name: string
  email: string
  message: string
}
const EMPTY_CONTACT_FLOW: ContactFlow = { active: false, step: null, name: '', email: '', message: '' }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

// Accepts "raj-sahoo", "cal.com/raj-sahoo", or a full https URL and returns a usable URL.
function normalizeCalUrl(raw: string): string {
  const v = (raw || '').trim().replace(/^@/, '')
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  if (/^cal\.com\//i.test(v) || v.includes('calendly.com')) return `https://${v}`
  return `https://cal.com/${v}`
}

// ─── Lightweight, safe markdown renderer for chat bubbles ──────────────────────
// Handles: **bold**, `code`, bullet lists (- / *), numbered lists, links, and
// paragraphs. No dangerouslySetInnerHTML — everything is rendered as React nodes.
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Split on **bold**, `code`, and markdown links [text](url) while keeping delimiters.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      nodes.push(<strong key={`${keyBase}-b${i}`}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      nodes.push(<code key={`${keyBase}-c${i}`} className="chat-code">{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('[')) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)
      if (mm) nodes.push(<a key={`${keyBase}-l${i}`} href={mm[2]} target="_blank" rel="noopener noreferrer">{mm[1]}</a>)
    } else if (/^https?:\/\//.test(tok)) {
      nodes.push(<a key={`${keyBase}-u${i}`} href={tok} target="_blank" rel="noopener noreferrer">{tok}</a>)
    }
    last = m.index + tok.length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let listBuffer: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const flushList = (key: string) => {
    if (!listBuffer.length || !listType) return
    const items = listBuffer.map((li, idx) => <li key={`${key}-li${idx}`}>{renderInline(li, `${key}-li${idx}`)}</li>)
    blocks.push(listType === 'ul' ? <ul key={key} className="chat-md-list">{items}</ul> : <ol key={key} className="chat-md-list">{items}</ol>)
    listBuffer = []
    listType = null
  }

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet) {
      if (listType && listType !== 'ul') flushList(`ul-${idx}`)
      listType = 'ul'; listBuffer.push(bullet[1])
    } else if (numbered) {
      if (listType && listType !== 'ol') flushList(`ol-${idx}`)
      listType = 'ol'; listBuffer.push(numbered[1])
    } else {
      flushList(`list-${idx}`)
      if (line.trim()) blocks.push(<p key={`p-${idx}`} className="chat-md-p">{renderInline(line, `p-${idx}`)}</p>)
    }
  })
  flushList('list-end')
  return <>{blocks}</>
}

// ─── Typewriter hook ──────────────────────────────────────────────────────────

function useTypewriter(text: string, speed = 42) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => {
    setDisplayed('')
    setDone(false)
    if (!text) return
    let i = 0
    const id = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) {
        clearInterval(id)
        setDone(true)
      }
    }, speed)
    return () => clearInterval(id)
  }, [text, speed])
  return { displayed, done }
}

// ─── Scroll-reveal hook ───────────────────────────────────────────────────────

function useReveal() {
  const ref = useRef<HTMLElement | null>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.12 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return { ref, visible }
}

// ─── Tilt card ────────────────────────────────────────────────────────────────

function TiltCard({ children, className, onClick }: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}) {
  const el = useRef<HTMLDivElement>(null)

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const card = el.current
    if (!card) return
    const { left, top, width, height } = card.getBoundingClientRect()
    const x = (e.clientX - left) / width - 0.5
    const y = (e.clientY - top) / height - 0.5
    card.style.transform = `perspective(600px) rotateY(${x * 12}deg) rotateX(${-y * 10}deg) scale(1.02)`
    card.style.setProperty('--shine-x', `${(x + 0.5) * 100}%`)
    card.style.setProperty('--shine-y', `${(y + 0.5) * 100}%`)
  }

  function handleLeave() {
    if (el.current) el.current.style.transform = ''
  }

  return (
    <div
      ref={el}
      className={`tilt-card ${className ?? ''}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
    >
      {children}
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function RevealSection({ id, children, className = '' }: {
  id?: string
  children: React.ReactNode
  className?: string
}) {
  const { ref, visible } = useReveal()
  return (
    <section
      id={id}
      ref={ref as React.Ref<HTMLElement>}
      className={`reveal-section ${visible ? 'is-visible' : ''} ${className}`}
    >
      {children}
    </section>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeProject, setActiveProject] = useState<ProjectCard | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatting, setChatting] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hi! Ask me anything about Raj's projects, experience, or skills — I'm grounded in real documents." }
  ])
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('theme') as 'dark' | 'light') ?? 'dark'
  )
  const [terminalMode, setTerminalMode] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)

  // Contact form state
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactMessage, setContactMessage] = useState('')
  const [contactStatus, setContactStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [contactError, setContactError] = useState('')

  // Conversational contact capture (chatbot)
  const [contactFlow, setContactFlow] = useState<ContactFlow>(EMPTY_CONTACT_FLOW)
  const contactFlowRef = useRef<ContactFlow>(EMPTY_CONTACT_FLOW)
  useEffect(() => { contactFlowRef.current = contactFlow }, [contactFlow])

  const name = portfolio?.profile.name ?? 'Raj Sahoo'
  const headline = portfolio?.profile.headline ?? 'AI/ML Software Developer'
  const { displayed: typedName } = useTypewriter(name, 55)
  const { displayed: typedHead, done: headDone } = useTypewriter(
    typedName.length === name.length ? headline : '',
    38
  )

  // ── Theme ──
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  // ── Load portfolio ──
  async function loadPortfolio() {
    try {
      const d = await apiFetch<PortfolioPayload>('/portfolio')
      setPortfolio(d)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => { void loadPortfolio() }, [])

  // ── BroadcastChannel + 30s poll ──
  useEffect(() => {
    const bc = new BroadcastChannel('portfolio-updates')
    bc.onmessage = (e: MessageEvent) => { if (e.data?.type === 'data-updated') void loadPortfolio() }
    const t = setInterval(() => void loadPortfolio(), 30_000)
    return () => { bc.close(); clearInterval(t) }
  }, [])

  // ── Auto-scroll chat ──
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, chatting])

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ── Contact-intent detection ──
  function looksLikeContactIntent(text: string): boolean {
    const t = text.toLowerCase()
    return /\b(contact|reach|get in touch|email|hire|work with|message (raj|him)|leave a message|pass (this |a )?message|tell raj|connect with)\b/.test(t)
      && !/\bproject|experience|skill|resume|stack|tech\b/.test(t)
  }
  function looksLikeMeetingIntent(text: string): boolean {
    const t = text.toLowerCase()
    return /\b(schedule|book|meeting|call|meet|calendar|appointment|available|availability)\b/.test(t)
  }

  function pushAssistant(prev: ChatMessage[], content: string) {
    setMessages([...prev, { role: 'assistant', content }])
  }

  // ── Chat ──
  async function send() {
    const msg = chatInput.trim()
    if (!msg || chatting) return
    const next: ChatMessage[] = [...messages, { role: 'user', content: msg }]
    setMessages(next); setChatInput('')

    // 1) If a contact-capture flow is in progress, handle it locally (no LLM call).
    const flow = contactFlowRef.current
    if (flow.active && flow.step) {
      handleContactFlowStep(msg, next)
      return
    }

    // 2) Detect meeting intent → surface booking link if configured.
    if (looksLikeMeetingIntent(msg) && schedulingEnabled) {
      const link = normalizeCalUrl(scheduling.calLink!)
      pushAssistant(next, `You can book a time with Raj here — it checks his live calendar availability and sends a Google Meet link automatically:\n\n${link}`)
      return
    }

    // 3) Detect contact intent → start conversational capture.
    if (looksLikeContactIntent(msg)) {
      setContactFlow({ active: true, step: 'name', name: '', email: '', message: '' })
      pushAssistant(next, "I'd be happy to pass a message to Raj. What's your name?")
      return
    }

    // 4) Otherwise, normal RAG chat.
    setChatting(true)
    try {
      const history = messages.slice(1).map(m => ({ role: m.role, content: m.content }))
      const r = await apiFetch<{ answer: string }>('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg, include_debug: false, history,
          active_project_title: activeProject?.title ?? null
        })
      })
      setMessages([...next, { role: 'assistant', content: r.answer }])
    } catch (err) {
      setMessages([...next, { role: 'assistant', content: 'Connection error — try again.' }])
    } finally { setChatting(false) }
  }

  // ── Conversational contact capture steps ──
  function handleContactFlowStep(msg: string, history: ChatMessage[]) {
    const flow = contactFlowRef.current
    if (flow.step === 'name') {
      const name = msg.trim()
      if (name.length < 2) { pushAssistant(history, "Could you share your name so Raj knows who reached out?"); return }
      setContactFlow({ ...flow, name, step: 'email' })
      pushAssistant(history, `Thanks, ${name}! What's the best email to reach you at?`)
      return
    }
    if (flow.step === 'email') {
      const email = msg.trim()
      if (!EMAIL_RE.test(email)) { pushAssistant(history, "That doesn't look like a valid email — mind trying again?"); return }
      setContactFlow({ ...flow, email, step: 'message' })
      pushAssistant(history, "Great. What would you like to say to Raj?")
      return
    }
    if (flow.step === 'message') {
      const message = msg.trim()
      if (message.length < 2) { pushAssistant(history, "Go ahead and type your message and I'll send it along."); return }
      const finalFlow = { ...flow, message }
      setContactFlow({ ...finalFlow, step: 'confirm' })
      void deliverChatContact(finalFlow, history)
      return
    }
  }

  async function deliverChatContact(flow: ContactFlow, history: ChatMessage[]) {
    setChatting(true)
    try {
      await submitContact({ name: flow.name, email: flow.email, message: flow.message, source: 'chat' })
      pushAssistant(history, `Done — I've sent your message to Raj. He'll reply to ${flow.email}.${schedulingEnabled ? ` If you'd rather meet, you can also book a call: ${normalizeCalUrl(scheduling.calLink!)}` : ''}`)
    } catch {
      pushAssistant(history, `I couldn't send that just now. You can email Raj directly at ${socialLinks.email || 'his listed email'}.`)
    } finally {
      setChatting(false)
      setContactFlow(EMPTY_CONTACT_FLOW)
    }
  }

  const profile = portfolio?.profile
  const projects = (portfolio?.projects ?? []).filter(p => p.isVisible !== false)
  const skills = profile?.skills ?? []
  const experience = profile?.experience ?? []
  const openToWork = profile?.openToWork ?? false
  const desiredLoc = profile?.desiredLocations ?? []

  const socialLinks = profile?.socialLinks ?? {}
  const scheduling = portfolio?.scheduling ?? {}
  const schedulingEnabled = Boolean(scheduling.enabled && scheduling.calLink)

  // Section visibility + ordering (admin-configurable). Falls back to a sensible default order.
  const sectionConfig: SectionConfig[] = portfolio?.sections ?? [
    { id: 'projects', label: 'Projects', visible: true },
    { id: 'experience', label: 'Experience', visible: true },
    { id: 'skills', label: 'Skills', visible: true },
    { id: 'scheduling', label: 'Schedule a call', visible: true },
    { id: 'contact', label: 'Contact', visible: true },
  ]
  const isSectionOn = useCallback(
    (id: string) => sectionConfig.find(s => s.id === id)?.visible !== false,
    [sectionConfig]
  )

  // ── Contact form submit ──
  const submitContact = useCallback(async (payload: { name: string; email: string; message: string; source?: string }) => {
    const res = await apiFetch<{ ok: boolean; stored: boolean; emailed: boolean }>('/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, source: payload.source ?? 'form' }),
    })
    return res
  }, [])

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault()
    setContactError('')
    const name = contactName.trim()
    const email = contactEmail.trim()
    const message = contactMessage.trim()
    if (!name) { setContactError('Please enter your name.'); return }
    if (!EMAIL_RE.test(email)) { setContactError('Please enter a valid email.'); return }
    if (message.length < 2) { setContactError('Please write a short message.'); return }
    setContactStatus('sending')
    try {
      await submitContact({ name, email, message, source: 'form' })
      setContactStatus('sent')
      setContactName(''); setContactEmail(''); setContactMessage('')
    } catch {
      setContactStatus('error')
      setContactError('Something went wrong — please email directly instead.')
    }
  }

  // ── Category icons (SVG) ──
  const catIconSvg: Record<string, React.ReactNode> = {
    'Languages': (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
    'AI / ML': (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
    ),
    'Frameworks': (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
      </svg>
    ),
    'Databases': (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
      </svg>
    ),
    'DevOps / Tools': (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>
    ),
  }
  // fallback icon for unknown categories
  const defaultCatIcon = (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
    </svg>
  )

  // ── Terminal mode short-circuit ──
  if (terminalMode) {
    return (
      <Suspense fallback={<div style={{ background: '#020e03', width: '100vw', height: '100vh' }} />}>
        <Terminal3D onExitTerminal={() => setTerminalMode(false)} />
      </Suspense>
    )
  }

  return (
    <div className="app" data-theme={theme}>

      {/* ── Ambient background ── */}
      <div className="ambient" aria-hidden>
        <div className="amb-blob amb-blob--1" />
        <div className="amb-blob amb-blob--2" />
        <div className="amb-blob amb-blob--3" />
        <div className="grid-overlay" />
      </div>

      {/* ── Navbar ── */}
      <header className="nav" role="banner">
        <div className="nav-inner">
          <button className="nav-logo" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} type="button">
            <span className="logo-bracket">&lt;</span>
            <span className="logo-name">RS</span>
            <span className="logo-bracket">/&gt;</span>
          </button>

          <nav className="nav-links" role="navigation">
            {(['projects', 'experience', 'skills'] as const)
              .filter(id => isSectionOn(id))
              .map(id => (
              <button key={id} className="nav-pill" onClick={() => scrollTo(id)} type="button">
                {id}
              </button>
            ))}
            {isSectionOn('contact') && (
              <button className="nav-pill" onClick={() => scrollTo('contact')} type="button">
                contact
              </button>
            )}
          </nav>

          <div className="nav-right">
            {openToWork && (
              <span className="avail-badge">
                <span className="avail-dot" />
                Open to work
              </span>
            )}
            <button
              className="terminal-mode-btn"
              onClick={() => setTerminalMode(true)}
              title="Explore the interactive 3D room"
              type="button"
            >
              <span style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 1 }}>[ 3D ROOM ]</span>
            </button>
            <button
              className="theme-btn"
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              type="button"
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <main>

        {/* ══════════════════════════════════════════
            HERO
        ══════════════════════════════════════════ */}
        <section className="hero" aria-label="Introduction">
          <div className="hero-inner">

            {/* Left column */}
            <div className="hero-content">
              <div className="hero-eyebrow-row">
                <span className="hero-eyebrow">
                  {profile?.eyebrow ?? 'Production AI · LangGraph · RAG · MLOps'}
                </span>
              </div>

              <h1 className="hero-name">
                {typedName}
                <span className="cursor" aria-hidden>▌</span>
              </h1>

              <div className="hero-role-line">
                <span className="role-prefix">—&nbsp;</span>
                <span className="hero-role">{typedHead}</span>
                {headDone && <span className="cursor role-cursor" aria-hidden>▌</span>}
              </div>

              <div className="hero-meta">
                <span className="meta-chip">
                  <svg className="meta-svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/>
                  </svg>
                  {(profile?.currentLocation || profile?.location) ?? 'India'}
                </span>
                {desiredLoc.length > 0 && (
                  <span className="meta-chip">
                    <svg className="meta-svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                    Open to {desiredLoc.slice(0, 3).join(' · ')}
                  </span>
                )}
                {experience[0] && (
                  <span className="meta-chip">
                    <svg className="meta-svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                    </svg>
                    {experience[0].company}
                  </span>
                )}
              </div>

              <p className="hero-about">
                {profile?.about ?? 'Building intelligent systems at the intersection of research and production.'}
              </p>

              <div className="hero-actions">
                <button
                  className="btn-primary"
                  onClick={() => { setChatOpen(true); setTimeout(() => chatInputRef.current?.focus(), 100) }}
                  type="button"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  Ask AI assistant
                </button>
                <button className="btn-ghost" onClick={() => scrollTo('projects')} type="button">
                  View projects <span className="btn-arrow">↓</span>
                </button>
              </div>
            </div>

            {/* Right column — stats card */}
            <div className="hero-stats-col">
              <TiltCard className="stats-card">
                <div className="stats-card-header">
                  <span className="stats-dot stats-dot--green" />
                  <span className="stats-dot stats-dot--yellow" />
                  <span className="stats-dot stats-dot--red" />
                  <span className="stats-file">portfolio.json</span>
                </div>
                <div className="stats-body">
                  <StatRow label="projects" value={String(projects.length).padStart(2, '0')} />
                  <StatRow label="stack" value={`${skills.reduce((n, s) => n + s.items.length, 0)} tools`} />
                  <StatRow label="experience" value={experience[0]?.dateRange?.replace(' - Present', '+') ?? '2024+'} />
                  <StatRow label="status" value={openToWork ? 'open_to_work' : 'employed'} accent={openToWork} />
                  <StatRow label="location" value={(profile?.currentLocation || profile?.location) ?? 'India'} />
                </div>
              </TiltCard>
            </div>
          </div>

          {/* Scroll hint */}
          <div className="scroll-hint" aria-hidden>
            <span className="scroll-line" />
            <span className="scroll-label">scroll</span>
          </div>
        </section>

        {loading && <div className="loading-bar" aria-label="Loading" />}

        {/* ══════════════════════════════════════════
            PROJECTS
        ══════════════════════════════════════════ */}
        {isSectionOn('projects') && projects.length > 0 && (
          <RevealSection id="projects" className="section">
            <SectionLabel index="01" title="Projects" sub={`${projects.length} shipped`} />
            <div className="projects-grid">
              {projects.map((project, i) => (
                <TiltCard
                  key={project.id}
                  className={`project-card ${i === 0 ? 'project-card--featured' : ''}`}
                  onClick={() => setActiveProject(project)}
                >
                  <div className="project-card-inner">
                    <div className="project-top">
                      <span className="project-num">{String(i + 1).padStart(2, '0')}</span>
                      <span className="project-arrow">↗</span>
                    </div>
                    <h3 className="project-title">{project.title}</h3>
                    <p className="project-summary">{project.summary}</p>
                    <div className="project-stack">
                      {project.techStack.slice(0, 5).map(t => (
                        <span className="stack-pill" key={t}>{t}</span>
                      ))}
                      {project.techStack.length > 5 && (
                        <span className="stack-pill stack-pill--more">+{project.techStack.length - 5}</span>
                      )}
                    </div>
                  </div>
                  <div className="card-shine" aria-hidden />
                </TiltCard>
              ))}
            </div>
          </RevealSection>
        )}

        {/* ══════════════════════════════════════════
            EXPERIENCE
        ══════════════════════════════════════════ */}
        {isSectionOn('experience') && (
        <RevealSection id="experience" className="section">
          <SectionLabel index="02" title="Experience" sub={experience.length > 0 ? `${experience.length} role${experience.length === 1 ? '' : 's'}` : ''} />
          <div className="timeline">
            {experience.map((exp, i) => (
              <article className="timeline-item" key={`${exp.company}-${i}`}>
                <div className="timeline-marker">
                  <span className="tl-dot" />
                  {i < experience.length - 1 && <span className="tl-line" />}
                </div>
                <div className="timeline-body">
                  <div className="timeline-head">
                    <div>
                      <h3 className="tl-role">{exp.role || exp.company}</h3>
                      <p className="tl-company">{exp.company}</p>
                    </div>
                    {exp.dateRange && (
                      <span className="tl-date">{exp.dateRange}</span>
                    )}
                  </div>
                  {exp.summary && <p className="tl-summary">{exp.summary}</p>}
                  {exp.items.length > 0 && (
                    <ul className="tl-items">
                      {exp.items.map(item => (
                        <li key={item}>
                          <span className="tl-bullet">▸</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                  {exp.highlights.slice(0, 2).map(h => (
                    <p className="tl-highlight" key={h}>{h}</p>
                  ))}
                </div>
              </article>
            ))}
            {experience.length === 0 && !loading && (
              <p className="empty-state">Add experience in the admin panel.</p>
            )}
          </div>
        </RevealSection>
        )}

        {/* ══════════════════════════════════════════
            SKILLS
        ══════════════════════════════════════════ */}
        {isSectionOn('skills') && (
        <RevealSection id="skills" className="section">
          <SectionLabel index="03" title="Skills" sub={`${skills.reduce((n, s) => n + s.items.length, 0)} tools`} />
          <div className="skills-grid">
            {skills.map(cat => (
              <div className="skill-cat" key={cat.category}>
                <div className="skill-cat-header">
                  <span className="skill-cat-icon">{catIconSvg[cat.category] ?? defaultCatIcon}</span>
                  <span className="skill-cat-name">{cat.category}</span>
                </div>
                <div className="skill-chips">
                  {cat.items.map(item => (
                    <span className="skill-chip" key={item}>{item}</span>
                  ))}
                </div>
              </div>
            ))}
            {skills.length === 0 && !loading && (
              <p className="empty-state">Add skills in the admin panel.</p>
            )}
          </div>
        </RevealSection>
        )}

        {/* ══════════════════════════════════════════
            SCHEDULE A CALL
        ══════════════════════════════════════════ */}
        {isSectionOn('scheduling') && schedulingEnabled && (
          <RevealSection id="scheduling" className="section">
            <SectionLabel index="04" title={scheduling.headline || 'Schedule a call'} sub="live availability" />
            <div className="schedule-card">
              <div className="schedule-copy">
                <p className="schedule-text">
                  {scheduling.subtext || "Book a 30-minute call — pick a time that works and you'll get a Google Meet link automatically."}
                </p>
                <a
                  className="btn-primary schedule-btn"
                  href={normalizeCalUrl(scheduling.calLink!)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                  Book a time
                </a>
              </div>
            </div>
          </RevealSection>
        )}

        {/* ══════════════════════════════════════════
            CONTACT
        ══════════════════════════════════════════ */}
        {isSectionOn('contact') && (
          <RevealSection id="contact" className="section">
            <SectionLabel index="05" title="Get in touch" sub="let's build something" />
            <div className="contact-wrap">
              <div className="contact-intro">
                <p className="contact-lead">
                  Have a role, a project, or just a question? Drop a message and I'll get back to you.
                </p>
                <div className="contact-links">
                  {socialLinks.email && (
                    <a href={`mailto:${socialLinks.email}`} className="contact-link-chip">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>
                      {socialLinks.email}
                    </a>
                  )}
                  {socialLinks.linkedin && (
                    <a href={socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="contact-link-chip">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
                      LinkedIn
                    </a>
                  )}
                </div>
              </div>

              {contactStatus === 'sent' ? (
                <div className="contact-success" role="status">
                  <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
                  <h3>Message sent!</h3>
                  <p>Thanks for reaching out — I'll reply soon.</p>
                  <button className="btn-ghost" type="button" onClick={() => setContactStatus('idle')}>Send another</button>
                </div>
              ) : (
                <form className="contact-form" onSubmit={handleContactSubmit}>
                  <div className="contact-row">
                    <label className="contact-field">
                      <span>Name</span>
                      <input
                        type="text" value={contactName}
                        onChange={e => setContactName(e.target.value)}
                        placeholder="Your name" autoComplete="name" required
                      />
                    </label>
                    <label className="contact-field">
                      <span>Email</span>
                      <input
                        type="email" value={contactEmail}
                        onChange={e => setContactEmail(e.target.value)}
                        placeholder="you@example.com" autoComplete="email" required
                      />
                    </label>
                  </div>
                  <label className="contact-field">
                    <span>Message</span>
                    <textarea
                      value={contactMessage}
                      onChange={e => setContactMessage(e.target.value)}
                      placeholder="What's on your mind?" rows={5} required
                    />
                  </label>
                  {contactError && <p className="contact-error" role="alert">{contactError}</p>}
                  <button className="btn-primary contact-submit" type="submit" disabled={contactStatus === 'sending'}>
                    {contactStatus === 'sending' ? 'Sending…' : 'Send message'}
                  </button>
                </form>
              )}
            </div>
          </RevealSection>
        )}

        {/* ══════════════════════════════════════════
            FOOTER
        ══════════════════════════════════════════ */}
        <footer className="footer">
          <div className="footer-inner">
            <span className="footer-name">
              <span className="logo-bracket">&lt;</span>
              {name}
              <span className="logo-bracket">/&gt;</span>
            </span>
            <span className="footer-tagline">
              AI/ML Engineer · {(profile?.currentLocation || profile?.location) ?? 'India'}
            </span>
            <button
              className="footer-chat-btn"
              onClick={() => setChatOpen(true)}
              type="button"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Chat with AI
            </button>
          </div>
        </footer>

      </main>

      {/* ══════════════════════════════════════════
          CHAT WIDGET
      ══════════════════════════════════════════ */}
      <>
        {!chatOpen && (
          <button
            className="chat-fab"
            onClick={() => { setChatOpen(true); setTimeout(() => chatInputRef.current?.focus(), 80) }}
            aria-label="Open portfolio assistant"
            type="button"
          >
            <span className="fab-ring" aria-hidden />
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="rgba(255,255,255,.95)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', zIndex: 1 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        )}

        <div className={`chat-panel ${chatOpen ? 'chat-panel--open' : ''}`} role="complementary">
          <div className="chat-header">
            <div className="chat-header-info">
              <span className="chat-avatar-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="10" rx="2"/><path d="M9 11V7a3 3 0 0 1 6 0v4M9 15h.01M15 15h.01"/>
                </svg>
              </span>
              <div>
                <p className="chat-title">AI Assistant</p>
                <p className="chat-subtitle">Grounded in your documents</p>
              </div>
            </div>
            <button
              className="chat-close"
              onClick={() => setChatOpen(false)}
              aria-label="Close chat"
              type="button"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {activeProject && (
            <div className="chat-context-bar">
              <span>Viewing:</span>
              <strong>{activeProject.title}</strong>
              <button onClick={() => setActiveProject(null)} type="button">✕</button>
            </div>
          )}

          <div className="chat-messages" role="log" aria-live="polite">
            {messages.map((msg, i) => (
              <div key={i} className={`chat-msg chat-msg--${msg.role}`}>
                <div className="chat-bubble">
                  {msg.role === 'assistant'
                    ? <ChatMarkdown text={msg.content} />
                    : msg.content}
                </div>
              </div>
            ))}
            {chatting && (
              <div className="chat-msg chat-msg--assistant">
                <div className="chat-bubble chat-bubble--typing">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="chat-input-row">
            <input
              ref={chatInputRef}
              className="chat-input"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void send() }}
              placeholder="Ask about projects, skills, experience…"
              aria-label="Message"
              type="text"
            />
            <button
              className="chat-send"
              onClick={() => void send()}
              disabled={chatting || !chatInput.trim()}
              type="button"
              aria-label="Send message"
            >
              {chatting ? (
                <span className="send-spinner" aria-hidden />
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7"/>
                </svg>
              )}
            </button>
          </div>
        </div>
        {chatOpen && <div className="chat-backdrop" onClick={() => setChatOpen(false)} aria-hidden />}
      </>

      {/* ══════════════════════════════════════════
          PROJECT MODAL
      ══════════════════════════════════════════ */}
      {activeProject && (
        <div
          className="modal-backdrop"
          onClick={e => { if (e.target === e.currentTarget) setActiveProject(null) }}
          role="presentation"
        >
          <div className="modal" role="dialog" aria-modal aria-labelledby="modal-title">
            <div className="modal-glow" aria-hidden />
            <button className="modal-close" onClick={() => setActiveProject(null)} aria-label="Close" type="button">✕</button>

            <p className="modal-label">Project</p>
            <h2 id="modal-title" className="modal-title">{activeProject.title}</h2>

            <div className="modal-body">
              <div className="modal-section">
                <p className="modal-section-heading">Overview</p>
                <p className="modal-text">{activeProject.summary}</p>
              </div>

              {(activeProject.whatItDoes ?? []).length > 0 && (
                <div className="modal-section">
                  <p className="modal-section-heading">What it does</p>
                  <ul className="modal-list">
                    {(activeProject.whatItDoes ?? []).map(line => (
                      <li key={line}><span className="modal-bullet">▸</span>{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              {activeProject.techStack.length > 0 && (
                <div className="modal-section">
                  <p className="modal-section-heading">Tech Stack</p>
                  <div className="modal-stack">
                    {activeProject.techStack.map(t => <span className="stack-pill" key={t}>{t}</span>)}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button
                className="btn-primary"
                onClick={() => {
                  setChatOpen(true)
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `I can see you're exploring "${activeProject.title}". What would you like to know about it?`
                  }])
                }}
                type="button"
              >
                💬 Ask about this project
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════ */}
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-name">
            <span className="logo-bracket">&lt;</span>
            <span>RS</span>
            <span className="logo-bracket">/&gt;</span>
          </div>
          <div className="footer-links">
            {socialLinks.linkedin && (
              <a href={socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="footer-link" aria-label="LinkedIn">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
                  <rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>
                </svg>
                <span>LinkedIn</span>
              </a>
            )}
            {socialLinks.github && (
              <a href={socialLinks.github} target="_blank" rel="noopener noreferrer" className="footer-link" aria-label="GitHub">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                </svg>
                <span>GitHub</span>
              </a>
            )}
            {socialLinks.email && (
              <a href={`mailto:${socialLinks.email}`} className="footer-link" aria-label="Email">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
                <span>Contact</span>
              </a>
            )}
          </div>
          <p className="footer-copy">© {new Date().getFullYear()} Raj Sahoo</p>
        </div>
      </footer>

    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ index, title, sub }: { index: string; title: string; sub?: string }) {
  return (
    <div className="section-label">
      <span className="section-num">{index}</span>
      <h2 className="section-title">{title}</h2>
      {sub && <span className="section-sub">{sub}</span>}
    </div>
  )
}

function StatRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="stat-row">
      <span className="stat-key">"{label}"</span>
      <span className="stat-colon">:</span>
      <span className={`stat-val ${accent ? 'stat-val--accent' : ''}`}>"{value}"</span>
      <span className="stat-comma">,</span>
    </div>
  )
}
