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
  }
  projects: ProjectCard[]
}

type ChatMessage = { role: 'user' | 'assistant'; content: string }

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
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

  // ── Chat ──
  async function send() {
    const msg = chatInput.trim()
    if (!msg || chatting) return
    const next: ChatMessage[] = [...messages, { role: 'user', content: msg }]
    setMessages(next); setChatInput(''); setChatting(true)
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

  const profile = portfolio?.profile
  const projects = (portfolio?.projects ?? []).filter(p => p.isVisible !== false)
  const skills = profile?.skills ?? []
  const experience = profile?.experience ?? []
  const openToWork = profile?.openToWork ?? false
  const desiredLoc = profile?.desiredLocations ?? []

  // ── Category icons ──
  const catIcon: Record<string, string> = {
    'Languages': '{ }',
    'AI / ML': '🤖',
    'Frameworks': '⚡',
    'Databases': '🗄️',
    'DevOps / Tools': '🔧',
  }

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
            {(['projects', 'experience', 'skills'] as const).map(id => (
              <button key={id} className="nav-pill" onClick={() => scrollTo(id)} type="button">
                {id}
              </button>
            ))}
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
              title="Switch to interactive terminal mode"
              type="button"
            >
              <span style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 1 }}>[ TERMINAL ]</span>
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
        {projects.length > 0 && (
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

        {/* ══════════════════════════════════════════
            SKILLS
        ══════════════════════════════════════════ */}
        <RevealSection id="skills" className="section">
          <SectionLabel index="03" title="Skills" sub={`${skills.reduce((n, s) => n + s.items.length, 0)} tools`} />
          <div className="skills-grid">
            {skills.map(cat => (
              <div className="skill-cat" key={cat.category}>
                <div className="skill-cat-header">
                  <span className="skill-cat-icon">{catIcon[cat.category] ?? '◆'}</span>
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
                <div className="chat-bubble">{msg.content}</div>
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
