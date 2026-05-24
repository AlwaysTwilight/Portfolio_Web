import { useEffect, useRef, useState, useCallback } from 'react'
import type {
  Screen,
  PortfolioData,
  ProjectCard,
  ChatMessage,
} from './useTerminal'

// ══════════════════════════════════════════════════════════════════════════════
//  Shared helpers
// ══════════════════════════════════════════════════════════════════════════════

function Cursor() {
  return <span className="t3d-cursor" aria-hidden />
}

function useTypeLines(lines: string[], speed = 28, pause = 60) {
  const [visible, setVisible] = useState<string[]>([])
  const [done, setDone] = useState(false)

  useEffect(() => {
    setVisible([])
    setDone(false)
    let lineIdx = 0
    let charIdx = 0
    let timerId: ReturnType<typeof setTimeout>

    function tick() {
      if (lineIdx >= lines.length) { setDone(true); return }
      const line = lines[lineIdx]
      charIdx++
      setVisible(prev => {
        const next = [...prev]
        next[lineIdx] = line.slice(0, charIdx)
        return next
      })
      if (charIdx >= line.length) {
        charIdx = 0
        lineIdx++
        timerId = setTimeout(tick, pause)
      } else {
        timerId = setTimeout(tick, speed)
      }
    }
    timerId = setTimeout(tick, 80)
    return () => clearTimeout(timerId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(lines)])

  return { visible, done }
}

// ══════════════════════════════════════════════════════════════════════════════
//  BOOT SCREEN
// ══════════════════════════════════════════════════════════════════════════════

const BOOT_LINES = [
  '> PORTFOLIO-OS v2.0 — INITIALIZING...',
  '> MOUNTING FILESYSTEM........................ OK',
  '> LOADING PROFILE_DATA.json.................. OK',
  '> CONNECTING TO KNOWLEDGE BASE (NEON/PG)..... OK',
  '> INITIALIZING EMBEDDING ENGINE.............. OK',
  '> STARTING RAJ-BOT NEURAL INTERFACE.......... OK',
  '> RUNNING DIAGNOSTICS........................ PASS',
  '',
  '> ════════════════════════════════════════',
  '>   WELCOME TO RAJ SAHOO\'S PORTFOLIO',
  '>   TERMINAL INTERFACE v2.0',
  '> ════════════════════════════════════════',
  '',
  '> TYPE A NUMBER OR CLICK A MENU ITEM.',
]

export function BootScreen({ onDone }: { onDone: () => void }) {
  const { visible, done } = useTypeLines(BOOT_LINES, 22, 40)

  useEffect(() => { if (done) onDone() }, [done, onDone])

  return (
    <div className="t3d-body">
      {visible.map((line, i) => (
        <div
          key={i}
          className={`t3d-boot-line${line.startsWith('>') && line.includes('OK') ? ' ok' : ''}`}
        >
          {line}
        </div>
      ))}
      {!done && <Cursor />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN MENU
// ══════════════════════════════════════════════════════════════════════════════

const MENU_ITEMS: { key: string; label: string; screen: Screen }[] = [
  { key: '1', label: 'WHO AM I',       screen: 'WHO_AM_I'   },
  { key: '2', label: 'PROJECTS',       screen: 'PROJECTS'   },
  { key: '3', label: 'EXPERIENCE',     screen: 'EXPERIENCE' },
  { key: '4', label: 'SKILLS MATRIX',  screen: 'SKILLS'     },
  { key: '5', label: 'TALK TO RAJ-BOT',screen: 'RAJBOT'     },
]

export function MainMenu({
  profile,
  go,
}: {
  profile: PortfolioData['profile'] | null
  go: (s: Screen) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)

  // Keyboard nav
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const item = MENU_ITEMS.find(m => m.key === e.key)
      if (item) go(item.screen)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [go])

  return (
    <div className="t3d-body">
      <div className="t3d-line bright center" style={{ marginBottom: 6, letterSpacing: 3 }}>
        RAJ SAHOO // AI-ML DEVELOPER
      </div>
      <div className="t3d-line dim center" style={{ marginBottom: 20, fontSize: 11 }}>
        {profile?.headline ?? 'AI/ML Software Developer'}
        {profile?.openToWork && (
          <span className="t3d-badge open" style={{ marginLeft: 10 }}>OPEN TO WORK</span>
        )}
      </div>

      <div className="t3d-box">
        {MENU_ITEMS.map(item => (
          <div
            key={item.key}
            className={`t3d-menu-item${hovered === item.key ? ' hovered' : ''}`}
            onClick={() => go(item.screen)}
            onMouseEnter={() => setHovered(item.key)}
            onMouseLeave={() => setHovered(null)}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') go(item.screen) }}
          >
            <span className="t3d-menu-key">{item.key}</span>
            <span className="t3d-menu-label">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="t3d-line dim" style={{ marginTop: 14, fontSize: 11 }}>
        PRESS KEY [1–5] OR CLICK TO NAVIGATE
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  WHO AM I
// ══════════════════════════════════════════════════════════════════════════════

export function WhoAmIScreen({
  profile,
  back,
}: {
  profile: PortfolioData['profile'] | null
  back: () => void
}) {
  const lines = profile ? [
    '> QUERYING PROFILE_DATA...',
    '',
    `  NAME .............. ${profile.name}`,
    `  TITLE ............. ${profile.headline}`,
    `  LOCATION .......... ${profile.currentLocation ?? profile.location}`,
    `  STATUS ............ ${profile.openToWork ? '🟢 OPEN TO OPPORTUNITIES' : '🔴 NOT LOOKING'}`,
    '',
    '> LOADING ABOUT_ME...',
    '',
    ...wrapText(profile.about ?? '', 62).map(l => `  ${l}`),
    '',
    '> EOF.',
  ] : [
    '> LOADING PROFILE_DATA...',
    '  (fetching from backend)',
  ]

  const { visible, done } = useTypeLines(lines, 18, 30)

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Backspace') back()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [back])

  return (
    <div className="t3d-body">
      <div className="t3d-section-header">
        ╔══ [ WHO AM I ] ═══════════════════════════╗
      </div>

      {visible.map((line, i) => (
        <div key={i} className="t3d-line">
          {line === '' ? <br /> : line}
          {!done && i === visible.length - 1 && <Cursor />}
        </div>
      ))}

      {done && (
        <button className="t3d-back-btn" onClick={back}>
          ← BACK TO MENU <span style={{ opacity: 0.5, marginLeft: 8, fontSize: 10 }}>[ESC]</span>
        </button>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  PROJECTS
// ══════════════════════════════════════════════════════════════════════════════

export function ProjectsScreen({
  projects,
  back,
  openProject,
}: {
  projects: ProjectCard[]
  back: () => void
  openProject: (p: ProjectCard) => void
}) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') back()
      const idx = parseInt(e.key) - 1
      if (!isNaN(idx) && idx >= 0 && idx < projects.length) openProject(projects[idx])
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [back, openProject, projects])

  return (
    <div className="t3d-body">
      <div className="t3d-section-header">
        ╔══ [ PROJECTS ] ── {projects.length} ENTRIES FOUND ═══╗
      </div>

      <div className="t3d-line dim" style={{ marginBottom: 14, fontSize: 11 }}>
        CLICK A PROJECT OR PRESS [1–{projects.length}] TO INSPECT
      </div>

      {projects.map((p, i) => (
        <div
          key={p.id}
          className="t3d-project-card"
          onClick={() => openProject(p)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') openProject(p) }}
        >
          <div className="t3d-project-title">
            <span style={{ color: 'var(--green-dim)', marginRight: 10 }}>[{i + 1}]</span>
            {p.title}
          </div>
          <div className="t3d-project-summary">{p.summary.slice(0, 140)}{p.summary.length > 140 ? '…' : ''}</div>
          {p.techStack.length > 0 && (
            <div className="t3d-project-tech">
              {p.techStack.slice(0, 6).map(t => (
                <span key={t} className="t3d-tag">{t}</span>
              ))}
            </div>
          )}
        </div>
      ))}

      <button className="t3d-back-btn" onClick={back}>
        ← BACK TO MENU <span style={{ opacity: 0.5, marginLeft: 8, fontSize: 10 }}>[ESC]</span>
      </button>
    </div>
  )
}

// ── Project detail ────────────────────────────────────────────────────────────

export function ProjectDetailScreen({
  project,
  back,
}: {
  project: ProjectCard
  back: () => void
}) {
  const lines = [
    `> LOADING ${project.title.toUpperCase()}...`,
    '',
    `  TITLE:   ${project.title}`,
    '',
    '  OVERVIEW:',
    ...wrapText(project.summary, 60).map(l => `    ${l}`),
    '',
    '  TECH STACK:',
    `    ${project.techStack.join('  ·  ')}`,
    '',
    '> EOF.',
  ]

  const { visible, done } = useTypeLines(lines, 20, 35)

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [back])

  return (
    <div className="t3d-body">
      <div className="t3d-section-header">
        ╔══ [ PROJECT DETAIL ] ══════════════════════╗
      </div>

      {visible.map((line, i) => (
        <div key={i} className="t3d-line">
          {line === '' ? <br /> : line}
          {!done && i === visible.length - 1 && <Cursor />}
        </div>
      ))}

      {done && (
        <button className="t3d-back-btn" onClick={back}>
          ← BACK TO PROJECTS <span style={{ opacity: 0.5, marginLeft: 8, fontSize: 10 }}>[ESC]</span>
        </button>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  EXPERIENCE
// ══════════════════════════════════════════════════════════════════════════════

export function ExperienceScreen({
  experience,
  back,
}: {
  experience: PortfolioData['profile']['experience']
  back: () => void
}) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [back])

  const [revealed, setRevealed] = useState(0)

  useEffect(() => {
    if (!experience.length) return
    const id = setInterval(() => {
      setRevealed(r => {
        if (r >= experience.length) { clearInterval(id); return r }
        return r + 1
      })
    }, 520)
    return () => clearInterval(id)
  }, [experience.length])

  return (
    <div className="t3d-body">
      <div className="t3d-section-header">
        ╔══ [ EXPERIENCE LOG ] ── {experience.length} ENTRIES ═══╗
      </div>

      {experience.length === 0 && (
        <div className="t3d-line dim">No experience data loaded — upload a resume in Admin.</div>
      )}

      {experience.slice(0, revealed).map((exp, i) => (
        <div key={i} className="t3d-exp-entry">
          <div className="t3d-exp-company">{exp.company}</div>
          {(exp.role || exp.dateRange) && (
            <div className="t3d-exp-meta">
              {exp.role && <span>{exp.role}</span>}
              {exp.role && exp.dateRange && <span> · </span>}
              {exp.dateRange && <span>{exp.dateRange}</span>}
            </div>
          )}
          {(exp.items.length > 0 ? exp.items : exp.highlights).slice(0, 6).map((item, j) => (
            <div key={j} className="t3d-exp-item">{item}</div>
          ))}
        </div>
      ))}

      {revealed < experience.length && <Cursor />}

      {revealed >= experience.length && experience.length > 0 && (
        <button className="t3d-back-btn" onClick={back}>
          ← BACK TO MENU <span style={{ opacity: 0.5, marginLeft: 8, fontSize: 10 }}>[ESC]</span>
        </button>
      )}
      {experience.length === 0 && (
        <button className="t3d-back-btn" onClick={back}>← BACK TO MENU</button>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  SKILLS MATRIX
// ══════════════════════════════════════════════════════════════════════════════

// Map skill names → rough proficiency for the bar
const SKILL_LEVELS: Record<string, number> = {
  python: 92, fastapi: 88, langchain: 85, langgraph: 82, pytorch: 80,
  tensorflow: 75, typescript: 78, javascript: 80, react: 76, nodejs: 70,
  docker: 82, postgresql: 78, mongodb: 74, redis: 70, aws: 72, git: 90,
  openai: 85, gemini: 88, chromadb: 78, pgvector: 80, sql: 78, linux: 70,
  'machine learning': 85, 'deep learning': 80, 'nlp': 83, 'rag': 88,
}

function skillLevel(name: string): number {
  return SKILL_LEVELS[name.toLowerCase()] ?? 68
}

const FALLBACK_SKILLS = [
  { category: 'Languages',  items: ['Python', 'TypeScript', 'JavaScript', 'SQL'] },
  { category: 'AI / ML',    items: ['PyTorch', 'LangChain', 'LangGraph', 'OpenAI', 'Gemini', 'RAG'] },
  { category: 'Backend',    items: ['FastAPI', 'Node.js', 'Flask'] },
  { category: 'Infra',      items: ['Docker', 'PostgreSQL', 'pgvector', 'Redis', 'AWS'] },
]

export function SkillsScreen({
  skills,
  back,
}: {
  skills: PortfolioData['profile']['skills']
  back: () => void
}) {
  const data = skills.length > 0 ? skills : FALLBACK_SKILLS
  const [revealedCats, setRevealedCats] = useState(0)
  const [revealedBars, setRevealedBars] = useState(0)

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [back])

  useEffect(() => {
    const id = setInterval(() => {
      setRevealedCats(r => {
        if (r >= data.length) { clearInterval(id); return r }
        return r + 1
      })
    }, 350)
    return () => clearInterval(id)
  }, [data.length])

  const totalBars = data.slice(0, revealedCats).reduce((n, c) => n + c.items.length, 0)

  useEffect(() => {
    if (revealedBars >= totalBars) return
    const id = setTimeout(() => setRevealedBars(r => r + 1), 60)
    return () => clearTimeout(id)
  }, [revealedBars, totalBars])

  let barCount = 0

  return (
    <div className="t3d-body">
      <div className="t3d-section-header">
        ╔══ [ SKILLS MATRIX ] ══════════════════════╗
      </div>

      {data.slice(0, revealedCats).map((cat, ci) => (
        <div key={ci} style={{ marginBottom: 16 }}>
          <div className="t3d-line bright" style={{ marginBottom: 6, fontSize: 11, letterSpacing: 2 }}>
            {cat.category.toUpperCase()}
          </div>
          {cat.items.map((skill, si) => {
            const show = barCount < revealedBars
            barCount++
            const pct = skillLevel(skill)
            return (
              <div key={si} className="t3d-bar-row">
                <span className="t3d-bar-label">{skill}</span>
                <div className="t3d-bar-track">
                  <div
                    className="t3d-bar-fill"
                    style={{ width: show ? `${pct}%` : '0%' }}
                  />
                </div>
                <span className="t3d-bar-pct">{show ? `${pct}%` : ''}</span>
              </div>
            )
          })}
        </div>
      ))}

      {revealedCats >= data.length && (
        <button className="t3d-back-btn" onClick={back}>
          ← BACK TO MENU <span style={{ opacity: 0.5, marginLeft: 8, fontSize: 10 }}>[ESC]</span>
        </button>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  RAJ-BOT CHAT
// ══════════════════════════════════════════════════════════════════════════════

export function RajBotScreen({
  history,
  thinking,
  sendChat,
  back,
}: {
  history: ChatMessage[]
  thinking: boolean
  sendChat: (m: string) => void
  back: () => void
}) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, thinking])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [back])

  const submit = useCallback(() => {
    const msg = input.trim()
    if (!msg) return
    setInput('')
    sendChat(msg)
  }, [input, sendChat])

  return (
    <>
      <div className="t3d-body">
        <div className="t3d-section-header">
          ╔══ [ RAJ-BOT v1.0 ] ── NEURAL INTERFACE ══╗
        </div>

        <div className="t3d-line dim" style={{ marginBottom: 16, fontSize: 11 }}>
          CONNECTED TO KNOWLEDGE BASE · ASK ANYTHING · [ESC] TO EXIT
        </div>

        <div className="t3d-chat-history">
          {history.map((msg, i) => (
            <div key={i} className={`t3d-chat-msg ${msg.role === 'user' ? 'user' : 'bot'}`}>
              <div className="t3d-chat-label">
                {msg.role === 'user' ? 'YOU' : 'RAJ-BOT'}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
            </div>
          ))}
          {thinking && (
            <div className="t3d-chat-thinking">
              RAJ-BOT <Cursor />
            </div>
          )}
        </div>

        <div ref={bottomRef} className="t3d-scroll-anchor" />
      </div>

      <div className="t3d-prompt-row">
        <span className="t3d-prompt-symbol">YOU &gt;</span>
        <input
          className="t3d-prompt-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="type your question..."
          autoFocus
          disabled={thinking}
        />
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  Utility
// ══════════════════════════════════════════════════════════════════════════════

function wrapText(text: string, maxLen: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxLen) {
      if (current) lines.push(current.trim())
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current.trim())
  return lines
}
