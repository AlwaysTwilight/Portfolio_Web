import { FormEvent, useEffect, useMemo, useState } from 'react'

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
  documents: Array<{
    logical_document_key: string
    active_version_id?: string | null
    updated_at?: string | null
    versions: Array<{
      version_id: string
      file_name: string
      status: string
      is_active: boolean
      chunk_count: number
    }>
  }>
}

type UploadResult = {
  logical_document_key: string
  version_id: string
  status: string
  chunk_count: number
}

type ChatResponse = {
  answer: string
}

type AdminSettings = {
  open_to_work: boolean
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

function App() {
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [documents, setDocuments] = useState<PortfolioPayload['documents']>([])
  const [adminOpen, setAdminOpen] = useState(false)
  const [widgetOpen, setWidgetOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatting, setChatting] = useState(false)
  const [openToWorkSaving, setOpenToWorkSaving] = useState(false)
  const [openToWork, setOpenToWork] = useState(true)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hi! I'm Raj's portfolio assistant. Ask me about projects, experience, or his AI systems work." },
  ])

  async function loadPortfolio() {
    try {
      setLoading(true)
      const payload = await fetchJson<PortfolioPayload>('/portfolio')
      setPortfolio(payload)
      setDocuments(payload.documents)
      setOpenToWork(payload.profile.openToWork)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load portfolio data.')
    } finally {
      setLoading(false)
    }
  }

  async function loadAdminSettings() {
    try {
      const payload = await fetchJson<AdminSettings>('/admin/settings')
      setOpenToWork(payload.open_to_work)
    } catch {
      // Keep the page usable even if the local admin settings call fails.
    }
  }

  useEffect(() => {
    void loadPortfolio()
    void loadAdminSettings()
  }, [])

  const featuredProjects = useMemo(() => portfolio?.projects ?? [], [portfolio])
  const experience = portfolio?.profile.experience ?? []
  const skills = portfolio?.profile.skills ?? []
  const resumeProjects = portfolio?.profile.resumeProjects ?? []
  const activeExperience = experience[0]

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const file = formData.get('file') as File | null
    const logicalKey = String(formData.get('logical_document_key') || '').trim()
    const sourceLabel = String(formData.get('source_label') || '').trim()
    const ingestNow = formData.get('ingest_now') === 'on'

    if (!file || !logicalKey) {
      setUploadStatus('Choose a file and logical document key first.')
      return
    }

    const payload = new FormData()
    payload.append('file', file)
    payload.append('logical_document_key', logicalKey)
    payload.append('source_label', sourceLabel)
    payload.append('ingest_now', String(ingestNow))

    try {
      setUploading(true)
      setUploadStatus('Uploading and indexing...')
      const result = await fetchJson<UploadResult>('/upload', { method: 'POST', body: payload })
      setUploadStatus(`Indexed ${result.logical_document_key} with ${result.chunk_count} chunks.`)
      form.reset()
      await loadPortfolio()
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function updateOpenToWork(nextValue: boolean) {
    setOpenToWork(nextValue)
    try {
      setOpenToWorkSaving(true)
      const result = await fetchJson<AdminSettings>('/admin/settings/open-to-work', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open_to_work: nextValue }),
      })
      setOpenToWork(result.open_to_work)
      await loadPortfolio()
    } catch {
      setOpenToWork(!nextValue)
    } finally {
      setOpenToWorkSaving(false)
    }
  }

  async function sendMessage() {
    const prompt = chatInput.trim()
    if (!prompt || chatting) return

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: prompt }]
    setMessages(nextMessages)
    setChatInput('')
    setChatting(true)

    try {
      // Build history: exclude the initial greeting (index 0), send all prior turns
      const history = messages.slice(1).map((m) => ({ role: m.role, content: m.content }))
      const result = await fetchJson<ChatResponse>('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, include_debug: false, history }),
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

      <button className="admin-toggle" onClick={() => setAdminOpen((value) => !value)} type="button">
        {adminOpen ? 'Close Admin Panel' : 'Open Admin Panel'}
      </button>

      <main className="page">
        <section className="hero card-panel">
          <div>
            <p className="eyebrow">AI Systems • Production Engineering • Applied ML</p>
            <h1>{portfolio?.profile.name ?? 'Raj Sahoo'}</h1>
            <p className="headline">{portfolio?.profile.headline ?? 'AI/ML Software Developer'}</p>
            <p className="about-copy">{portfolio?.profile.about ?? 'Loading profile...'}</p>
            <div className="hero-meta">
              <span>{portfolio?.profile.location ?? 'India'}</span>
              <span>{featuredProjects.length} featured projects</span>
              <span>{openToWork ? 'Open To Work' : 'Not Open To Work'}</span>
            </div>
          </div>
          <div className="hero-side">
            <div className={`hero-badge ${openToWork ? 'badge-live' : 'badge-muted'}`}>
              {openToWork ? 'Currently Open To Work' : 'Currently Focused On Existing Work'}
            </div>
            <p>
              I build production-grade AI products, retrieval systems, automation pipelines, and intelligent internal tools.
              This portfolio surfaces my work and lets visitors ask questions through a document-grounded assistant.
            </p>
            {activeExperience ? (
              <div className="hero-focus">
                <strong>Current role</strong>
                <p>
                  {activeExperience.company}
                  {activeExperience.dateRange ? ` • ${activeExperience.dateRange}` : ''}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="card-panel">
          <div className="section-heading">
            <h2>Featured Projects</h2>
            <p>Selected work across conversational AI, retrieval systems, and real-world production pipelines.</p>
          </div>
          <div className="project-grid">
            {featuredProjects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="project-topline">
                  <h3>{project.title}</h3>
                  <span className="project-source">{fileLabel(project.sourcePath)}</span>
                </div>
                <p>{project.summary}</p>
                <div className="chip-row">
                  {project.techStack.slice(0, 8).map((tech) => (
                    <span className="chip chip-accent" key={tech}>{tech}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="grid two-up">
          <div className="card-panel">
            <div className="section-heading">
              <h2>Experience</h2>
              <p>Production work that has shaped my current AI engineering approach.</p>
            </div>
            <div className="stack-list">
              {experience.map((item) => (
                <article key={item.company} className="experience-card">
                  <div className="experience-topline">
                    <h3>{item.company}</h3>
                    <span>{item.dateRange || 'Current role'}</span>
                  </div>
                  <ul>
                    {item.items.slice(0, 6).map((work) => (
                      <li key={work}>{work}</li>
                    ))}
                  </ul>
                  {item.highlights.length ? (
                    <p className="experience-note">{item.highlights[0]}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </div>

          <div className="card-panel">
            <div className="section-heading">
              <h2>Tech Stack</h2>
              <p>Core technologies I use to ship AI products and production-ready systems.</p>
            </div>
            <div className="skill-grid">
              {skills.map((skill) => (
                <article key={skill.category} className="skill-card">
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
        </section>

        <section className="card-panel compact-panel">
          <div className="section-heading">
            <h2>Additional Project Areas</h2>
            <p>More topics already present in the indexed portfolio knowledge base.</p>
          </div>
          <div className="chip-row">
            {resumeProjects.map((project) => (
              <span className="chip" key={project}>{project}</span>
            ))}
          </div>
        </section>

        {loading ? <div className="card-panel">Loading portfolio...</div> : null}
        {error ? <div className="card-panel error-box">{error}</div> : null}
      </main>

      <aside className={`admin-panel ${adminOpen ? 'open' : ''}`}>
        <div className="admin-panel-inner">
          <div className="admin-header">
            <div>
              <p className="eyebrow">Admin Controls</p>
              <h2>Portfolio Control Center</h2>
            </div>
            <button className="widget-toggle" onClick={() => setAdminOpen(false)} type="button">
              Close
            </button>
          </div>

          <section className="card-panel admin-card">
            <div className="section-heading">
              <h2>Availability</h2>
              <p>Control the public open-to-work status shown on the portfolio.</p>
            </div>
            <label className="switch-row">
              <span>{openToWork ? 'Open To Work' : 'Not Open To Work'}</span>
              <button
                className={`switch-button ${openToWork ? 'on' : 'off'}`}
                disabled={openToWorkSaving}
                onClick={() => void updateOpenToWork(!openToWork)}
                type="button"
              >
                <span />
              </button>
            </label>
          </section>

          <section className="card-panel admin-card">
            <div className="section-heading">
              <h2>Upload Pipeline</h2>
              <p>Upload and index new files into the knowledge base from here.</p>
            </div>
            <form className="upload-form" onSubmit={handleUpload}>
              <label>
                File
                <input name="file" type="file" accept=".pdf,.docx,.txt,.md,.markdown" required />
              </label>
              <label>
                Logical document key
                <input name="logical_document_key" type="text" placeholder="Carevio" required />
              </label>
              <label>
                Source label
                <input name="source_label" type="text" placeholder="Carevio Deep Dive" />
              </label>
              <label className="checkbox-line">
                <input name="ingest_now" type="checkbox" defaultChecked />
                Index immediately after upload
              </label>
              <button className="primary-button" disabled={uploading} type="submit">
                {uploading ? 'Indexing...' : 'Upload And Index'}
              </button>
              {uploadStatus ? <p className="status-text">{uploadStatus}</p> : null}
            </form>
          </section>

          <section className="card-panel admin-card">
            <div className="section-heading">
              <h2>Knowledge Base</h2>
              <p>Current indexed sources and document status.</p>
            </div>
            <div className="document-list">
              {documents.map((doc) => (
                <article className="document-card" key={doc.logical_document_key}>
                  <div className="document-topline">
                    <h3>{doc.logical_document_key}</h3>
                    <span>{doc.active_version_id ? 'Active' : 'Inactive'}</span>
                  </div>
                  {doc.versions.slice(0, 3).map((version) => (
                    <p key={version.version_id}>
                      {version.file_name} • {version.status} • {version.chunk_count} chunks
                    </p>
                  ))}
                </article>
              ))}
            </div>
          </section>
        </div>
      </aside>

      <div className={`chat-widget ${widgetOpen ? 'open' : ''}`}>
        <button className="widget-toggle" onClick={() => setWidgetOpen((value) => !value)} type="button">
          {widgetOpen ? 'Close Assistant' : 'Open Assistant'}
        </button>
        {widgetOpen ? (
          <div className="widget-panel">
            <div className="widget-header">
              <div>
                <strong>Portfolio Assistant</strong>
                <p>Ask about Raj's experience, projects, or AI systems work.</p>
              </div>
            </div>
            <div className="widget-messages">
              {messages.map((message, index) => (
                <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                  <p>{message.content}</p>
                </div>
              ))}
            </div>
            <div className="widget-input-row">
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void sendMessage()
                  }
                }}
                placeholder="Ask the chatbot..."
                type="text"
              />
              <button className="primary-button" disabled={chatting} onClick={() => void sendMessage()} type="button">
                {chatting ? '...' : 'Send'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default App
