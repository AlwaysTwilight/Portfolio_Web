import { FormEvent, useEffect, useMemo, useState } from 'react'

type DocumentSummary = {
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
}

type PortfolioPayload = {
  profile: {
    openToWork: boolean
  }
  documents: DocumentSummary[]
}

type UploadResult = {
  logical_document_key: string
  version_id: string
  status: string
  chunk_count: number
  project_id?: string | null
}

type AdminSettings = {
  open_to_work: boolean
}

type AdminProject = {
  id: string
  title: string
  summary: string
  techStack: string[]
  sourcePath: string
  sortOrder?: number
  updatedAt?: string
}

type ChromaDocument = {
  logical_document_key: string
  version_id: string
  file_name: string
  source_label: string
  chunk_count: number
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001'
const PORTFOLIO_ORIGIN = import.meta.env.VITE_PORTFOLIO_ORIGIN || 'http://localhost:3000'
const ADMIN_TOKEN_STORAGE_KEY = 'portfolio_admin_token'

function fileLabel(path: string) {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init)
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return response.json() as Promise<T>
}

function AdminPage() {
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)

  const [openToWorkSaving, setOpenToWorkSaving] = useState(false)
  const [openToWork, setOpenToWork] = useState(true)

  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '')

  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [chromaDocs, setChromaDocs] = useState<ChromaDocument[]>([])
  const [chromaDocsError, setChromaDocsError] = useState<string | null>(null)

  const [newTitle, setNewTitle] = useState('')
  const [newSummary, setNewSummary] = useState('')
  const [newTechStack, setNewTechStack] = useState('')
  const [newSourcePath, setNewSourcePath] = useState('Admin')
  const [newSortOrder, setNewSortOrder] = useState('0')

  const [createProjectFromUpload, setCreateProjectFromUpload] = useState(true)
  const [uploadProjectId, setUploadProjectId] = useState('')
  const [uploadProjectTitle, setUploadProjectTitle] = useState('')
  const [uploadProjectSortOrder, setUploadProjectSortOrder] = useState('0')
  const [uploadProjectSourcePath, setUploadProjectSourcePath] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const editingProject = useMemo(() => projects.find((p) => p.id === editingId) || null, [editingId, projects])
  const [editTitle, setEditTitle] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editTechStack, setEditTechStack] = useState('')
  const [editSourcePath, setEditSourcePath] = useState('')
  const [editSortOrder, setEditSortOrder] = useState('0')

  function adminHeaders(): HeadersInit {
    return adminToken ? { 'X-Admin-Token': adminToken } : {}
  }

  async function loadPortfolio() {
    try {
      setLoading(true)
      const payload = await fetchJson<PortfolioPayload>('/portfolio')
      setPortfolio(payload)
      setOpenToWork(payload.profile.openToWork)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load admin data.')
    } finally {
      setLoading(false)
    }
  }

  async function loadAdminSettings() {
    try {
      const payload = await fetchJson<AdminSettings>('/admin/settings', { headers: adminHeaders() })
      setOpenToWork(payload.open_to_work)
    } catch {
      // keep page usable
    }
  }

  async function loadProjects() {
    try {
      setProjectsLoading(true)
      setProjectsError(null)
      const payload = await fetchJson<{ projects: AdminProject[] }>('/admin/projects', { headers: adminHeaders() })
      setProjects(payload.projects || [])
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Could not load projects.')
    } finally {
      setProjectsLoading(false)
    }
  }

  async function loadChromaDocs() {
    try {
      setChromaDocsError(null)
      const payload = await fetchJson<{ documents: ChromaDocument[] }>('/admin/chroma/documents', { headers: adminHeaders() })
      setChromaDocs(payload.documents || [])
    } catch (err) {
      setChromaDocsError(err instanceof Error ? err.message : 'Could not load Chroma documents.')
    }
  }

  useEffect(() => {
    void loadPortfolio()
    void loadAdminSettings()
    void loadProjects()
    void loadChromaDocs()
  }, [])

  useEffect(() => {
    if (!editingProject) return
    setEditTitle(editingProject.title)
    setEditSummary(editingProject.summary)
    setEditTechStack(editingProject.techStack.join(', '))
    setEditSourcePath(editingProject.sourcePath)
    setEditSortOrder(String(editingProject.sortOrder ?? 0))
  }, [editingProject])

  function persistToken(value: string) {
    const trimmed = value.trim()
    setAdminToken(trimmed)
    if (!trimmed) {
      localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
      return
    }
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmed)
  }

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
    if (createProjectFromUpload) {
      payload.append('create_project', 'true')
      if (uploadProjectId.trim()) payload.append('project_id', uploadProjectId.trim())
      if (uploadProjectTitle.trim()) payload.append('project_title', uploadProjectTitle.trim())
      payload.append('project_sort_order', String(Number(uploadProjectSortOrder) || 0))
      if (uploadProjectSourcePath.trim()) payload.append('project_source_path', uploadProjectSourcePath.trim())
    }

    try {
      setUploading(true)
      setUploadStatus('Uploading and indexing...')
      const result = await fetchJson<UploadResult>('/upload', { method: 'POST', body: payload, headers: adminHeaders() })
      const projectMsg = result.project_id ? ` | Project card: ${result.project_id}` : ''
      setUploadStatus(`Indexed ${result.logical_document_key} | ${result.chunk_count} chunks.${projectMsg}`)
      form.reset()
      await loadPortfolio()
      await loadProjects()
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
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
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

  function normalizeTechStack(value: string) {
    return value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20)
  }

  async function createProject(event: FormEvent) {
    event.preventDefault()
    try {
      setProjectsError(null)
      await fetchJson('/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({
          title: newTitle,
          summary: newSummary,
          tech_stack: normalizeTechStack(newTechStack),
          source_path: newSourcePath || 'Admin',
          sort_order: Number(newSortOrder) || 0,
        }),
      })
      setNewTitle('')
      setNewSummary('')
      setNewTechStack('')
      setNewSourcePath('Admin')
      setNewSortOrder('0')
      await loadProjects()
      await loadPortfolio()
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Could not create project.')
    }
  }

  async function saveEdit() {
    if (!editingId) return
    try {
      setProjectsError(null)
      await fetchJson(`/admin/projects/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({
          title: editTitle,
          summary: editSummary,
          tech_stack: normalizeTechStack(editTechStack),
          source_path: editSourcePath || 'Admin',
          sort_order: Number(editSortOrder) || 0,
        }),
      })
      setEditingId(null)
      await loadProjects()
      await loadPortfolio()
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Could not update project.')
    }
  }

  async function deleteProject(projectId: string) {
    if (!confirm('Delete this project?')) return
    try {
      setProjectsError(null)
      await fetchJson(`/admin/projects/${projectId}`, { method: 'DELETE', headers: adminHeaders() })
      if (editingId === projectId) setEditingId(null)
      await loadProjects()
      await loadPortfolio()
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Could not delete project.')
    }
  }

  const documents = portfolio?.documents ?? []
  const resumeProjectTargets = useMemo(() => {
    const titles = (portfolio as any)?.profile?.resumeProjects as string[] | undefined
    const safeTitles = Array.isArray(titles) ? titles : []
    const existingIds = new Set(projects.map((p) => p.id))
    return safeTitles
      .map((title) => ({ id: slugify(title), title }))
      .filter((item) => item.id && !existingIds.has(item.id))
  }, [portfolio, projects])

  return (
    <div className="page-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <a className="admin-toggle back-link" href={PORTFOLIO_ORIGIN} rel="noreferrer">
        Back to portfolio
      </a>

      <main className="page" style={{ maxWidth: '760px' }}>

        {/* Header */}
        <section className="card-panel">
          <p className="eyebrow">Admin Controls</p>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 'clamp(2rem, 4vw, 3.2rem)', lineHeight: 1, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
            Control Center
          </h1>
          <p className="about-copy">
            Manage availability, projects, and the RAG document pipeline. Changes reflect on the public portfolio immediately.
          </p>
        </section>

        {/* Auth token */}
        <section className="card-panel admin-card">
          <div className="section-heading">
            <h2>Admin Token</h2>
            <p>If you set <code style={{ fontFamily: 'inherit', background: 'var(--surface)', padding: '0.1em 0.4em', borderRadius: '4px', fontSize: '0.85em' }}>ADMIN_TOKEN</code> on the API, enter it here to authenticate requests.</p>
          </div>
          <label>
            Token
            <input
              onChange={(e) => persistToken(e.target.value)}
              placeholder="X-Admin-Token"
              type="password"
              value={adminToken}
            />
          </label>
        </section>

        {/* Availability */}
        <section className="card-panel admin-card">
          <div className="section-heading">
            <h2>Availability</h2>
            <p>Controls the open-to-work badge shown on the public portfolio page.</p>
          </div>
          <label className="switch-row">
            <span style={{ color: openToWork ? 'var(--accent)' : 'var(--muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.88rem' }}>
              {openToWork ? 'Open To Work' : 'Not Open To Work'}
            </span>
            <button
              className={`switch-button ${openToWork ? 'on' : ''}`}
              disabled={openToWorkSaving}
              onClick={() => void updateOpenToWork(!openToWork)}
              type="button"
            >
              <span />
            </button>
          </label>
        </section>

        {/* Projects */}
        <section className="card-panel admin-card">
          <div className="section-heading">
            <h2>Projects</h2>
            <p>Add or edit project cards shown on the portfolio.</p>
          </div>

          <form className="upload-form" onSubmit={createProject}>
            <label>
              Title
              <input onChange={(e) => setNewTitle(e.target.value)} placeholder="Project title" required type="text" value={newTitle} />
            </label>
            <label>
              Summary
              <input onChange={(e) => setNewSummary(e.target.value)} placeholder="What does this project do?" required type="text" value={newSummary} />
            </label>
            <label>
              Tech stack (comma separated)
              <input onChange={(e) => setNewTechStack(e.target.value)} placeholder="FastAPI, LangGraph, Redis, pgvector" type="text" value={newTechStack} />
            </label>
            <label>
              Source label
              <input onChange={(e) => setNewSourcePath(e.target.value)} placeholder="Admin" type="text" value={newSourcePath} />
            </label>
            <label>
              Sort order
              <input onChange={(e) => setNewSortOrder(e.target.value)} placeholder="0" type="number" value={newSortOrder} />
            </label>
            <button className="primary-button" type="submit">Add Project</button>
          </form>

          {projectsLoading && <p className="status-text" style={{ marginTop: '1rem' }}>Loading projects...</p>}
          {projectsError && <p className="status-text" style={{ marginTop: '1rem', color: 'var(--danger)' }}>{projectsError}</p>}

          <div className="project-grid" style={{ marginTop: '1.25rem' }}>
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="project-topline">
                  <h3>{project.title}</h3>
                  <span className="project-source">{fileLabel(project.sourcePath)}</span>
                </div>
                <p>{project.summary}</p>
                {project.techStack.length > 0 && (
                  <div className="chip-row">
                    {project.techStack.slice(0, 8).map((tech) => (
                      <span className="chip chip-accent" key={tech}>{tech}</span>
                    ))}
                  </div>
                )}
                <div className="chip-row" style={{ marginTop: '0.9rem', gap: '0.5rem' }}>
                  <button
                    className="primary-button"
                    onClick={() => setEditingId(project.id)}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void deleteProject(project.id)}
                    style={{
                      border: '1px solid rgba(255,92,92,0.25)',
                      borderRadius: '8px',
                      padding: '0.5rem 1rem',
                      background: 'rgba(255,92,92,0.06)',
                      color: 'var(--danger)',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>

          {editingProject && (
            <div className="card-panel" style={{ marginTop: '1.25rem' }}>
              <div className="section-heading">
                <h2>Edit Project</h2>
                <p>Update title, summary, and tech stack for <em>{editingProject.title}</em>.</p>
              </div>
              <div className="upload-form">
                <label>
                  Title
                  <input onChange={(e) => setEditTitle(e.target.value)} type="text" value={editTitle} />
                </label>
                <label>
                  Summary
                  <input onChange={(e) => setEditSummary(e.target.value)} type="text" value={editSummary} />
                </label>
                <label>
                  Tech stack (comma separated)
                  <input onChange={(e) => setEditTechStack(e.target.value)} type="text" value={editTechStack} />
                </label>
                <label>
                  Source label
                  <input onChange={(e) => setEditSourcePath(e.target.value)} type="text" value={editSourcePath} />
                </label>
                <label>
                  Sort order
                  <input onChange={(e) => setEditSortOrder(e.target.value)} type="number" value={editSortOrder} />
                </label>
                <div style={{ display: 'flex', gap: '0.65rem' }}>
                  <button className="primary-button" onClick={() => void saveEdit()} type="button">Save</button>
                  <button
                    onClick={() => setEditingId(null)}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      padding: '0.75rem 1.25rem',
                      background: 'transparent',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Upload pipeline */}
        <section className="card-panel admin-card">
          <div className="section-heading">
            <h2>Upload Pipeline</h2>
            <p>Upload and index new files into the RAG knowledge base.</p>
          </div>
          <form className="upload-form" onSubmit={handleUpload}>
            <label>
              File
              <input accept=".pdf,.docx,.txt,.md,.markdown" name="file" required type="file" />
            </label>
            <label>
              Logical document key
              <input name="logical_document_key" placeholder="e.g. carevio-rag-deep-dive" required type="text" />
            </label>
            <label>
              Source label
              <input name="source_label" placeholder="Carevio Deep Dive" type="text" />
            </label>
            <label className="checkbox-line">
              <input defaultChecked name="ingest_now" type="checkbox" />
              Index immediately after upload
            </label>
            <label className="checkbox-line">
              <input
                checked={createProjectFromUpload}
                onChange={(e) => setCreateProjectFromUpload(e.target.checked)}
                type="checkbox"
              />
              Create or update a project card from this upload
            </label>
            {createProjectFromUpload && (
              <>
                <label>
                  Project to update (optional)
                  <select onChange={(e) => setUploadProjectId(e.target.value)} value={uploadProjectId}>
                    <option value="">Create new project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.title} ({p.id})</option>
                    ))}
                    {resumeProjectTargets.length ? (
                      <>
                        <option disabled value="__resume__">Resume projects</option>
                        {resumeProjectTargets.map((p) => (
                          <option key={p.id} value={p.id}>{p.title} ({p.id})</option>
                        ))}
                      </>
                    ) : null}
                  </select>
                </label>
                <label>
                  Project title override
                  <input onChange={(e) => setUploadProjectTitle(e.target.value)} placeholder="Leave blank to auto-extract" type="text" value={uploadProjectTitle} />
                </label>
                <label>
                  Sort order
                  <input onChange={(e) => setUploadProjectSortOrder(e.target.value)} type="number" value={uploadProjectSortOrder} />
                </label>
                <label>
                  Source label chip
                  <input onChange={(e) => setUploadProjectSourcePath(e.target.value)} placeholder="Defaults to file name" type="text" value={uploadProjectSourcePath} />
                </label>
              </>
            )}
            <button className="primary-button" disabled={uploading} type="submit">
              {uploading ? 'Indexing...' : 'Upload & Index'}
            </button>
            {uploadStatus && (
              <p className="status-text" style={{ color: uploadStatus.includes('failed') || uploadStatus.includes('Choose') ? 'var(--danger)' : 'var(--accent)' }}>
                {uploadStatus}
              </p>
            )}
          </form>
        </section>

        {/* Knowledge base */}
        <section className="card-panel admin-card">
          <div className="section-heading">
            <h2>Knowledge Base</h2>
            <p>All indexed sources and their current ingestion status.</p>
          </div>
          {loading && <p className="status-text">Loading...</p>}
          {error && <p className="status-text" style={{ color: 'var(--danger)' }}>{error}</p>}
          <div className="card-panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <div className="section-heading" style={{ marginBottom: '0.6rem' }}>
              <h2 style={{ fontSize: '1.1rem' }}>Chroma Active Documents</h2>
              <p>Direct view from Chroma (active chunks), independent of Mongo/SQLite metadata.</p>
            </div>
            {chromaDocsError ? <p className="status-text" style={{ color: 'var(--danger)' }}>{chromaDocsError}</p> : null}
            {chromaDocs.length ? (
              <div className="document-list">
                {chromaDocs.slice(0, 12).map((doc) => (
                  <article className="document-card" key={`${doc.logical_document_key}:${doc.version_id}`}>
                    <div className="document-topline">
                      <h3>{doc.logical_document_key}</h3>
                      <span>{doc.chunk_count} chunks</span>
                    </div>
                    <p>{doc.file_name || 'Unknown file'} | {doc.version_id}</p>
                    {doc.source_label ? <p>Source: {doc.source_label}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="status-text">No active Chroma documents found yet.</p>
            )}
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
                    {version.file_name} | {version.status} | {version.chunk_count} chunks
                  </p>
                ))}
              </article>
            ))}
          </div>
        </section>

      </main>
    </div>
  )
}

export default AdminPage
