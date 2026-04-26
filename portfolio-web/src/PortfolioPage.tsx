import { useEffect, useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'

type ExperienceItem = {
  company: string
  dateRange?: string
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
}

type ProjectDetails = ProjectCard & {
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

type ChatResponse = { answer: string }
type ChatMessage  = { role: 'user' | 'assistant'; content: string }

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

function fileLabel(path: string) {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, init)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

/* ── Sun icon ─────────────────────────────────────── */
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}

/* ── Moon icon ────────────────────────────────────── */
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

function PortfolioPage() {
  const [portfolio, setPortfolio]             = useState<PortfolioPayload | null>(null)
  const [loading, setLoading]                 = useState(true)
  const [error, setError]                     = useState<string | null>(null)
  const [theme, setTheme]                     = useState<'light'|'dark'>(() =>
    (localStorage.getItem('theme') as 'light'|'dark') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  )
  const [widgetOpen, setWidgetOpen]           = useState(false)
  const [chatInput, setChatInput]             = useState('')
  const [chatting, setChatting]               = useState(false)
  const [messages, setMessages]               = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hi! I'm Raj's portfolio assistant. Ask me about his projects, ML systems, or AI engineering work." },
  ])
  const [activeProject, setActiveProject]     = useState<ProjectCard | null>(null)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [projectDetails, setProjectDetails]   = useState<ProjectDetails | null>(null)
  const [projectDetailsLoading, setProjectDetailsLoading] = useState(false)
  const [projectDetailsError, setProjectDetailsError]     = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  /* Apply theme to document */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme(t => t === 'light' ? 'dark' : 'light')
  }

  async function loadPortfolio() {
    try {
      setLoading(true)
      const payload = await fetchJson<PortfolioPayload>('/portfolio')
      setPortfolio(payload)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load portfolio data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadPortfolio() }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatting])

  const experience        = portfolio?.profile.experience ?? []
  const skills            = portfolio?.profile.skills ?? []
  const resumeProjects    = portfolio?.profile.resumeProjects ?? []
  const activeExperience  = experience[0]
  const openToWork        = portfolio?.profile.openToWork ?? true

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  async function openProject(project: ProjectCard) {
    setActiveProject(project)
    setProjectModalOpen(true)
    setProjectDetails(null)
    setProjectDetailsError(null)
    setProjectDetailsLoading(true)
    try {
      const payload = await fetchJson<{ project: ProjectDetails }>(`/projects/${encodeURIComponent(project.id)}`)
      setProjectDetails(payload.project)
    } catch (err) {
      setProjectDetails({ ...project, whatItDoes: [] })
      setProjectDetailsError(err instanceof Error ? err.message : 'Could not load details.')
    } finally {
      setProjectDetailsLoading(false)
    }
    if (widgetOpen) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I can see you're looking at "${project.title}". Feel free to ask me anything about it.`,
      }])
    }
  }

  function closeProject() {
    setProjectModalOpen(false)
    setProjectDetails(null)
    setProjectDetailsError(null)
  }

  async function sendMessage() {
    const prompt = chatInput.trim()
    if (!prompt || chatting) return
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: prompt }]
    setMessages(nextMessages)
    setChatInput('')
    setChatting(true)
    try {
      const history = messages.slice(1).map(m => ({ role: m.role, content: m.content }))
      const result = await fetchJson<ChatResponse>('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, include_debug: false, history, active_project_title: activeProject?.title || null }),
      })
      setMessages([...nextMessages, { role: 'assistant', content: result.answer }])
    } catch (err) {
      setMessages([...nextMessages, { role: 'assistant', content: err instanceof Error ? err.message : 'Chat request failed.' }])
    } finally {
      setChatting(false)
    }
  }

  return (
    <div className="page-shell">

      {/* ── Top Navigation ── */}
      <nav className="topnav" role="navigation">
        <div className="topnav-inner">
          <span className="nav-logo">
            {portfolio?.profile.name ?? 'Raj Sahoo'}<span>.</span>
          </span>

          <div className="nav-links">
            <button className="nav-link" onClick={() => scrollTo('experience')} type="button">Experience</button>
            <button className="nav-link" onClick={() => scrollTo('skills')} type="button">Skills</button>
          </div>

          <div className="nav-actions">
            {openToWork && (
              <span className="nav-badge">
                <span className="nav-badge-dot" />
                Open to work
              </span>
            )}
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              type="button"
            >
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Main Content ── */}
      <main className="page">

        {/* ── Hero ── */}
        <section className="hero" aria-label="Introduction">
          <div className="hero-left">
            <p className="eyebrow">
              <span className="eyebrow-line" />
              {portfolio?.profile.eyebrow ?? 'AI Systems - Production ML - Applied Research'}
            </p>
            <h1 className="hero-name">
              {portfolio?.profile.name ?? 'Raj Sahoo'}
            </h1>
            <p className="hero-title">
              {portfolio?.profile.headline ?? 'AI/ML Software Developer'}
            </p>
            <p className="hero-desc">
              {portfolio?.profile.about ?? 'Building intelligent systems at the intersection of research and production.'}
            </p>
            <div className="hero-cta-row">
              <button className="btn-primary" onClick={() => setWidgetOpen(true)} type="button">
                Ask the AI assistant
              </button>
              <button className="btn-ghost" onClick={() => scrollTo('experience')} type="button">
                View experience
              </button>
            </div>
          </div>

          <div className="hero-right">
            <div className="hero-stat-card">
              <p className="stat-label">Location</p>
              <p className="stat-value">{(portfolio?.profile.currentLocation || portfolio?.profile.location) ?? 'India'}</p>
            </div>
            <div className="hero-stat-card">
              <p className="stat-label">Status</p>
              <p className={`stat-value ${openToWork ? 'accent' : ''}`}>
                {openToWork ? (
                  <>
                    Open to new roles
                    {portfolio?.profile.desiredLocations && portfolio.profile.desiredLocations.length > 0 && (
                      <span style={{display: 'block', fontSize: '0.85em', color: 'var(--text)', fontWeight: 'normal', marginTop: '0.15rem'}}>
                        {portfolio.profile.desiredLocations.join(', ')}
                      </span>
                    )}
                  </>
                ) : 'Currently focused'}
              </p>
            </div>
            {activeExperience && (
              <div className="hero-stat-card">
                <p className="stat-label">Current role</p>
                <p className="stat-value">{activeExperience.company}</p>
                {activeExperience.dateRange && (
                  <div className="hero-meta-row">
                    <span className="meta-pill">{activeExperience.dateRange}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {loading && <p className="status-text">Loading portfolio data…</p>}

        {/* ── Experience ── */}
        <section className="section" id="experience" aria-labelledby="experience-heading">
          <div className="section-header">
            <h2 className="section-title" id="experience-heading">Experience</h2>
            <span className="section-sub">{experience.length} roles</span>
          </div>
          <div className="experience-list">
            {experience.map((item) => (
              <article className="experience-item" key={item.company}>
                <div className="exp-left">
                  <p className="exp-date">{item.dateRange ?? 'Current'}</p>
                  <p className="exp-company">{item.company}</p>
                </div>
                <div className="exp-right">
                  <h3 className="exp-role">{item.company}</h3>
                  <ul className="exp-items">
                    {item.items.slice(0, 5).map(work => (
                      <li key={work}>{work}</li>
                    ))}
                  </ul>
                  {item.highlights.length > 0 && (
                    <p className="exp-highlight">{item.highlights[0]}</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── Skills ── */}
        <section className="section" id="skills" aria-labelledby="skills-heading">
          <div className="section-header">
            <h2 className="section-title" id="skills-heading">Skills</h2>
            <span className="section-sub">{skills.length} categories</span>
          </div>
          <div className="skills-table">
            {skills.map((skill) => (
              <div className="skill-row" key={skill.category}>
                <span className="skill-cat-label">{skill.category}</span>
                <div className="skill-chips">
                  {skill.items.slice(0, 10).map(item => (
                    <span className="chip" key={item}>{item}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── More Work ── */}
        {resumeProjects.length > 0 && (
          <section className="section" aria-labelledby="more-heading">
            <div className="section-header">
              <h2 className="section-title" id="more-heading">More Work</h2>
              <span className="section-sub">Additional topics in the knowledge base</span>
            </div>
            <div className="more-tags">
              {resumeProjects.map(project => (
                <span className="more-tag" key={project}>{project}</span>
              ))}
            </div>
          </section>
        )}

        {/* ── Footer ── */}
        <footer className="page-footer">
          <span className="footer-name">{portfolio?.profile.name ?? 'Raj Sahoo'}</span>
          <span className="footer-copy">AI/ML Engineer · {(portfolio?.profile.currentLocation || portfolio?.profile.location) ?? 'India'}</span>
        </footer>

      </main>

      {/* ── Chat Widget ── */}
      <div className="chat-widget" role="complementary" aria-label="Portfolio assistant">
        {!widgetOpen ? (
          <button
            className="chat-fab"
            onClick={() => setWidgetOpen(true)}
            type="button"
          >
            <span className="chat-fab-dot" />
            Ask the AI
          </button>
        ) : (
          <div className="widget-panel">
            <div className="widget-header">
              <div className="widget-header-text">
                <strong>Portfolio Assistant</strong>
                <p>Grounded in Raj's indexed documents</p>
              </div>
              <button
                className="widget-close-btn"
                onClick={() => setWidgetOpen(false)}
                aria-label="Close assistant"
                type="button"
              >
                ×
              </button>
            </div>

            <div className="widget-messages" role="log" aria-live="polite">
              {messages.map((message, index) => (
                <div
                  className={`message ${message.role}`}
                  key={`${message.role}-${index}`}
                >
                  <p>{message.content}</p>
                </div>
              ))}
              {chatting && (
                <div className="message assistant typing" aria-label="Assistant is thinking">
                  <div className="typing-indicator">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="widget-input-row">
              <input
                className="widget-input"
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void sendMessage() }}
                placeholder="Ask about projects, skills, experience…"
                type="text"
                value={chatInput}
                aria-label="Message input"
              />
              <button
                className="widget-send"
                disabled={chatting}
                onClick={() => void sendMessage()}
                type="button"
              >
                {chatting ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Project Modal ── */}
      {projectModalOpen && (
        <div
          className="modal-overlay"
          onClick={e => { if (e.currentTarget === e.target) closeProject() }}
          role="presentation"
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-header">
              <div>
                <p className="modal-tag">Project</p>
                <h2 id="modal-title">{activeProject?.title ?? 'Project'}</h2>
              </div>
              <button
                className="modal-close"
                onClick={closeProject}
                aria-label="Close project details"
                type="button"
              >
                ×
              </button>
            </div>

            {projectDetailsLoading && <p className="status-text" style={{ padding: '1.5rem 2rem' }}>Loading…</p>}

            {projectDetails && (
              <div className="modal-body">
                <div className="modal-section">
                  <p className="modal-section-label">Overview</p>
                  <p>{projectDetails.summary}</p>
                </div>

                {projectDetails.whatItDoes && projectDetails.whatItDoes.length > 0 ? (
                  <div className="modal-section">
                    <p className="modal-section-label">What it does</p>
                    <ul className="modal-list">
                      {projectDetails.whatItDoes.map(line => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="modal-section">
                    <p className="modal-section-label">What it does</p>
                    <p style={{ color: 'var(--faint)', fontSize: '0.875rem' }}>
                      Upload this project's document in Admin with "Create or update a project card" enabled to generate details here.
                    </p>
                  </div>
                )}

                {projectDetails.techStack.length > 0 && (
                  <div className="modal-section">
                    <p className="modal-section-label">Tech Stack</p>
                    <div className="tech-pills" style={{ marginTop: 0 }}>
                      {projectDetails.techStack.map(tech => (
                        <span className="tech-pill" key={tech}>{tech}</span>
                      ))}
                    </div>
                  </div>
                )}

                {projectDetailsError && (
                  <p style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.75rem', color: 'var(--faint)' }}>
                    {projectDetailsError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

export default PortfolioPage
