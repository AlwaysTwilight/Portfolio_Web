import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'

/* ──────────────────────────────────────────────
   Types
────────────────────────────────────────────── */
type ExperienceItem = {
  company: string
  role?: string
  dateRange?: string
  summary?: string
  items: string[]
  highlights: string[]
}

type SkillCategory = { category: string; items: string[] }

type DocumentSummary = {
  logical_document_key: string
  active_version_id?: string | null
  updated_at?: string | null
  versions: Array<{ version_id: string; file_name: string; status: string; is_active: boolean; chunk_count: number }>
}

type PortfolioPayload = {
  profile: {
    openToWork: boolean
    name?: string
    location?: string
    headline?: string
    about?: string
    eyebrow?: string
    currentLocation?: string
    desiredLocations?: string[]
    experience?: ExperienceItem[]
    skills?: SkillCategory[]
  }
  projects?: AdminProject[]
  documents?: DocumentSummary[]
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
  isReadOnly?: boolean
  sourcePath: string
  sortOrder?: number
}

type RagDocument = {
  logical_document_key: string
  version_id: string
  file_name: string
  source_label: string
  chunk_count: number
}

type UploadResult = {
  logical_document_key: string
  version_id: string
  status: string
  chunk_count: number
  project_id?: string | null
}

type ContactMessage = {
  message_id: string
  name: string
  email: string
  message: string
  source: string
  is_read: boolean
  created_at: string
}

type Scheduling = {
  calLink: string
  enabled: boolean
  headline: string
  subtext: string
}

type SiteSection = {
  id: string
  label: string
  visible: boolean
}

type SectionId = 'overview' | 'profile' | 'experience' | 'skills' | 'projects' | 'documents' | 'social' | 'messages' | 'scheduling' | 'sections'

const API_BASE_URL     = import.meta.env.VITE_API_BASE_URL     || 'http://localhost:8000'
const PORTFOLIO_ORIGIN = import.meta.env.VITE_PORTFOLIO_ORIGIN || 'http://localhost:3000'
const ADMIN_TOKEN_KEY  = 'portfolio_admin_token'

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function splitList(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean)
}
function splitLines(value: string): string[] {
  return value.split('\n').map(s => s.trim()).filter(Boolean)
}

/* ──────────────────────────────────────────────
   Icons
────────────────────────────────────────────── */
function Icon({ path, size = 18 }: { path: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}

const ICONS: Record<SectionId, string> = {
  overview:   'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  profile:    'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  experience: 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2',
  skills:     'M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6L5.7 21 8 14 2 9.4h7.6z',
  projects:   'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  documents:  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  social:     'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z M2 9h4v12H2z M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  messages:   'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  scheduling: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  sections:   'M4 5h16M4 12h16M4 19h16M8 5v14',
}

const SPARKLE = 'M12 3l1.6 4.9L18.5 9l-4.9 1.6L12 15.5l-1.6-4.9L5.5 9l4.9-1.1L12 3z'

/* ──────────────────────────────────────────────
   API client
────────────────────────────────────────────── */
function makeApi(getToken: () => string) {
  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const token = getToken()
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) }
    if (token) headers['X-Admin-Token'] = token
    const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
    if (!res.ok) throw new Error(await res.text())
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }
  return api
}

