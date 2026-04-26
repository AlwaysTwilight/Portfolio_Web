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

type PortfolioPayload = {
  profile: {
    name?: string
    location?: string
    headline?: string
    about?: string
    eyebrow?: string
    openToWork: boolean
    experience?: ExperienceItem[]
    skills?: SkillCategory[]
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
  current_location?: string
  desired_locations?: string[]
  name?: string
  location?: string
  headline?: string
  about?: string
  eyebrow?: string
  experience?: ExperienceItem[]
  skills?: SkillCategory[]
}

type AdminProject = {
  id: string
  title: string
  summary: string
  techStack: string[]
  whatItDoes?: string[]
  isVisible?: boolean
  sourcePath: string
  sortOrder?: number
  updatedAt?: string
}

type RagDocument = {
  logical_document_key: string
  version_id: string
  file_name: string
  source_label: string
  chunk_count: number
}

const API_BASE_URL      = import.meta.env.VITE_API_BASE_URL      || 'http://localhost:8000'
const PORTFOLIO_ORIGIN  = import.meta.env.VITE_PORTFOLIO_ORIGIN  || 'http://localhost:3000'
const ADMIN_TOKEN_KEY   = 'portfolio_admin_token'

function fileLabel(path: string) {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function experienceToText(items: ExperienceItem[] = []) {
  return items.map(item => [
    item.company,
    item.dateRange || '',
    (item.items || []).join(' | '),
    (item.highlights || []).join(' | '),
  ].join('\n')).join('\n---\n')
}

function textToExperience(value: string): ExperienceItem[] {
  return value.split(/\n-{3,}\n/g).map(block => {
    const [company = '', dateRange = '', items = '', highlights = ''] = block.split('\n')
    return {
      company: company.trim(),
      dateRange: dateRange.trim(),
      items: items.split('|').map(item => item.trim()).filter(Boolean),
      highlights: highlights.split('|').map(item => item.trim()).filter(Boolean),
    }
  }).filter(item => item.company)
}

function skillsToText(items: SkillCategory[] = []) {
  return items.map(item => `${item.category}: ${(item.items || []).join(', ')}`).join('\n')
}

function textToSkills(value: string): SkillCategory[] {
  return value.split('\n').map(line => {
    const [category = '', rest = ''] = line.split(':')
    return {
      category: category.trim(),
      items: rest.split(',').map(item => item.trim()).filter(Boolean),
    }
  }).filter(item => item.category)
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, init)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

function AdminPage() {
  const [portfolio, setPortfolio]   = useState<PortfolioPayload | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [uploading, setUploading]   = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)

  const [openToWorkSaving, setOpenToWorkSaving] = useState(false)
  const [openToWork, setOpenToWork] = useState(true)
  const [currentLocation, setCurrentLocation] = useState('India')
  const [desiredLocations, setDesiredLocations] = useState('')
  const [profileName, setProfileName] = useState('Raj Sahoo')
  const [profileLocation, setProfileLocation] = useState('India')
  const [profileHeadline, setProfileHeadline] = useState('AI/ML Software Developer')
  const [profileEyebrow, setProfileEyebrow] = useState('AI Systems - Production ML - Applied Research')
  const [profileAbout, setProfileAbout] = useState('')
  const [experienceText, setExperienceText] = useState('')
  const [skillsText, setSkillsText] = useState('')
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null)

  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '')

  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError]     = useState<string | null>(null)
  const [projects, setProjects]               = useState<AdminProject[]>([])
  const [ragDocs, setRagDocs]                 = useState<RagDocument[]>([])
  const [ragDocsError, setRagDocsError]       = useState<string | null>(null)

  const [newTitle, setNewTitle]           = useState('')
  const [newSummary, setNewSummary]       = useState('')
  const [newTechStack, setNewTechStack]   = useState('')
  const [newWhatItDoes, setNewWhatItDoes] = useState('')
  const [newIsVisible, setNewIsVisible]   = useState(true)
  const [newSourcePath, setNewSourcePath] = useState('Admin')
  const [newSortOrder, setNewSortOrder]   = useState('0')

  const [createProjectFromUpload, setCreateProjectFromUpload] = useState(true)
  const [uploadProjectId, setUploadProjectId]         = useState('')
  const [uploadProjectTitle, setUploadProjectTitle]   = useState('')
  const [uploadProjectSortOrder, setUploadProjectSortOrder] = useState('0')
  const [uploadProjectSourcePath, setUploadProjectSourcePath] = useState('')

  const [editingId, setEditingId]     = useState<string | null>(null)
  const editingProject = useMemo(() => projects.find(p => p.id === editingId) || null, [editingId, projects])
  const [editTitle, setEditTitle]     = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editTechStack, setEditTechStack]   = useState('')
  const [editWhatItDoes, setEditWhatItDoes] = useState('')
  const [editIsVisible, setEditIsVisible]   = useState(true)
  const [editSourcePath, setEditSourcePath] = useState('')
  const [editSortOrder, setEditSortOrder]   = useState('0')

  function adminHeaders(): HeadersInit {
    return adminToken ? { 'X-Admin-Token': adminToken } : {}
  }

  async function loadPortfolio() {
    try {
      setLoading(true)
      const payload = await fetchJson<PortfolioPayload>('/portfolio')
      setPortfolio(payload)
      setOpenToWork(payload.profile.openToWork)
      setProfileName(payload.profile.name || 'Raj Sahoo')
      setProfileLocation(payload.profile.location || 'India')
      setProfileHeadline(payload.profile.headline || 'AI/ML Software Developer')
      setProfileEyebrow(payload.profile.eyebrow || 'AI Systems - Production ML - Applied Research')
      setProfileAbout(payload.profile.about || '')
      setExperienceText(experienceToText(payload.profile.experience || []))
      setSkillsText(skillsToText(payload.profile.skills || []))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load data.')
    } finally {
      setLoading(false)
    }
  }

  async function loadAdminSettings() {
    try {
      const payload = await fetchJson<AdminSettings>('/admin/settings', { headers: adminHeaders() })
      setOpenToWork(payload.open_to_work)
      setCurrentLocation(payload.current_location || 'India')
      setDesiredLocations((payload.desired_locations || []).join(', '))
      setProfileName(payload.name || 'Raj Sahoo')
      setProfileLocation(payload.location || payload.current_location || 'India')
      setProfileHeadline(payload.headline || 'AI/ML Software Developer')
      setProfileEyebrow(payload.eyebrow || 'AI Systems - Production ML - Applied Research')
      setProfileAbout(payload.about || '')
      setExperienceText(experienceToText(payload.experience || []))
      setSkillsText(skillsToText(payload.skills || []))
    } catch { /* keep usable */ }
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

  async function loadRagDocs() {
    try {
      setRagDocsError(null)
      const payload = await fetchJson<{ documents: RagDocument[] }>('/admin/rag/documents', { headers: adminHeaders() })
      setRagDocs(payload.documents || [])
    } catch (err) {
      setRagDocsError(err instanceof Error ? err.message : 'Could not load indexed documents.')
    }
  }

  useEffect(() => {
    void loadPortfolio()
    void loadAdminSettings()
    void loadProjects()
    void loadRagDocs()
  }, [])

  useEffect(() => {
    if (!editingProject) return
    setEditTitle(editingProject.title)
    setEditSummary(editingProject.summary)
    setEditTechStack(editingProject.techStack.join(', '))
    setEditWhatItDoes((editingProject.whatItDoes || []).join('\n'))
    setEditIsVisible(editingProject.isVisible !== false)
    setEditSourcePath(editingProject.sourcePath)
    setEditSortOrder(String(editingProject.sortOrder ?? 0))
  }, [editingProject])

  function persistToken(value: string) {
    const trimmed = value.trim()
    setAdminToken(trimmed)
    if (!trimmed) { localStorage.removeItem(ADMIN_TOKEN_KEY); return }
    localStorage.setItem(ADMIN_TOKEN_KEY, trimmed)
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const file = formData.get('file') as File | null
    const logicalKey = String(formData.get('logical_document_key') || '').trim()
    const sourceLabel = String(formData.get('source_label') || '').trim()
    const ingestNow = formData.get('ingest_now') === 'on'

    if (!file || !logicalKey) { setUploadStatus('Choose a file and document key first.'); return }

    const payload = new FormData()
    payload.append('file', file)
    payload.append('logical_document_key', logicalKey)
    payload.append('source_label', sourceLabel)
    payload.append('ingest_now', String(ingestNow))
    if (createProjectFromUpload) {
      payload.append('create_project', 'true')
      if (uploadProjectId.trim())      payload.append('project_id', uploadProjectId.trim())
      if (uploadProjectTitle.trim())   payload.append('project_title', uploadProjectTitle.trim())
      payload.append('project_sort_order', String(Number(uploadProjectSortOrder) || 0))
      if (uploadProjectSourcePath.trim()) payload.append('project_source_path', uploadProjectSourcePath.trim())
    }

    try {
      setUploading(true)
      setUploadStatus('Uploading and indexing…')
      const result = await fetchJson<UploadResult>('/upload', { method: 'POST', body: payload, headers: adminHeaders() })
      const projectMsg = result.project_id ? ` · Project: ${result.project_id}` : ''
      setUploadStatus(`Indexed ${result.logical_document_key} · ${result.chunk_count} chunks${projectMsg}`)
      form.reset()
      await loadPortfolio()
      await loadProjects()
      await loadRagDocs()
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function saveSettings(nextOpenToWork?: boolean, overrideLoc?: string, overrideDesired?: string) {
    const otw = nextOpenToWork !== undefined ? nextOpenToWork : openToWork
    const loc = overrideLoc !== undefined ? overrideLoc : currentLocation
    const des = overrideDesired !== undefined ? overrideDesired : desiredLocations
    setOpenToWork(otw)
    setCurrentLocation(loc)
    setDesiredLocations(des)

    try {
      setOpenToWorkSaving(true)
      setSettingsStatus(null)
      const list = des.split(',').map(s => s.trim()).filter(Boolean)
      const result = await fetchJson<AdminSettings>('/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({
          open_to_work: otw,
          current_location: loc,
          desired_locations: list,
          name: profileName,
          location: profileLocation,
          headline: profileHeadline,
          about: profileAbout,
          eyebrow: profileEyebrow,
          experience: textToExperience(experienceText),
          skills: textToSkills(skillsText),
        }),
      })
      setOpenToWork(result.open_to_work)
      setCurrentLocation(result.current_location || 'India')
      setDesiredLocations((result.desired_locations || []).join(', '))
      setProfileName(result.name || profileName)
      setProfileLocation(result.location || profileLocation)
      setProfileHeadline(result.headline || profileHeadline)
      setProfileEyebrow(result.eyebrow || profileEyebrow)
      setProfileAbout(result.about || profileAbout)
      setExperienceText(experienceToText(result.experience || textToExperience(experienceText)))
      setSkillsText(skillsToText(result.skills || textToSkills(skillsText)))
      await loadPortfolio()
      setSettingsStatus('Saved portfolio content.')
    } catch (err) {
      setSettingsStatus(err instanceof Error ? err.message : 'Could not save portfolio content.')
    } finally {
      setOpenToWorkSaving(false)
    }
  }

  function normalizeTechStack(value: string) {
    return value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20)
  }

  async function createProject(event: FormEvent) {
    event.preventDefault()
    try {
      setProjectsError(null)
      await fetchJson('/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ 
          title: newTitle, summary: newSummary, tech_stack: normalizeTechStack(newTechStack), 
          what_it_does: newWhatItDoes.split('\n').filter(Boolean), is_visible: newIsVisible,
          source_path: newSourcePath || 'Admin', sort_order: Number(newSortOrder) || 0 
        }),
      })
      setNewTitle(''); setNewSummary(''); setNewTechStack(''); setNewWhatItDoes(''); setNewIsVisible(true); setNewSourcePath('Admin'); setNewSortOrder('0')
      await loadProjects(); await loadPortfolio()
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
          title: editTitle, summary: editSummary, tech_stack: normalizeTechStack(editTechStack), 
          what_it_does: editWhatItDoes.split('\n').filter(Boolean), is_visible: editIsVisible,
          source_path: editSourcePath || 'Admin', sort_order: Number(editSortOrder) || 0 
        }),
      })
      setEditingId(null)
      await loadProjects(); await loadPortfolio()
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
      await loadProjects(); await loadPortfolio()
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Could not delete project.')
    }
  }

  async function activateDocumentVersion(key: string, versionId: string) {
    if (!confirm('Activate this version in the backend? This will set it as active for chat.')) return
    try {
      await fetchJson(`/admin/documents/${key}/versions/${versionId}/activate`, { method: 'PUT', headers: adminHeaders() })
      await loadPortfolio(); await loadRagDocs()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not activate version.')
    }
  }

  const documents = portfolio?.documents ?? []
  const resumeProjectTargets = useMemo(() => {
    const titles = (portfolio as any)?.profile?.resumeProjects as string[] | undefined
    const safeTitles = Array.isArray(titles) ? titles : []
    const existingIds = new Set(projects.map(p => p.id))
    return safeTitles.map(title => ({ id: slugify(title), title })).filter(item => item.id && !existingIds.has(item.id))
  }, [portfolio, projects])

  const isUploadError = uploadStatus && (uploadStatus.includes('failed') || uploadStatus.includes('Choose'))

  return (
    <div className="admin-page-shell">

      {/* ── Nav ── */}
      <nav className="admin-topnav">
        <div className="admin-nav-inner">
          <span className="admin-nav-title">Control Center</span>
          <a className="admin-back" href={PORTFOLIO_ORIGIN} rel="noreferrer">
            ← Back to portfolio
          </a>
        </div>
      </nav>

      <main className="admin-page">

        {/* ── Page header ── */}
        <div style={{ paddingTop: '1rem', marginBottom: '0.5rem' }}>
          <h1 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 'clamp(1.75rem, 3vw, 2.4rem)', fontWeight: 400, letterSpacing: '-0.025em', color: 'var(--ink)', marginBottom: '0.35rem' }}>
            Admin
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            Manage availability, projects, and the RAG document pipeline.
          </p>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {/* ── Token ── */}
        <div className="admin-card">
          <h2 className="admin-card-title">Admin Token</h2>
          <p className="admin-card-desc">
            If <code style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.82em', background: 'var(--bg)', padding: '0.1em 0.4em', borderRadius: '4px' }}>ADMIN_TOKEN</code> is set on the API, enter the same value here.
          </p>
          <label className="field-label">
            Token
            <input
              className="field-input"
              onChange={e => persistToken(e.target.value)}
              placeholder="X-Admin-Token"
              type="password"
              value={adminToken}
            />
          </label>
        </div>

        {/* ── Availability ── */}
        <div className="admin-card">
          <h2 className="admin-card-title">Availability</h2>
          <p className="admin-card-desc">Controls the profile, experience, skills, and open-to-work status shown publicly.</p>
          <div className="switch-row" style={{ marginBottom: '1rem' }}>
            <span className="switch-label" style={{ color: openToWork ? 'var(--accent)' : 'var(--muted)' }}>
              {openToWork ? 'Open to work' : 'Not open to work'}
            </span>
            <button
              className={`switch-button${openToWork ? ' on' : ''}`}
              disabled={openToWorkSaving}
              onClick={() => void saveSettings(!openToWork)}
              type="button"
            >
              <span />
            </button>
          </div>
          <div className="form-grid">
            <label className="field-label">
              Name
              <input className="field-input" onChange={e => setProfileName(e.target.value)} type="text" value={profileName} />
            </label>
            <label className="field-label">
              Profile Location
              <input className="field-input" onChange={e => setProfileLocation(e.target.value)} type="text" value={profileLocation} />
            </label>
            <label className="field-label">
              Hero eyebrow
              <input className="field-input" onChange={e => setProfileEyebrow(e.target.value)} type="text" value={profileEyebrow} />
            </label>
            <label className="field-label">
              Headline
              <input className="field-input" onChange={e => setProfileHeadline(e.target.value)} type="text" value={profileHeadline} />
            </label>
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>
              About
              <textarea className="field-input" onChange={e => setProfileAbout(e.target.value)} rows={3} value={profileAbout} />
            </label>
            <label className="field-label">
              Current Location
              <input className="field-input" onChange={e => setCurrentLocation(e.target.value)} type="text" value={currentLocation} />
            </label>
            <label className="field-label">
              Desired Locations (comma-separated)
              <input className="field-input" onChange={e => setDesiredLocations(e.target.value)} placeholder="e.g. Remote, San Francisco, New York" type="text" value={desiredLocations} />
            </label>
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>
              Experience
              <textarea className="field-input" onChange={e => setExperienceText(e.target.value)} rows={8} value={experienceText} />
            </label>
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>
              Skills
              <textarea className="field-input" onChange={e => setSkillsText(e.target.value)} rows={5} value={skillsText} />
            </label>
          </div>
          <div className="btn-row" style={{ marginTop: '1rem' }}>
            <button className="btn-admin" disabled={openToWorkSaving} onClick={() => void saveSettings()} type="button">
              Save Portfolio Content
            </button>
          </div>
          {settingsStatus && <p className="status-text" style={{ marginTop: '0.75rem' }}>{settingsStatus}</p>}
        </div>

        {/* ── Projects ── */}
        <div className="admin-card">
          <h2 className="admin-card-title">Projects</h2>
          <p className="admin-card-desc">Add, edit, or remove project cards shown on the public portfolio.</p>

          <form className="form-grid" onSubmit={createProject} style={{ marginBottom: '1.5rem' }}>
            <label className="field-label">
              Title
              <input className="field-input" onChange={e => setNewTitle(e.target.value)} placeholder="Project title" required type="text" value={newTitle} />
            </label>
            <label className="field-label">
              Summary
              <input className="field-input" onChange={e => setNewSummary(e.target.value)} placeholder="What does this project do?" required type="text" value={newSummary} />
            </label>
            <label className="field-label">
              Tech stack (comma-separated)
              <input className="field-input" onChange={e => setNewTechStack(e.target.value)} placeholder="FastAPI, LangGraph, Redis, pgvector" type="text" value={newTechStack} />
            </label>
            <label className="field-label">
              Source label
              <input className="field-input" onChange={e => setNewSourcePath(e.target.value)} placeholder="Admin" type="text" value={newSourcePath} />
            </label>
            <label className="field-label">
              Sort order
              <input className="field-input" onChange={e => setNewSortOrder(e.target.value)} placeholder="0" type="number" value={newSortOrder} style={{ width: '120px' }} />
            </label>
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>
              What it does (one point per line)
              <textarea className="field-input" onChange={e => setNewWhatItDoes(e.target.value)} rows={3} value={newWhatItDoes} />
            </label>
            <label className="checkbox-row" style={{ gridColumn: '1 / -1' }}>
              <input checked={newIsVisible} onChange={e => setNewIsVisible(e.target.checked)} type="checkbox" />
              Visible on portfolio
            </label>
            <div style={{ gridColumn: '1 / -1' }}>
              <button className="btn-admin" type="submit">Add Project</button>
            </div>
          </form>

          {projectsLoading && <p className="status-text">Loading projects…</p>}
          {projectsError && <p style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.78rem', color: 'var(--danger)', marginBottom: '0.75rem' }}>{projectsError}</p>}

          <div className="admin-project-list">
            {projects.map(project => (
              <div className="admin-project-card" key={project.id}>
                <div className="admin-proj-info">
                  <p className="admin-proj-title">
                    {project.title}
                    {project.isVisible === false && <span style={{ fontSize: '0.7em', padding: '0.1em 0.4em', background: 'var(--muted)', color: 'var(--bg)', borderRadius: '4px', marginLeft: '0.5em' }}>Hidden</span>}
                  </p>
                  <p className="admin-proj-summary">{project.summary}</p>
                  {project.techStack.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
                      {project.techStack.slice(0, 6).map(tech => (
                        <span className="chip-accent" key={tech}>{tech}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="btn-row" style={{ flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                  <button className="btn-admin-outline" onClick={() => setEditingId(project.id)} style={{ fontSize: '0.8rem', padding: '0.45rem 0.85rem' }} type="button">
                    Edit
                  </button>
                  <button className="btn-danger" onClick={() => void deleteProject(project.id)} style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem' }} type="button">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {editingProject && (
            <div className="edit-panel">
              <p className="edit-panel-title">Editing: {editingProject.title}</p>
              <div className="form-grid">
                <label className="field-label">
                  Title
                  <input className="field-input" onChange={e => setEditTitle(e.target.value)} type="text" value={editTitle} />
                </label>
                <label className="field-label">
                  Summary
                  <input className="field-input" onChange={e => setEditSummary(e.target.value)} type="text" value={editSummary} />
                </label>
                <label className="field-label">
                  Tech stack (comma-separated)
                  <input className="field-input" onChange={e => setEditTechStack(e.target.value)} type="text" value={editTechStack} />
                </label>
                <label className="field-label">
                  Source label
                  <input className="field-input" onChange={e => setEditSourcePath(e.target.value)} type="text" value={editSourcePath} />
                </label>
                <label className="field-label">
                  Sort order
                  <input className="field-input" onChange={e => setEditSortOrder(e.target.value)} type="number" value={editSortOrder} style={{ width: '120px' }} />
                </label>
                <label className="field-label" style={{ gridColumn: '1 / -1' }}>
                  What it does (one point per line)
                  <textarea className="field-input" onChange={e => setEditWhatItDoes(e.target.value)} rows={3} value={editWhatItDoes} />
                </label>
                <label className="checkbox-row" style={{ gridColumn: '1 / -1' }}>
                  <input checked={editIsVisible} onChange={e => setEditIsVisible(e.target.checked)} type="checkbox" />
                  Visible on portfolio
                </label>
                <div className="btn-row" style={{ gridColumn: '1 / -1' }}>
                  <button className="btn-admin" onClick={() => void saveEdit()} type="button">Save changes</button>
                  <button className="btn-admin-outline" onClick={() => setEditingId(null)} type="button">Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Upload ── */}
        <div className="admin-card">
          <h2 className="admin-card-title">Upload Pipeline</h2>
          <p className="admin-card-desc">Upload and index new files into the RAG knowledge base.</p>
          <form className="form-grid" onSubmit={handleUpload}>
            <label className="field-label">
              File
              <input accept=".pdf,.docx,.txt,.md,.markdown" className="field-input" name="file" required type="file" />
            </label>
            <label className="field-label">
              Logical document key
              <input className="field-input" name="logical_document_key" placeholder="e.g. carevio-rag-deep-dive" required type="text" />
            </label>
            <label className="field-label">
              Source label
              <input className="field-input" name="source_label" placeholder="Carevio Deep Dive" type="text" />
            </label>
            <label className="checkbox-row">
              <input defaultChecked name="ingest_now" type="checkbox" />
              Index immediately after upload
            </label>
            <label className="checkbox-row">
              <input checked={createProjectFromUpload} onChange={e => setCreateProjectFromUpload(e.target.checked)} type="checkbox" />
              Create or update a project card from this upload
            </label>

            {createProjectFromUpload && (
              <>
                <label className="field-label">
                  Project to update (optional)
                  <select className="field-input" onChange={e => setUploadProjectId(e.target.value)} value={uploadProjectId}>
                    <option value="">Create new project</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.title} ({p.id})</option>
                    ))}
                    {resumeProjectTargets.length > 0 && (
                      <>
                        <option disabled value="">── Resume projects ──</option>
                        {resumeProjectTargets.map(p => (
                          <option key={p.id} value={p.id}>{p.title} ({p.id})</option>
                        ))}
                      </>
                    )}
                  </select>
                </label>
                <label className="field-label">
                  Project title override
                  <input className="field-input" onChange={e => setUploadProjectTitle(e.target.value)} placeholder="Leave blank to auto-extract" type="text" value={uploadProjectTitle} />
                </label>
                <label className="field-label">
                  Sort order
                  <input className="field-input" onChange={e => setUploadProjectSortOrder(e.target.value)} style={{ width: '120px' }} type="number" value={uploadProjectSortOrder} />
                </label>
                <label className="field-label">
                  Source label chip
                  <input className="field-input" onChange={e => setUploadProjectSourcePath(e.target.value)} placeholder="Defaults to file name" type="text" value={uploadProjectSourcePath} />
                </label>
              </>
            )}

            <div>
              <button className="btn-admin" disabled={uploading} type="submit">
                {uploading ? 'Indexing…' : 'Upload & Index'}
              </button>
            </div>

            {uploadStatus && (
              <div className={`admin-status${isUploadError ? ' error' : ' success'}`}>
                {uploadStatus}
              </div>
            )}
          </form>
        </div>

        {/* ── Knowledge Base ── */}
        <div className="admin-card">
          <h2 className="admin-card-title">Knowledge Base</h2>
          <p className="admin-card-desc">Indexed sources and their ingestion status.</p>

          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.65rem' }}>
            Active RAG Sources
          </p>
          {ragDocsError && <p style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.75rem', color: 'var(--danger)', marginBottom: '0.75rem' }}>{ragDocsError}</p>}
          {loading && <p className="status-text">Loading…</p>}

          <div className="doc-list" style={{ marginBottom: '1.5rem' }}>
            {ragDocs.slice(0, 12).map(doc => (
              <div className="doc-card" key={`${doc.logical_document_key}:${doc.version_id}`}>
                <div>
                  <p className="doc-key">{doc.logical_document_key}</p>
                  <p style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.7rem', color: 'var(--faint)', marginTop: '0.15rem' }}>
                    {doc.file_name || 'Unknown'} · {doc.version_id.slice(0, 8)}
                    {doc.source_label ? ` · ${doc.source_label}` : ''}
                  </p>
                </div>
                <div className="doc-meta">
                  <span className="doc-badge">{doc.chunk_count} chunks</span>
                </div>
              </div>
            ))}
            {ragDocs.length === 0 && !ragDocsError && (
              <p className="status-text">No active RAG documents found yet.</p>
            )}
          </div>

          {/* Portfolio docs */}
          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.65rem' }}>
            Portfolio Documents
          </p>
          <div className="doc-list">
            {documents.map(doc => (
              <div className="doc-card" key={doc.logical_document_key}>
                <div>
                  <p className="doc-key">{doc.logical_document_key}</p>
                  {doc.versions.slice(0, 2).map(v => (
                    <p key={v.version_id} style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.7rem', color: 'var(--faint)', marginTop: '0.15rem' }}>
                      {v.file_name} · {v.status} · {v.chunk_count} chunks
                    </p>
                  ))}
                </div>
                <div className="doc-meta" style={{ display: 'flex', alignItems: 'center' }}>
                  <span className={`doc-badge${doc.active_version_id ? '' : ' inactive'}`}>
                    {doc.active_version_id ? 'Active' : 'Inactive'}
                  </span>
                  {!doc.active_version_id && doc.versions.length > 0 && (
                    <button className="btn-admin-outline" onClick={() => void activateDocumentVersion(doc.logical_document_key, doc.versions[0].version_id)} style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', marginLeft: '0.5rem' }} type="button">
                      Activate
                    </button>
                  )}
                </div>
              </div>
            ))}
            {documents.length === 0 && !loading && (
              <p className="status-text">No documents indexed yet.</p>
            )}
          </div>
        </div>

      </main>
    </div>
  )
}

export default AdminPage
