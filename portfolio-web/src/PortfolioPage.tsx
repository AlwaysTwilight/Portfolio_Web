import { useEffect, useMemo, useState, useRef } from 'react'

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
    openToWork: boolean
    experience: ExperienceItem[]
    skills: SkillCategory[]
    resumeProjects: string[]
  }
  projects: ProjectCard[]
}

type ChatResponse = {
  answer: string
}

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001'

function fileLabel(path: string) {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init)
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return response.json() as Promise<T>
}

function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [widgetOpen, setWidgetOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatting, setChatting] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hi! I'm Raj's portfolio assistant. Ask me about his projects, ML systems, or AI engineering work." },
  ])
  const [activeProject, setActiveProject] = useState<ProjectCard | null>(null)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null)
  const [projectDetailsLoading, setProjectDetailsLoading] = useState(false)
  const [projectDetailsError, setProjectDetailsError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    void loadPortfolio()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatting])

  const featuredProjects = useMemo(() => portfolio?.projects ?? [], [portfolio])
  const experience = portfolio?.profile.experience ?? []
  const skills = portfolio?.profile.skills ?? []
  const resumeProjects = portfolio?.profile.resumeProjects ?? []
  const activeExperience = experience[0]
  const openToWork = portfolio?.profile.openToWork ?? true

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
      // Placeholder cards (inferred from Resume) won't exist in the backend yet.
      setProjectDetails({ ...project, whatItDoes: [] })
      setProjectDetailsError(err instanceof Error ? err.message : 'Could not load project details.')
    } finally {
      setProjectDetailsLoading(false)
    }

    // If the chat widget is open, proactively cue the assistant.
    if (widgetOpen) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `I can see you're looking at "${project.title}". Feel free to ask me anything about this project.`,
        },
      ])
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
      const history = messages.slice(1).map((m) => ({ role: m.role, content: m.content }))
      const result = await fetchJson<ChatResponse>('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          include_debug: false,
          history,
          active_project_title: activeProject?.title || null,
        }),
      })
      setMessages([...nextMessages, { role: 'assistant', content: result.answer }])
    } catch (err) {
      setMessages([
        ...nextMessages,
        { role: 'assistant', content: err instanceof Error ? err.message : 'Chat request failed.' },
      ])
    } finally {
      setChatting(false)
    }
  }

  return (
    <div className="page-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      {/* Admin UI runs on a separate port and isn't linked from the public portfolio. */}

      <main className="page">
        {/* Hero */}
        <section className="hero card-panel">
          <div>
            <p className="eyebrow">AI Systems | Production ML | Applied Research</p>
            <h1>{portfolio?.profile.name ?? 'Raj Sahoo'}</h1>
            <p className="headline">{portfolio?.profile.headline ?? 'AI/ML Software Developer'}</p>
            <p className="about-copy">
              {portfolio?.profile.about ?? 'Building intelligent systems at the intersection of research and production.'}
            </p>
            <div className="hero-meta">
              <span>{portfolio?.profile.location ?? 'India'}</span>
              <span>{featuredProjects.length} projects indexed</span>
              <span>{experience.length} roles</span>
            </div>
          </div>

          <div className="hero-side">
            <div className={`hero-badge ${openToWork ? 'badge-live' : 'badge-muted'}`}>
              {openToWork ? 'Open to new roles' : 'Currently focused'}
            </div>

            <p>
              I ship production-grade AI products, retrieval systems, agent pipelines, and intelligent internal tooling.
              This portfolio is grounded in a document index and powered by a live conversational assistant.
            </p>

            {activeExperience ? (
              <div className="hero-focus">
                <strong>Current</strong>
                <p>
                  {activeExperience.company}
                  {activeExperience.dateRange ? ` | ${activeExperience.dateRange}` : ''}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        {/* Featured Projects */}
        <section className="card-panel">
          <div className="section-heading">
            <h2>Featured Projects</h2>
            <p>Production work across conversational AI, retrieval systems, and ML pipelines.</p>
          </div>
          <div className="project-grid">
            {featuredProjects.map((project) => (
              <button
                className="project-card project-card-button"
                key={project.id}
                onClick={() => void openProject(project)}
                type="button"
              >
                <div className="project-topline">
                  <h3>{project.title}</h3>
                  <span className="project-source">{fileLabel(project.sourcePath)}</span>
                </div>
                <p>{project.summary}</p>
                {project.techStack.length ? (
                  <div className="chip-row">
                    {project.techStack.slice(0, 8).map((tech) => (
                      <span className="chip chip-accent" key={tech}>{tech}</span>
                    ))}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </section>

        {/* Experience + Skills */}
        <div className="grid two-up">
          <div className="card-panel">
            <div className="section-heading">
              <h2>Experience</h2>
              <p>Production roles that shaped my approach to AI engineering.</p>
            </div>
            <div className="stack-list">
              {experience.map((item) => (
                <article className="experience-card" key={item.company}>
                  <div className="experience-topline">
                    <h3>{item.company}</h3>
                    <span>{item.dateRange ?? 'Current'}</span>
                  </div>
                  <ul>
                    {item.items.slice(0, 6).map((work) => (
                      <li key={work}>{work}</li>
                    ))}
                  </ul>
                  {item.highlights.length > 0 && (
                    <p className="experience-note">{item.highlights[0]}</p>
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="card-panel">
            <div className="section-heading">
              <h2>Tech Stack</h2>
              <p>Tools I rely on to build and ship AI systems end-to-end.</p>
            </div>
            <div className="skill-grid">
              {skills.map((skill) => (
                <article className="skill-card" key={skill.category}>
                  <h3>{skill.category}</h3>
                  <div className="chip-row">
                    {skill.items.slice(0, 7).map((item) => (
                      <span className="chip" key={item}>{item}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>

        {/* Additional Projects */}
        <section className="card-panel compact-panel">
          <div className="section-heading">
            <h2>More Work</h2>
            <p>Additional domains covered in the knowledge base. Ask the assistant about any of these.</p>
          </div>
          <div className="chip-row">
            {resumeProjects.map((project) => (
              <span className="chip" key={project}>{project}</span>
            ))}
          </div>
        </section>

        {loading && <div className="card-panel"><p className="status-text">Loading portfolio data...</p></div>}
        {error && <div className="card-panel error-box"><p>{error}</p></div>}
      </main>

      {/* Chat widget */}
      <div className="chat-widget">
        {!widgetOpen ? (
          <button
            className="widget-toggle"
            onClick={() => {
              setWidgetOpen(true)
              if (activeProject) {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: 'assistant',
                    content: `I can see you're looking at "${activeProject.title}". Feel free to ask me anything about this project.`,
                  },
                ])
              }
            }}
            type="button"
          >
            Ask the AI
          </button>
        ) : null}

        {widgetOpen && (
          <div className="widget-panel">
            <div className="widget-header">
              <div className="widget-header-row">
                <div>
                  <strong>Portfolio Assistant</strong>
                  <p>Grounded in Raj&apos;s indexed documents</p>
                </div>
                <button className="widget-close" onClick={() => setWidgetOpen(false)} type="button">
                  Close
                </button>
              </div>
            </div>

            <div className="widget-messages">
              {messages.map((message, index) => (
                <div
                  className={`message ${message.role}`}
                  key={`${message.role}-${index}`}
                >
                  <p>{message.content}</p>
                </div>
              ))}

              {chatting && (
                <div className="message assistant typing">
                  <div className="typing-indicator" aria-label="Assistant is thinking">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="widget-input-row">
              <input
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void sendMessage() }}
                placeholder="Ask about projects, skills, experience..."
                type="text"
                value={chatInput}
              />
              <button
                className="primary-button"
                disabled={chatting}
                onClick={() => void sendMessage()}
                type="button"
              >
                {chatting ? '...' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>

      {projectModalOpen ? (
        <div
          className="modal-overlay"
          onClick={(event) => {
            if (event.currentTarget === event.target) closeProject()
          }}
          role="presentation"
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Project</p>
                <h2>{activeProject?.title || 'Project'}</h2>
              </div>
              <button className="widget-toggle" onClick={closeProject} type="button">
                Close
              </button>
            </div>

            {projectDetailsLoading ? <p className="status-text">Loading project details...</p> : null}
            {projectDetailsError ? <p className="status-text" style={{ color: 'var(--danger)' }}>{projectDetailsError}</p> : null}

            {projectDetails ? (
              <div className="modal-body">
                <section className="modal-section">
                  <h3>What it is</h3>
                  <p className="status-text">{projectDetails.summary}</p>
                </section>

                {projectDetails.whatItDoes && projectDetails.whatItDoes.length ? (
                  <section className="modal-section">
                    <h3>What it does</h3>
                    <ul className="modal-list">
                      {projectDetails.whatItDoes.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </section>
                ) : (
                  <section className="modal-section">
                    <h3>What it does</h3>
                    <p className="status-text">
                      Upload this project&apos;s markdown/PDF in Admin with "Create or update a project card" enabled to generate details here.
                    </p>
                  </section>
                )}

                <section className="modal-section">
                  <h3>Tech stack</h3>
                  {projectDetails.techStack.length ? (
                    <div className="chip-row">
                      {projectDetails.techStack.map((tech) => (
                        <span className="chip chip-accent" key={tech}>{tech}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="status-text">No tech stack extracted yet.</p>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default PortfolioPage