function AdminPage() {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '')
  const api = useMemo(() => makeApi(() => adminToken), [adminToken])

  const [section, setSection]     = useState<SectionId>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theme, setTheme]         = useState<'light' | 'dark'>(() =>
    (localStorage.getItem('theme') as 'light' | 'dark') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))

  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [toast, setToast]         = useState<string | null>(null)

  const [openToWork, setOpenToWork]             = useState(true)
  const [name, setName]                         = useState('Raj Sahoo')
  const [headline, setHeadline]                 = useState('AI/ML Software Developer')
  const [eyebrow, setEyebrow]                   = useState('AI Systems - Production ML - Applied Research')
  const [about, setAbout]                       = useState('')
  const [location, setLocation]                 = useState('India')
  const [currentLocation, setCurrentLocation]   = useState('India')
  const [desiredLocations, setDesiredLocations] = useState('')

  const [experience, setExperience] = useState<ExperienceItem[]>([])
  const [skills, setSkills]         = useState<SkillCategory[]>([])
  const [projects, setProjects]     = useState<AdminProject[]>([])
  const [documents, setDocuments]   = useState<DocumentSummary[]>([])
  const [ragDocs, setRagDocs]       = useState<RagDocument[]>([])
  const [socialLinkedin, setSocialLinkedin] = useState('')
  const [socialGithub,   setSocialGithub]   = useState('')
  const [socialEmail,    setSocialEmail]    = useState('')
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>([])
  const [scheduling, setScheduling] = useState<Scheduling>({ calLink: '', enabled: false, headline: "Let's talk", subtext: '' })
  const [siteSections, setSiteSections] = useState<SiteSection[]>([])
  const bcRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  function flash(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 3200)
  }

  function notifyPortfolio() {
    bcRef.current?.postMessage({ type: 'data-updated' })
  }

  function persistToken(value: string) {
    const trimmed = value.trim()
    setAdminToken(trimmed)
    if (trimmed) localStorage.setItem(ADMIN_TOKEN_KEY, trimmed)
    else localStorage.removeItem(ADMIN_TOKEN_KEY)
  }

  async function loadAll() {
    setLoading(true)
    try {
      const [settings, pfPayload] = await Promise.all([
        api<AdminSettings>('/admin/settings'),
        fetch(`${API_BASE_URL}/portfolio`).then(r => r.json()).catch(() => null) as Promise<PortfolioPayload | null>,
      ])
      const pf = pfPayload?.profile
      setOpenToWork(settings.open_to_work)
      setName(settings.name || pf?.name || 'Raj Sahoo')
      setHeadline(settings.headline || pf?.headline || 'AI/ML Software Developer')
      setEyebrow(settings.eyebrow || pf?.eyebrow || 'AI Systems - Production ML - Applied Research')
      setAbout(settings.about || pf?.about || '')
      setLocation(settings.location || settings.current_location || pf?.location || 'India')
      setCurrentLocation(settings.current_location || pf?.currentLocation || 'India')
      setDesiredLocations((settings.desired_locations?.length ? settings.desired_locations : (pf?.desiredLocations || [])).join(', '))
      setExperience(settings.experience?.length ? settings.experience : (pf?.experience || []))
      setSkills(settings.skills?.length ? settings.skills : (pf?.skills || []))
      setDocuments(pfPayload?.documents || [])
      // Load social links
      try {
        const sl = await api<{ linkedin?: string; github?: string; email?: string }>('/admin/social-links')
        setSocialLinkedin(sl.linkedin || '')
        setSocialGithub(sl.github || '')
        setSocialEmail(sl.email || '')
      } catch { /* keep defaults */ }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load admin settings.')
    } finally {
      setLoading(false)
    }
    void loadProjects()
    void loadRagDocs()
    void loadMessages()
    void loadScheduling()
    void loadSections()
  }

  async function loadProjects() {
    try {
      const [pfPayload, adminRes] = await Promise.all([
        fetch(`${API_BASE_URL}/portfolio`).then(r => r.json()).catch(() => ({ projects: [] })) as Promise<PortfolioPayload>,
        api<{ projects: AdminProject[] }>('/admin/projects').catch(() => ({ projects: [] })),
      ])
      const adminProjects: AdminProject[] = adminRes.projects || []
      const adminIds = new Set(adminProjects.map(p => p.id))
      const seedProjects = (pfPayload?.projects || [])
        .filter(p => !adminIds.has(p.id))
        .map(p => ({ ...p, isReadOnly: true }))
      setProjects([...adminProjects, ...seedProjects])
    } catch { /* keep usable */ }
  }

  async function loadRagDocs() {
    try { setRagDocs((await api<{ documents: RagDocument[] }>('/admin/rag/documents')).documents || []) }
    catch { /* keep usable */ }
  }

  async function loadMessages() {
    try { setContactMessages((await api<{ messages: ContactMessage[] }>('/admin/messages')).messages || []) }
    catch { /* keep usable */ }
  }

  async function loadScheduling() {
    try {
      const s = await api<Scheduling>('/admin/scheduling')
      setScheduling({
        calLink: s.calLink || '',
        enabled: Boolean(s.enabled),
        headline: s.headline || "Let's talk",
        subtext: s.subtext || '',
      })
    } catch { /* keep defaults */ }
  }

  async function loadSections() {
    try { setSiteSections((await api<{ sections: SiteSection[] }>('/admin/sections')).sections || []) }
    catch { /* keep usable */ }
  }

  useEffect(() => { void loadAll() }, [])

  // BroadcastChannel — notify portfolio page after every admin save
  useEffect(() => {
    bcRef.current = new BroadcastChannel('portfolio-updates')
    return () => { bcRef.current?.close() }
  }, [])

  async function persistSettings(overrides?: Partial<{
    openToWork: boolean; experience: ExperienceItem[]; skills: SkillCategory[]
  }>) {
    const payload = {
      open_to_work: overrides?.openToWork ?? openToWork,
      current_location: currentLocation,
      desired_locations: splitList(desiredLocations),
      name, location, headline, about, eyebrow,
      experience: overrides?.experience ?? experience,
      skills: overrides?.skills ?? skills,
    }
    const result = await api<AdminSettings>('/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setOpenToWork(result.open_to_work)
    setExperience(result.experience || payload.experience)
    setSkills(result.skills || payload.skills)
    notifyPortfolio()
  }

  async function aiRewrite(kind: string, fields: Record<string, unknown>, notes: string): Promise<any> {
    const res = await api<{ draft: any; provider: string }>('/admin/ai/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, fields, notes }),
    })
    return res.draft
  }

  const navItems: Array<{ id: SectionId; label: string }> = [
    { id: 'overview',   label: 'Overview' },
    { id: 'profile',    label: 'Profile' },
    { id: 'experience', label: 'Experience' },
    { id: 'skills',     label: 'Skills' },
    { id: 'projects',   label: 'Projects' },
    { id: 'documents',  label: 'Documents' },
    { id: 'messages',   label: 'Messages' },
    { id: 'scheduling', label: 'Scheduling' },
    { id: 'sections',   label: 'Sections' },
    { id: 'social',     label: 'Social Links' },
  ]

  return (
    <div className="cms-shell">

      {/* ── Sidebar ── */}
      <aside className={`cms-sidebar${sidebarOpen ? ' open' : ''}`}>
        {/* Gradient brand header */}
        <div className="cms-brand">
          <div className="cms-brand-icon">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.6 4.9L18.5 9l-4.9 1.6L12 15.5l-1.6-4.9L5.5 9l4.9-1.1L12 3z"/>
            </svg>
          </div>
          <div>
            <div className="cms-brand-name">
              {name || 'Portfolio'} <em>cms</em>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.6)', fontFamily: "'DM Mono', monospace", letterSpacing: '0.06em' }}>
              Admin Panel
            </div>
          </div>
        </div>

        <nav className="cms-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`cms-nav-item${section === item.id ? ' active' : ''}`}
              onClick={() => { setSection(item.id); setSidebarOpen(false) }}
              type="button"
            >
              <Icon path={ICONS[item.id]} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="cms-sidebar-foot">
          <a className="cms-view-site" href={PORTFOLIO_ORIGIN} rel="noreferrer" target="_blank">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
            </svg>
            View live site
          </a>
        </div>
      </aside>

      {sidebarOpen && <div className="cms-scrim" onClick={() => setSidebarOpen(false)} />}

      {/* ── Main column ── */}
      <div className="cms-main">
        <header className="cms-topbar">
          <button className="cms-burger" onClick={() => setSidebarOpen(o => !o)} type="button" aria-label="Toggle menu">
            <Icon path="M3 12h18 M3 6h18 M3 18h18" />
          </button>
          <div className="cms-topbar-title">{navItems.find(n => n.id === section)?.label}</div>
          <div className="cms-topbar-actions">
            <span className={`cms-status-chip${openToWork ? ' on' : ''}`}>
              <span className="cms-status-dot" />
              {openToWork ? 'Open to work' : 'Not looking'}
            </span>
            <button
              className="cms-icon-btn"
              onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
              type="button"
              aria-label="Toggle theme"
            >
              <Icon path={theme === 'light'
                ? 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'
                : 'M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'}
              />
            </button>
          </div>
        </header>

        <main className="cms-content">
          {error && <div className="error-banner" role="alert">{error}</div>}
          {!adminToken && (
            <div className="cms-callout">
              No admin token set. If <code>ADMIN_TOKEN</code> is configured on the API, add it under Overview → Access to enable saving.
            </div>
          )}
          {loading && <p className="status-text">Loading…</p>}

          {section === 'overview' && (
            <OverviewSection
              openToWork={openToWork}
              counts={{ experience: experience.length, skills: skills.length, projects: projects.length, documents: ragDocs.length }}
              adminToken={adminToken}
              onToken={persistToken}
              onToggleOpenToWork={async (next) => {
                try { await persistSettings({ openToWork: next }); flash(next ? 'Marked as open to work.' : 'Marked as not looking.') }
                catch (e) { flash(e instanceof Error ? e.message : 'Save failed.') }
              }}
              onGoto={setSection}
            />
          )}

          {section === 'profile' && (
            <ProfileSection
              values={{ name, headline, eyebrow, about, location, currentLocation, desiredLocations }}
              set={{ setName, setHeadline, setEyebrow, setAbout, setLocation, setCurrentLocation, setDesiredLocations }}
              openToWork={openToWork}
              onToggleOpenToWork={async (next) => {
                try { await persistSettings({ openToWork: next }); flash(next ? 'Marked as open to work.' : 'Marked as not looking.') }
                catch (e) { flash(e instanceof Error ? e.message : 'Save failed.') }
              }}
              onPolishAbout={async (notes) => (await aiRewrite('about', {}, notes)).text || ''}
              onSave={async () => { await persistSettings(); flash('Profile saved.') }}
              onError={(m) => flash(m)}
            />
          )}

          {section === 'experience' && (
            <ExperienceSection
              items={experience}
              aiRewrite={(fields, notes) => aiRewrite('experience', fields, notes)}
              onSaveAll={async (next) => { await persistSettings({ experience: next }); flash('Experience updated.') }}
              onError={(m) => flash(m)}
            />
          )}

          {section === 'skills' && (
            <SkillsSection
              categories={skills}
              aiOrganize={(notes) => aiRewrite('skills', {}, notes)}
              onSaveAll={async (next) => { await persistSettings({ skills: next }); flash('Skills updated.') }}
              onError={(m) => flash(m)}
            />
          )}

          {section === 'projects' && (
            <ProjectsSection
              projects={projects}
              api={api}
              aiRewrite={(fields, notes) => aiRewrite('project', fields, notes)}
              reload={async () => { await loadProjects() }}
              onError={(m) => flash(m)}
              notifyPortfolio={notifyPortfolio}
            />
          )}

          {section === 'documents' && (
            <DocumentsSection
              api={api}
              documents={documents}
              ragDocs={ragDocs}
              projects={projects}
              reload={async () => { await loadAll() }}
              onError={(m) => flash(m)}
            />
          )}

          {section === 'social' && (
            <SocialLinksSection
              linkedin={socialLinkedin}
              github={socialGithub}
              email={socialEmail}
              setLinkedin={setSocialLinkedin}
              setGithub={setSocialGithub}
              setEmail={setSocialEmail}
              onSave={async () => {
                await api('/admin/social-links', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ linkedin: socialLinkedin, github: socialGithub, email: socialEmail }),
                })
                notifyPortfolio()
                flash('Social links saved.')
              }}
              onError={(m) => flash(m)}
            />
          )}

          {section === 'messages' && (
            <MessagesSection
              messages={contactMessages}
              onMarkRead={async (id) => {
                try { await api(`/admin/messages/${id}/read`, { method: 'PUT' }); await loadMessages() }
                catch (e) { flash(e instanceof Error ? e.message : 'Failed.') }
              }}
              onDelete={async (id) => {
                if (!confirm('Delete this message?')) return
                try { await api(`/admin/messages/${id}`, { method: 'DELETE' }); await loadMessages() }
                catch (e) { flash(e instanceof Error ? e.message : 'Delete failed.') }
              }}
            />
          )}

          {section === 'scheduling' && (
            <SchedulingSection
              value={scheduling}
              setValue={setScheduling}
              onSave={async () => {
                const saved = await api<Scheduling>('/admin/scheduling', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(scheduling),
                })
                setScheduling(saved)
                notifyPortfolio()
                flash('Scheduling saved.')
              }}
              onError={(m) => flash(m)}
            />
          )}

          {section === 'sections' && (
            <SectionsSection
              sections={siteSections}
              setSections={setSiteSections}
              onSave={async () => {
                const saved = await api<{ sections: SiteSection[] }>('/admin/sections', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sections: siteSections }),
                })
                setSiteSections(saved.sections || siteSections)
                notifyPortfolio()
                flash('Sections updated.')
              }}
              onError={(m) => flash(m)}
            />
          )}
        </main>
      </div>

      {toast && <div className="cms-toast">{toast}</div>}
    </div>
  )
}

/* ══════════════════════════════════════════════
   Overview
══════════════════════════════════════════════ */
const STAT_ICONS: Record<string, string> = {
  experience: 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2',
  skills:     'M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6L5.7 21 8 14 2 9.4h7.6z',
  projects:   'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  documents:  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
}

function OverviewSection(props: {
  openToWork: boolean
  counts: { experience: number; skills: number; projects: number; documents: number }
  adminToken: string
  onToken: (v: string) => void
  onToggleOpenToWork: (next: boolean) => void
  onGoto: (s: SectionId) => void
}) {
  const cards: Array<{ id: SectionId; label: string; value: number }> = [
    { id: 'experience', label: 'Experience',   value: props.counts.experience },
    { id: 'skills',     label: 'Skill groups', value: props.counts.skills },
    { id: 'projects',   label: 'Projects',     value: props.counts.projects },
    { id: 'documents',  label: 'Indexed docs', value: props.counts.documents },
  ]
  return (
    <>
      <SectionHead title="Overview" sub="Snapshot of your portfolio content and availability." />

      <div className="cms-stat-grid">
        {cards.map(c => (
          <button className="cms-stat" key={c.id} onClick={() => props.onGoto(c.id)} type="button">
            <div style={{ color: 'var(--muted)', marginBottom: '0.4rem' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={STAT_ICONS[c.id]} />
              </svg>
            </div>
            <span className="cms-stat-value">{c.value}</span>
            <span className="cms-stat-label">{c.label}</span>
          </button>
        ))}
      </div>

      <div className="cms-card">
        <div className="cms-card-head">
          <div>
            <h3 className="cms-card-title">Availability</h3>
            <p className="cms-card-desc">Shows the "Open to work" badge across the public site.</p>
          </div>
          <button
            className={`switch-button${props.openToWork ? ' on' : ''}`}
            onClick={() => props.onToggleOpenToWork(!props.openToWork)}
            type="button"
          >
            <span />
          </button>
        </div>
      </div>

      <div className="cms-card">
        <h3 className="cms-card-title">Access</h3>
        <p className="cms-card-desc" style={{ marginBottom: '1rem' }}>
          If <code>ADMIN_TOKEN</code> is set on the API, enter the same value to authorize edits. Stored only in this browser.
        </p>
        <label className="field-label">
          Admin token
          <input
            className="field-input"
            onChange={e => props.onToken(e.target.value)}
            placeholder="X-Admin-Token"
            type="password"
            value={props.adminToken}
          />
        </label>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════
   Profile
══════════════════════════════════════════════ */
function ProfileSection(props: {
  values: { name: string; headline: string; eyebrow: string; about: string; location: string; currentLocation: string; desiredLocations: string }
  set: {
    setName: (v: string) => void; setHeadline: (v: string) => void; setEyebrow: (v: string) => void
    setAbout: (v: string) => void; setLocation: (v: string) => void; setCurrentLocation: (v: string) => void; setDesiredLocations: (v: string) => void
  }
  openToWork: boolean
  onToggleOpenToWork: (next: boolean) => Promise<void>
  onPolishAbout: (notes: string) => Promise<string>
  onSave: () => Promise<void>
  onError: (m: string) => void
}) {
  const { values, set } = props
  const [saving, setSaving]       = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [togglingOtw, setTogglingOtw] = useState(false)

  async function polish() {
    if (!values.about.trim()) { props.onError('Write a few notes in About first.'); return }
    setPolishing(true)
    try { set.setAbout(await props.onPolishAbout(values.about)) }
    catch (e) { props.onError(e instanceof Error ? e.message : 'AI polish failed.') }
    finally { setPolishing(false) }
  }
  async function save() {
    setSaving(true)
    try { await props.onSave() } catch (e) { props.onError(e instanceof Error ? e.message : 'Save failed.') } finally { setSaving(false) }
  }
  async function toggleOtw() {
    setTogglingOtw(true)
    try { await props.onToggleOpenToWork(!props.openToWork) }
    catch (e) { props.onError(e instanceof Error ? e.message : 'Save failed.') }
    finally { setTogglingOtw(false) }
  }

  return (
    <>
      <SectionHead title="Profile" sub="Your name, headline, and the hero copy on the public site." />

      {/* Live preview card */}
      <div className="cms-card" style={{ marginBottom: '1rem', background: 'var(--bg)', borderStyle: 'dashed' }}>
        <span className="preview-label">Live preview — hero section</span>
        <p style={{ fontFamily: 'DM Mono,monospace', fontSize: '0.62rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.6rem' }}>
          {values.eyebrow || 'AI Systems · Production ML · Applied Research'}
        </p>
        <h2 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 'clamp(1.8rem,4vw,2.8rem)', fontWeight: 400, letterSpacing: '-0.03em', color: 'var(--ink)', lineHeight: 1.05, marginBottom: '0.5rem' }}>
          {values.name || 'Your Name'}
        </h2>
        <p style={{ fontSize: '0.95rem', color: 'var(--muted)', marginBottom: '0.6rem' }}>{values.headline || 'Your headline'}</p>
        {values.about && <p style={{ fontSize: '0.875rem', color: 'var(--ink-2)', lineHeight: 1.75, maxWidth: '52ch' }}>{values.about}</p>}
      </div>

      {/* Availability toggle */}
      <div className="cms-card" style={{ marginBottom: '1rem' }}>
        <div className="cms-card-head">
          <div>
            <h3 className="cms-card-title">Availability</h3>
            <p className="cms-card-desc">Shows the "Open to work" badge across the public site.</p>
          </div>
          <button className={`switch-button${props.openToWork ? ' on' : ''}`} disabled={togglingOtw} onClick={toggleOtw} type="button">
            <span />
          </button>
        </div>
      </div>

      <div className="cms-card">
        <div className="form-grid">
          <label className="field-label">Name
            <input className="field-input" onChange={e => set.setName(e.target.value)} value={values.name} />
          </label>
          <label className="field-label">Headline
            <input className="field-input" onChange={e => set.setHeadline(e.target.value)} value={values.headline} />
          </label>
          <label className="field-label" style={{ gridColumn: '1 / -1' }}>Hero eyebrow
            <input className="field-input" onChange={e => set.setEyebrow(e.target.value)} value={values.eyebrow} />
          </label>
          <label className="field-label">Profile location
            <input className="field-input" onChange={e => set.setLocation(e.target.value)} value={values.location} />
          </label>
          <label className="field-label">Current location
            <input className="field-input" onChange={e => set.setCurrentLocation(e.target.value)} value={values.currentLocation} />
          </label>
          <label className="field-label" style={{ gridColumn: '1 / -1' }}>Desired locations (comma-separated)
            <input className="field-input" onChange={e => set.setDesiredLocations(e.target.value)} placeholder="Remote, San Francisco, Bengaluru" value={values.desiredLocations} />
          </label>
          <label className="field-label" style={{ gridColumn: '1 / -1' }}>
            <span className="field-label-row">
              About
              <button className="btn-ai-sm" disabled={polishing} onClick={polish} type="button">
                <Icon path={SPARKLE} size={12} />
                {polishing ? 'Polishing…' : 'Polish with AI'}
              </button>
            </span>
            <textarea className="field-input" onChange={e => set.setAbout(e.target.value)} rows={4} value={values.about} />
          </label>
        </div>
        <div className="cms-actions">
          <button className="btn-admin" disabled={saving} onClick={save} type="button">
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════
   Experience
══════════════════════════════════════════════ */
type ExpDraft = { company: string; role: string; dateRange: string; summary: string; items: string; highlights: string; notes: string }
const EMPTY_EXP: ExpDraft = { company: '', role: '', dateRange: '', summary: '', items: '', highlights: '', notes: '' }

function ExperienceSection(props: {
  items: ExperienceItem[]
  aiRewrite: (fields: Record<string, unknown>, notes: string) => Promise<any>
  onSaveAll: (next: ExperienceItem[]) => Promise<void>
  onError: (m: string) => void
}) {
  const [editorIndex, setEditorIndex] = useState<number | 'new' | null>(null)
  const [draft, setDraft]             = useState<ExpDraft>(EMPTY_EXP)
  const [rewriting, setRewriting]     = useState(false)
  const [saving, setSaving]           = useState(false)

  function openNew()           { setDraft(EMPTY_EXP); setEditorIndex('new') }
  function openEdit(index: number) {
    const item = props.items[index]
    setDraft({
      company: item.company || '', role: item.role || '', dateRange: item.dateRange || '',
      summary: item.summary || '', items: (item.items || []).join('\n'),
      highlights: (item.highlights || []).join('\n'), notes: '',
    })
    setEditorIndex(index)
  }
  function close() { setEditorIndex(null); setDraft(EMPTY_EXP) }

  async function rewrite() {
    setRewriting(true)
    try {
      const d = await props.aiRewrite({ company: draft.company, role: draft.role, dateRange: draft.dateRange }, draft.notes)
      setDraft(prev => ({
        ...prev,
        company:    d.company    || prev.company,
        role:       d.role       || prev.role,
        dateRange:  d.dateRange  || prev.dateRange,
        summary:    d.summary    || prev.summary,
        items:      (d.items     || []).join('\n'),
        highlights: (d.highlights || []).join('\n'),
      }))
    } catch (e) { props.onError(e instanceof Error ? e.message : 'AI rewrite failed.') }
    finally { setRewriting(false) }
  }

  async function publish() {
    if (!draft.company.trim()) { props.onError('Company is required.'); return }
    const entry: ExperienceItem = {
      company: draft.company.trim(), role: draft.role.trim() || undefined,
      dateRange: draft.dateRange.trim() || undefined, summary: draft.summary.trim() || undefined,
      items: splitLines(draft.items), highlights: splitLines(draft.highlights),
    }
    const next = [...props.items]
    if (editorIndex === 'new') next.push(entry)
    else if (typeof editorIndex === 'number') next[editorIndex] = entry
    setSaving(true)
    try { await props.onSaveAll(next); close() }
    catch (e) { props.onError(e instanceof Error ? e.message : 'Save failed.') }
    finally { setSaving(false) }
  }

  async function remove(index: number) {
    if (!confirm('Delete this experience entry?')) return
    const next = props.items.filter((_, i) => i !== index)
    try { await props.onSaveAll(next) } catch (e) { props.onError(e instanceof Error ? e.message : 'Delete failed.') }
  }

  return (
    <>
      <SectionHead
        title="Experience"
        sub="Add roles with rough notes — AI drafts polished bullets, then you review before publishing."
        action={<button className="btn-admin" onClick={openNew} type="button">+ Add experience</button>}
      />

      {editorIndex !== null && (
        <div className="cms-card cms-editor">
          <h3 className="cms-card-title">{editorIndex === 'new' ? 'New experience' : 'Edit experience'}</h3>
          <div className="form-grid">
            <label className="field-label">Company
              <input className="field-input" onChange={e => setDraft({ ...draft, company: e.target.value })} value={draft.company} />
            </label>
            <label className="field-label">Role / title
              <input className="field-input" onChange={e => setDraft({ ...draft, role: e.target.value })} value={draft.role} />
            </label>
            <label className="field-label">Dates
              <input className="field-input" onChange={e => setDraft({ ...draft, dateRange: e.target.value })} placeholder="Jan 2023 - Present" value={draft.dateRange} />
            </label>
          </div>

          <div className="ai-box">
            <div className="ai-box-head">
              <span className="ai-box-title"><Icon path={SPARKLE} /> Draft with AI</span>
              <span className="ai-box-hint">Jot rough notes — what you built, tools, impact. AI turns them into clean bullets.</span>
            </div>
            <textarea
              className="field-input"
              onChange={e => setDraft({ ...draft, notes: e.target.value })}
              placeholder="e.g. built carevio chatbot with fastapi + langgraph, ran sentiment analysis on call recordings, set up rag…"
              rows={3}
              value={draft.notes}
            />
            <button className="btn-ai" disabled={rewriting} onClick={rewrite} type="button">
              <Icon path={SPARKLE} />{rewriting ? 'Generating…' : 'Rewrite with AI'}
            </button>
          </div>

          <p className="cms-preview-label">Preview — edit anything before publishing</p>
          <div className="form-grid">
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>Summary
              <textarea className="field-input" onChange={e => setDraft({ ...draft, summary: e.target.value })} rows={2} value={draft.summary} />
            </label>
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>Workstreams / projects (one per line)
              <textarea className="field-input" onChange={e => setDraft({ ...draft, items: e.target.value })} rows={3} value={draft.items} />
            </label>
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>Highlights (one per line)
              <textarea className="field-input" onChange={e => setDraft({ ...draft, highlights: e.target.value })} rows={4} value={draft.highlights} />
            </label>
          </div>
          <div className="cms-actions">
            <button className="btn-admin" disabled={saving} onClick={publish} type="button">{saving ? 'Publishing…' : 'Publish'}</button>
            <button className="btn-admin-outline" onClick={close} type="button">Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {props.items.map((item, index) => (
          <div className="preview-wrap" key={`${item.company}-${index}`}>
            <article className="experience-item" style={{ position: 'relative' }}>
              <div className="exp-left">
                <p className="exp-date">{item.dateRange ?? '—'}</p>
                <p className="exp-company">{item.company}</p>
              </div>
              <div className="exp-right">
                <h3 className="exp-role">{item.role || item.company}</h3>
                {item.summary && <p className="exp-summary">{item.summary}</p>}
                <ul className="exp-items">
                  {item.items.slice(0, 4).map(w => <li key={w}>{w}</li>)}
                </ul>
                {item.highlights.length > 0 && <p className="exp-highlight">{item.highlights[0]}</p>}
              </div>
            </article>
            <div className="preview-actions">
              <button className="btn-admin-outline btn-xs" onClick={() => openEdit(index)} type="button">Edit</button>
              <button className="btn-danger btn-xs" onClick={() => remove(index)} type="button">Delete</button>
            </div>
          </div>
        ))}
        {props.items.length === 0 && editorIndex === null && <EmptyState text="No experience yet. Add your first role." />}
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════
   Skills
══════════════════════════════════════════════ */
function SkillsSection(props: {
  categories: SkillCategory[]
  aiOrganize: (notes: string) => Promise<any>
  onSaveAll: (next: SkillCategory[]) => Promise<void>
  onError: (m: string) => void
}) {
  const [draft, setDraft]         = useState<SkillCategory[]>(props.categories)
  const [raw, setRaw]             = useState('')
  const [organizing, setOrganizing] = useState(false)
  const [saving, setSaving]       = useState(false)
  useEffect(() => { setDraft(props.categories) }, [props.categories])

  async function organize() {
    if (!raw.trim()) { props.onError('Paste some skills first.'); return }
    setOrganizing(true)
    try {
      const d = await props.aiOrganize(raw)
      if (Array.isArray(d.skills) && d.skills.length) setDraft(d.skills)
      else props.onError('AI returned no categories.')
    } catch (e) { props.onError(e instanceof Error ? e.message : 'AI organize failed.') }
    finally { setOrganizing(false) }
  }
  function update(i: number, patch: Partial<SkillCategory>) { setDraft(draft.map((c, idx) => idx === i ? { ...c, ...patch } : c)) }
  function removeCat(i: number) { setDraft(draft.filter((_, idx) => idx !== i)) }
  function addCat() { setDraft([...draft, { category: '', items: [] }]) }
  async function save() {
    setSaving(true)
    try { await props.onSaveAll(draft.filter(c => c.category.trim())) }
    catch (e) { props.onError(e instanceof Error ? e.message : 'Save failed.') }
    finally { setSaving(false) }
  }

  return (
    <>
      <SectionHead
        title="Skills"
        sub="Paste a messy list and let AI group it, or edit categories by hand."
        action={<button className="btn-admin-outline" onClick={addCat} type="button">+ Category</button>}
      />

      {draft.filter(c => c.category.trim()).length > 0 && (
        <div className="cms-card" style={{ marginBottom: '1rem' }}>
          <span className="preview-label">Live preview — how skills appear on the portfolio</span>
          <div className="skills-table">
            {draft.filter(c => c.category.trim()).map((cat, i) => (
              <div className="skill-row" key={i}>
                <span className="skill-cat-label">{cat.category}</span>
                <div className="skill-chips">
                  {cat.items.slice(0, 12).map(item => <span className="chip" key={item}>{item}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="cms-card">
        <div className="ai-box">
          <div className="ai-box-head">
            <span className="ai-box-title"><Icon path={SPARKLE} /> Organize with AI</span>
            <span className="ai-box-hint">Paste raw skills (commas, lines, whatever). AI groups and cleans them.</span>
          </div>
          <textarea
            className="field-input"
            onChange={e => setRaw(e.target.value)}
            placeholder="python, fastapi, postgres, pgvector, react, docker, aws, langgraph, whisper…"
            rows={3}
            value={raw}
          />
          <button className="btn-ai" disabled={organizing} onClick={organize} type="button">
            <Icon path={SPARKLE} />{organizing ? 'Organizing…' : 'Organize with AI'}
          </button>
        </div>

        <div className="skill-edit-list">
          {draft.map((cat, i) => (
            <div className="skill-edit-row" key={i}>
              <input className="field-input skill-cat-input" onChange={e => update(i, { category: e.target.value })} placeholder="Category" value={cat.category} />
              <input className="field-input" onChange={e => update(i, { items: splitList(e.target.value) })} placeholder="comma, separated, skills" value={cat.items.join(', ')} />
              <button className="btn-danger btn-xs" onClick={() => removeCat(i)} type="button">✕</button>
            </div>
          ))}
          {draft.length === 0 && <EmptyState text="No skill categories yet." />}
        </div>
        <div className="cms-actions">
          <button className="btn-admin" disabled={saving} onClick={save} type="button">{saving ? 'Saving…' : 'Save skills'}</button>
        </div>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════
   Projects
══════════════════════════════════════════════ */
type ProjDraft = { id: string | null; title: string; summary: string; techStack: string; whatItDoes: string; isVisible: boolean; sortOrder: string; notes: string }
const EMPTY_PROJ: ProjDraft = { id: null, title: '', summary: '', techStack: '', whatItDoes: '', isVisible: true, sortOrder: '0', notes: '' }

function ProjectsSection(props: {
  projects: AdminProject[]
  api: <T>(path: string, init?: RequestInit) => Promise<T>
  aiRewrite: (fields: Record<string, unknown>, notes: string) => Promise<any>
  reload: () => Promise<void>
  onError: (m: string) => void
  notifyPortfolio?: () => void
}) {
  const [editing, setEditing]     = useState(false)
  const [draft, setDraft]         = useState<ProjDraft>(EMPTY_PROJ)
  const [rewriting, setRewriting] = useState(false)
  const [saving, setSaving]       = useState(false)

  function openNew() { setDraft(EMPTY_PROJ); setEditing(true) }
  function openEdit(p: AdminProject) {
    setDraft({
      id: p.id, title: p.title, summary: p.summary, techStack: p.techStack.join(', '),
      whatItDoes: (p.whatItDoes || []).join('\n'), isVisible: p.isVisible !== false,
      sortOrder: String(p.sortOrder ?? 0), notes: '',
    })
    setEditing(true)
  }
  function close() { setEditing(false); setDraft(EMPTY_PROJ) }

  async function rewrite() {
    setRewriting(true)
    try {
      const d = await props.aiRewrite({ title: draft.title, techStack: splitList(draft.techStack) }, draft.notes)
      setDraft(prev => ({
        ...prev,
        title: d.title || prev.title, summary: d.summary || prev.summary,
        techStack: (d.techStack || []).join(', '), whatItDoes: (d.whatItDoes || []).join('\n'),
      }))
    } catch (e) { props.onError(e instanceof Error ? e.message : 'AI rewrite failed.') }
    finally { setRewriting(false) }
  }

  async function publish() {
    if (!draft.title.trim()) { props.onError('Title is required.'); return }
    const body = JSON.stringify({
      title: draft.title.trim(), summary: draft.summary.trim() || draft.title.trim(),
      tech_stack: splitList(draft.techStack), what_it_does: splitLines(draft.whatItDoes),
      is_visible: draft.isVisible, source_path: 'Admin', sort_order: Number(draft.sortOrder) || 0,
    })
    setSaving(true)
    try {
      if (draft.id) await props.api(`/admin/projects/${draft.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      else await props.api('/admin/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      await props.reload(); props.notifyPortfolio?.(); close()
    } catch (e) { props.onError(e instanceof Error ? e.message : 'Save failed.') }
    finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!confirm('Delete this project?')) return
    try {
      await props.api(`/admin/projects/${id}`, { method: 'DELETE' })
      await props.reload()
      props.notifyPortfolio?.()
    } catch (e) { props.onError(e instanceof Error ? e.message : 'Delete failed.') }
  }

  async function reorder(projectId: string, direction: 'up' | 'down') {
    const sorted = [...props.projects]
      .filter(p => !p.isReadOnly)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const idx = sorted.findIndex(p => p.id === projectId)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const curr = sorted[idx]
    const swap = sorted[swapIdx]
    const makeBody = (p: AdminProject, order: number) => JSON.stringify({
      title: p.title, summary: p.summary || p.title,
      tech_stack: p.techStack, what_it_does: p.whatItDoes || [],
      is_visible: p.isVisible !== false, source_path: p.sourcePath || 'Admin',
      sort_order: order,
    })
    try {
      await Promise.all([
        props.api(`/admin/projects/${curr.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: makeBody(curr, swap.sortOrder ?? swapIdx) }),
        props.api(`/admin/projects/${swap.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: makeBody(swap, curr.sortOrder ?? idx) }),
      ])
      await props.reload()
      props.notifyPortfolio?.()
    } catch (e) { props.onError(e instanceof Error ? e.message : 'Reorder failed.') }
  }

  // Build sorted display list: editable sorted by sortOrder first, seed projects appended
  const editableDisplay = [...props.projects]
    .filter(p => !p.isReadOnly)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const seedDisplay = props.projects.filter(p => p.isReadOnly)
  const sortedDisplay = [...editableDisplay, ...seedDisplay]

  return (
    <>
      <SectionHead
        title="Projects"
        sub="Project cards shown on the public site. Draft them from notes with AI."
        action={<button className="btn-admin" onClick={openNew} type="button">+ Add project</button>}
      />

      {editing && (
        <div className="cms-card cms-editor">
          <h3 className="cms-card-title">{draft.id ? 'Edit project' : 'New project'}</h3>
          {draft.id && props.projects.find(p => p.id === draft.id)?.isReadOnly && (
            <p style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: '-0.5rem', marginBottom: '0.75rem' }}>
              This is a seed project from a markdown file. Saving will add it to your database so you can edit or delete it freely.
            </p>
          )}
          <div className="form-grid">
            <label className="field-label">Title
              <input className="field-input" onChange={e => setDraft({ ...draft, title: e.target.value })} value={draft.title} />
            </label>
            <label className="field-label">Sort order
              <input className="field-input" onChange={e => setDraft({ ...draft, sortOrder: e.target.value })} type="number" value={draft.sortOrder} />
            </label>
          </div>
          <div className="ai-box">
            <div className="ai-box-head">
              <span className="ai-box-title"><Icon path={SPARKLE} /> Draft with AI</span>
              <span className="ai-box-hint">Describe the project loosely; AI writes the summary, capabilities, and tech stack.</span>
            </div>
            <textarea
              className="field-input"
              onChange={e => setDraft({ ...draft, notes: e.target.value })}
              placeholder="what the project is, what it does, the stack…"
              rows={3}
              value={draft.notes}
            />
            <button className="btn-ai" disabled={rewriting} onClick={rewrite} type="button">
              <Icon path={SPARKLE} />{rewriting ? 'Generating…' : 'Rewrite with AI'}
            </button>
          </div>
          <p className="cms-preview-label">Preview — edit before publishing</p>
          <div className="form-grid">
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>Summary
              <textarea className="field-input" onChange={e => setDraft({ ...draft, summary: e.target.value })} rows={2} value={draft.summary} />
            </label>
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>Tech stack (comma-separated)
              <input className="field-input" onChange={e => setDraft({ ...draft, techStack: e.target.value })} value={draft.techStack} />
            </label>
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>What it does (one per line)
              <textarea className="field-input" onChange={e => setDraft({ ...draft, whatItDoes: e.target.value })} rows={4} value={draft.whatItDoes} />
            </label>
            <label className="checkbox-row" style={{ gridColumn: '1 / -1' }}>
              <input checked={draft.isVisible} onChange={e => setDraft({ ...draft, isVisible: e.target.checked })} type="checkbox" />
              Visible on portfolio
            </label>
          </div>
          <div className="cms-actions">
            <button className="btn-admin" disabled={saving} onClick={publish} type="button">{saving ? 'Publishing…' : 'Publish'}</button>
            <button className="btn-admin-outline" onClick={close} type="button">Cancel</button>
          </div>
        </div>
      )}

      <div className="project-bento">
        {sortedDisplay.map(p => {
          const editIdx = editableDisplay.findIndex(ep => ep.id === p.id)
          return (
            <div className="preview-wrap" key={p.id}>
              <div className={`project-card preview-card${p.isVisible === false ? ' is-hidden' : ''}`}>
                <span className="project-card-tag" style={{ opacity: p.isReadOnly ? 0.65 : 1 }}>
                  {p.isReadOnly ? 'Seed' : (p.isVisible === false ? 'Hidden' : 'Live')}
                </span>
                <h3>{p.title}</h3>
                <p>{p.summary}</p>
                {p.techStack.length > 0 && (
                  <div className="tech-pills">
                    {p.techStack.slice(0, 5).map(t => <span className="tech-pill" key={t}>{t}</span>)}
                  </div>
                )}
              </div>
              <div className="preview-actions">
                {!p.isReadOnly && (
                  <>
                    <button
                      className="btn-icon"
                      disabled={editIdx === 0}
                      onClick={() => reorder(p.id, 'up')}
                      title="Move up"
                      type="button"
                    >↑</button>
                    <button
                      className="btn-icon"
                      disabled={editIdx === editableDisplay.length - 1}
                      onClick={() => reorder(p.id, 'down')}
                      title="Move down"
                      type="button"
                    >↓</button>
                  </>
                )}
                <button className="btn-admin-outline btn-xs" onClick={() => openEdit(p)} type="button">Edit</button>
                {!p.isReadOnly && (
                  <button className="btn-danger btn-xs" onClick={() => remove(p.id)} type="button">Delete</button>
                )}
              </div>
            </div>
          )
        })}
        {props.projects.length === 0 && !editing && (
          <div style={{ gridColumn: '1/-1' }}>
            <EmptyState text="No projects yet. Add your first project or upload a document." />
          </div>
        )}
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════
   Documents
══════════════════════════════════════════════ */
function DocumentsSection(props: {
  api: <T>(path: string, init?: RequestInit) => Promise<T>
  documents: DocumentSummary[]
  ragDocs: RagDocument[]
  projects: AdminProject[]
  reload: () => Promise<void>
  onError: (m: string) => void
}) {
  const [uploading, setUploading]   = useState(false)
  const [status, setStatus]         = useState<string | null>(null)
  const [makeProject, setMakeProject] = useState(false)

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fd   = new FormData(form)
    const file = fd.get('file') as File | null
    const key  = String(fd.get('logical_document_key') || '').trim()
    if (!file || !key) { setStatus('Choose a file and a document key.'); return }
    const payload = new FormData()
    payload.append('file', file)
    payload.append('logical_document_key', key)
    payload.append('source_label', String(fd.get('source_label') || '').trim())
    payload.append('ingest_now', String(fd.get('ingest_now') === 'on'))
    if (makeProject) {
      payload.append('create_project', 'true')
      const t = String(fd.get('project_title') || '').trim()
      if (t) payload.append('project_title', t)
    }
    setUploading(true); setStatus('Uploading and indexing…')
    try {
      const r = await props.api<UploadResult>('/upload', { method: 'POST', body: payload })
      setStatus(`Indexed ${r.logical_document_key} · ${r.chunk_count} chunks${r.project_id ? ` · project ${r.project_id}` : ''}`)
      form.reset(); await props.reload()
    } catch (e) { setStatus(e instanceof Error ? e.message : 'Upload failed.') }
    finally { setUploading(false) }
  }

  async function activate(key: string, versionId: string) {
    if (!confirm('Activate this version for chat retrieval?')) return
    try { await props.api(`/admin/documents/${key}/versions/${versionId}/activate`, { method: 'PUT' }); await props.reload() }
    catch (e) { props.onError(e instanceof Error ? e.message : 'Activate failed.') }
  }

  const isErr = status && (status.includes('failed') || status.includes('Choose'))

  return (
    <>
      <SectionHead title="Documents" sub="Feed the chatbot's knowledge base. Uploads are parsed, chunked, embedded, and indexed into pgvector." />

      <div className="cms-card">
        <h3 className="cms-card-title">Upload &amp; index</h3>
        <p className="cms-card-desc" style={{ marginBottom: '1rem' }}>Supported formats: PDF, DOCX, TXT, Markdown.</p>
        <form className="form-grid" onSubmit={handleUpload}>
          <label className="field-label">File
            <input accept=".pdf,.docx,.txt,.md,.markdown" className="field-input" name="file" required type="file" />
          </label>
          <label className="field-label">Document key
            <input className="field-input" name="logical_document_key" placeholder="e.g. Resume, carevio-deep-dive" required type="text" />
          </label>
          <label className="field-label">Source label
            <input className="field-input" name="source_label" placeholder="optional" type="text" />
          </label>
          <label className="checkbox-row">
            <input defaultChecked name="ingest_now" type="checkbox" />Index immediately
          </label>
          <label className="checkbox-row" style={{ gridColumn: '1 / -1' }}>
            <input checked={makeProject} onChange={e => setMakeProject(e.target.checked)} type="checkbox" />
            Also create a project card from this document
          </label>
          {makeProject && (
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>Project title override
              <input className="field-input" name="project_title" placeholder="Leave blank to auto-extract" type="text" />
            </label>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <button className="btn-admin" disabled={uploading} type="submit">
              {uploading ? 'Indexing…' : 'Upload & index'}
            </button>
          </div>
          {status && (
            <div className={`admin-status${isErr ? ' error' : ' success'}`} style={{ gridColumn: '1 / -1' }}>{status}</div>
          )}
        </form>
      </div>

      <div className="cms-card">
        <h3 className="cms-card-title">Active knowledge base</h3>
        <p className="cms-card-desc">{props.ragDocs.length} active source{props.ragDocs.length === 1 ? '' : 's'} powering the chatbot.</p>
        <div className="doc-list" style={{ marginTop: '1rem' }}>
          {props.ragDocs.map(d => (
            <div className="doc-card" key={`${d.logical_document_key}:${d.version_id}`}>
              <div>
                <p className="doc-key">{d.logical_document_key}</p>
                <p className="doc-sub">{d.file_name || 'Unknown'} · {d.version_id.slice(0, 8)}{d.source_label ? ` · ${d.source_label}` : ''}</p>
              </div>
              <span className="doc-badge">{d.chunk_count} chunks</span>
            </div>
          ))}
          {props.ragDocs.length === 0 && <EmptyState text="No active sources yet. Upload a document to get started." />}
        </div>
      </div>

      <div className="cms-card">
        <h3 className="cms-card-title">All documents &amp; versions</h3>
        <div className="doc-list" style={{ marginTop: '1rem' }}>
          {props.documents.map(doc => (
            <div className="doc-card" key={doc.logical_document_key}>
              <div>
                <p className="doc-key">{doc.logical_document_key}</p>
                {doc.versions.slice(0, 2).map(v => (
                  <p className="doc-sub" key={v.version_id}>{v.file_name} · {v.status} · {v.chunk_count} chunks</p>
                ))}
              </div>
              <div className="doc-meta">
                <span className={`doc-badge${doc.active_version_id ? '' : ' inactive'}`}>
                  {doc.active_version_id ? 'Active' : 'Inactive'}
                </span>
                {!doc.active_version_id && doc.versions.length > 0 && (
                  <button
                    className="btn-admin-outline btn-xs"
                    onClick={() => activate(doc.logical_document_key, doc.versions[0].version_id)}
                    type="button"
                  >
                    Activate
                  </button>
                )}
              </div>
            </div>
          ))}
          {props.documents.length === 0 && <EmptyState text="No documents indexed yet." />}
        </div>
      </div>
    </>
  )
}

/* ──────────────────────────────────────────────
   Shared small components
────────────────────────────────────────────── */
function SectionHead({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="cms-section-head">
      <div>
        <h2 className="cms-section-title">{title}</h2>
        <p className="cms-section-sub">{sub}</p>
      </div>
      {action && <div className="cms-section-action">{action}</div>}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="cms-empty">{text}</div>
}

export default AdminPage

/* ══════════════════════════════════════════════
   Social Links Section
══════════════════════════════════════════════ */
function SocialLinksSection({
  linkedin, github, email,
  setLinkedin, setGithub, setEmail,
  onSave, onError,
}: {
  linkedin: string; github: string; email: string
  setLinkedin: (v: string) => void
  setGithub:   (v: string) => void
  setEmail:    (v: string) => void
  onSave:  () => Promise<void>
  onError: (m: string) => void
}) {
  const [saving, setSaving] = useState(false)
  return (
    <div className="section-pane">
      <div className="section-pane-header">
        <h2 className="section-pane-title">Social Links</h2>
        <p className="section-pane-sub">Displayed in the footer of the public portfolio.</p>
      </div>
      <div className="form-grid" style={{ maxWidth: 520 }}>
        <label className="field-label">LinkedIn URL
          <input className="field-input" value={linkedin} onChange={e => setLinkedin(e.target.value)}
            placeholder="https://linkedin.com/in/your-handle" type="url" />
        </label>
        <label className="field-label">GitHub URL
          <input className="field-input" value={github} onChange={e => setGithub(e.target.value)}
            placeholder="https://github.com/your-handle" type="url" />
        </label>
        <label className="field-label">Contact Email
          <input className="field-input" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@email.com" type="email" />
        </label>
        <button
          className="btn-primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            try { await onSave() }
            catch (e) { onError(e instanceof Error ? e.message : 'Save failed.') }
            finally { setSaving(false) }
          }}
          type="button"
        >
          {saving ? 'Saving…' : 'Save Social Links'}
        </button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════
   Messages
══════════════════════════════════════════════ */
function MessagesSection({
  messages, onMarkRead, onDelete,
}: {
  messages: ContactMessage[]
  onMarkRead: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const unread = messages.filter(m => !m.is_read).length
  function fmt(iso: string) {
    try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
    catch { return iso }
  }
  return (
    <>
      <SectionHead
        title="Messages"
        sub={messages.length === 0 ? 'Contact-form and chatbot submissions land here.' : `${messages.length} message${messages.length === 1 ? '' : 's'}${unread ? ` · ${unread} unread` : ''}`}
      />
      <div className="doc-list">
        {messages.map(m => (
          <div className={`cms-card msg-card${m.is_read ? '' : ' msg-card--unread'}`} key={m.message_id} style={{ marginBottom: '0.75rem' }}>
            <div className="msg-head">
              <div>
                <p className="doc-key">
                  {m.name}
                  {!m.is_read && <span className="msg-dot" title="Unread" />}
                  <span className={`msg-source msg-source--${m.source}`}>{m.source === 'chat' ? 'chatbot' : 'form'}</span>
                </p>
                <p className="doc-sub">
                  <a href={`mailto:${m.email}`}>{m.email}</a> · {fmt(m.created_at)}
                </p>
              </div>
              <div className="preview-actions">
                <a className="btn-admin-outline btn-xs" href={`mailto:${m.email}?subject=Re: your message`}>Reply</a>
                {!m.is_read && <button className="btn-admin-outline btn-xs" onClick={() => onMarkRead(m.message_id)} type="button">Mark read</button>}
                <button className="btn-danger btn-xs" onClick={() => onDelete(m.message_id)} type="button">Delete</button>
              </div>
            </div>
            <p className="msg-body">{m.message}</p>
          </div>
        ))}
        {messages.length === 0 && <EmptyState text="No messages yet." />}
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════
   Scheduling
══════════════════════════════════════════════ */
function SchedulingSection({
  value, setValue, onSave, onError,
}: {
  value: Scheduling
  setValue: (v: Scheduling) => void
  onSave: () => Promise<void>
  onError: (m: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const preview = (() => {
    const v = (value.calLink || '').trim().replace(/^@/, '')
    if (!v) return ''
    if (/^https?:\/\//i.test(v)) return v
    if (/^cal\.com\//i.test(v) || v.includes('calendly.com')) return `https://${v}`
    return `https://cal.com/${v}`
  })()
  return (
    <>
      <SectionHead
        title="Scheduling"
        sub="Let visitors book a call. Uses Cal.com (or Calendly) — connect your Google Calendar there for live availability + auto Google Meet links."
      />
      <div className="cms-card">
        <div className="cms-card-head">
          <div>
            <h3 className="cms-card-title">Show scheduling section</h3>
            <p className="cms-card-desc">Adds a "Book a call" section to the public site and lets the chatbot share your link.</p>
          </div>
          <button className={`switch-button${value.enabled ? ' on' : ''}`} onClick={() => setValue({ ...value, enabled: !value.enabled })} type="button"><span /></button>
        </div>
      </div>
      <div className="cms-card">
        <div className="form-grid">
          <label className="field-label" style={{ gridColumn: '1 / -1' }}>Cal.com / Calendly link
            <input className="field-input" value={value.calLink} onChange={e => setValue({ ...value, calLink: e.target.value })}
              placeholder="your-handle  or  cal.com/your-handle" type="text" />
          </label>
          {preview && (
            <p className="cms-card-desc" style={{ gridColumn: '1 / -1', marginTop: '-0.4rem' }}>
              Booking link → <a href={preview} target="_blank" rel="noreferrer">{preview}</a>
            </p>
          )}
          <label className="field-label">Section headline
            <input className="field-input" value={value.headline} onChange={e => setValue({ ...value, headline: e.target.value })} placeholder="Let's talk" />
          </label>
          <label className="field-label" style={{ gridColumn: '1 / -1' }}>Subtext
            <textarea className="field-input" value={value.subtext} onChange={e => setValue({ ...value, subtext: e.target.value })} rows={2}
              placeholder="Book a 30-minute call — you'll get a Google Meet link automatically." />
          </label>
        </div>
        <div className="cms-callout" style={{ marginTop: '0.5rem' }}>
          <strong>Setup:</strong> Create a free account at <a href="https://cal.com" target="_blank" rel="noreferrer">cal.com</a>, connect Google Calendar,
          set your availability, then paste your booking link above. No redeploy needed.
        </div>
        <div className="cms-actions">
          <button className="btn-admin" disabled={saving} type="button"
            onClick={async () => { setSaving(true); try { await onSave() } catch (e) { onError(e instanceof Error ? e.message : 'Save failed.') } finally { setSaving(false) } }}>
            {saving ? 'Saving…' : 'Save scheduling'}
          </button>
        </div>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════
   Sections (visibility + order)
══════════════════════════════════════════════ */
function SectionsSection({
  sections, setSections, onSave, onError,
}: {
  sections: SiteSection[]
  setSections: (v: SiteSection[]) => void
  onSave: () => Promise<void>
  onError: (m: string) => void
}) {
  const [saving, setSaving] = useState(false)
  function move(index: number, dir: 'up' | 'down') {
    const next = [...sections]
    const swap = dir === 'up' ? index - 1 : index + 1
    if (swap < 0 || swap >= next.length) return
    ;[next[index], next[swap]] = [next[swap], next[index]]
    setSections(next)
  }
  function toggle(index: number) {
    setSections(sections.map((s, i) => i === index ? { ...s, visible: !s.visible } : s))
  }
  return (
    <>
      <SectionHead title="Sections" sub="Show, hide, and reorder the sections on your public site. Changes apply live." />
      <div className="cms-card">
        <div className="section-order-list">
          {sections.map((s, i) => (
            <div className="section-order-row" key={s.id}>
              <div className="section-order-info">
                <span className="section-order-handle">{String(i + 1).padStart(2, '0')}</span>
                <span className="section-order-label">{s.label}</span>
                <span className={`section-order-state${s.visible ? ' on' : ''}`}>{s.visible ? 'Visible' : 'Hidden'}</span>
              </div>
              <div className="preview-actions">
                <button className="btn-icon" disabled={i === 0} onClick={() => move(i, 'up')} title="Move up" type="button">↑</button>
                <button className="btn-icon" disabled={i === sections.length - 1} onClick={() => move(i, 'down')} title="Move down" type="button">↓</button>
                <button className={`switch-button${s.visible ? ' on' : ''}`} onClick={() => toggle(i)} type="button"><span /></button>
              </div>
            </div>
          ))}
          {sections.length === 0 && <EmptyState text="No sections found." />}
        </div>
        <div className="cms-actions">
          <button className="btn-admin" disabled={saving} type="button"
            onClick={async () => { setSaving(true); try { await onSave() } catch (e) { onError(e instanceof Error ? e.message : 'Save failed.') } finally { setSaving(false) } }}>
            {saving ? 'Saving…' : 'Save section order'}
          </button>
        </div>
      </div>
    </>
  )
}
