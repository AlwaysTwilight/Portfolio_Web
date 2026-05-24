import { lazy, Suspense, useCallback } from 'react'
import './terminal.css'
import {
  BootScreen,
  MainMenu,
  WhoAmIScreen,
  ProjectsScreen,
  ProjectDetailScreen,
  ExperienceScreen,
  SkillsScreen,
  RajBotScreen,
} from './TerminalWindow'
import { useTerminal } from './useTerminal'

// Lazy-load Three.js background (heavy — don't block first paint)
const MatrixBackground = lazy(() => import('./MatrixBackground'))

// ── Prompt row for non-chat screens ──────────────────────────────────────────

function StaticPrompt({ screen }: { screen: string }) {
  if (screen === 'BOOT' || screen === 'RAJBOT') return null
  return (
    <div className="t3d-prompt-row" aria-hidden>
      <span className="t3d-prompt-symbol">&gt;</span>
      <span className="t3d-prompt-input" style={{ opacity: 0.35, pointerEvents: 'none' }}>_</span>
    </div>
  )
}

// ── Main entry ────────────────────────────────────────────────────────────────

interface Props {
  onExitTerminal: () => void
}

export default function Terminal3D({ onExitTerminal }: Props) {
  const {
    screen,
    portfolio,
    bootDone: _bootDone,
    activeProject,
    chatHistory,
    chatThinking,
    onBootComplete,
    go,
    back,
    openProject,
    sendChat,
  } = useTerminal()

  const handleMenuGo = useCallback((s: Parameters<typeof go>[0]) => {
    if (s === ('EXIT' as never)) { onExitTerminal(); return }
    go(s)
  }, [go, onExitTerminal])

  const projects  = portfolio?.projects   ?? []
  const profile   = portfolio?.profile    ?? null
  const experience = profile?.experience  ?? []
  const skills     = profile?.skills      ?? []

  return (
    <div className="t3d-root">
      {/* Three.js matrix background */}
      <Suspense fallback={null}>
        <MatrixBackground />
      </Suspense>

      {/* CRT overlay effects */}
      <div className="t3d-scanlines" aria-hidden />
      <div className="t3d-vignette"  aria-hidden />

      {/* Mode-toggle button */}
      <button
        className="t3d-mode-toggle"
        onClick={onExitTerminal}
        title="Switch to classic view"
      >
        [ CLASSIC MODE ]
      </button>

      {/* Terminal panel */}
      <div className="t3d-terminal" role="main">
        <div className="t3d-panel">

          {/* Title bar */}
          <div className="t3d-titlebar">
            <span className="t3d-titlebar-label">PORTFOLIO-OS — {screen}</span>
            <div className="t3d-titlebar-dots">
              <span /><span /><span />
            </div>
          </div>

          {/* Screen content */}
          {screen === 'BOOT' && (
            <BootScreen onDone={onBootComplete} />
          )}

          {screen === 'MENU' && (
            <MainMenu profile={profile} go={handleMenuGo} />
          )}

          {screen === 'WHO_AM_I' && (
            <WhoAmIScreen profile={profile} back={back} />
          )}

          {screen === 'PROJECTS' && (
            <ProjectsScreen
              projects={projects}
              back={back}
              openProject={openProject}
            />
          )}

          {screen === 'PROJECT_DETAIL' && activeProject && (
            <ProjectDetailScreen project={activeProject} back={back} />
          )}

          {screen === 'EXPERIENCE' && (
            <ExperienceScreen experience={experience} back={back} />
          )}

          {screen === 'SKILLS' && (
            <SkillsScreen skills={skills} back={back} />
          )}

          {screen === 'RAJBOT' && (
            <RajBotScreen
              history={chatHistory}
              thinking={chatThinking}
              sendChat={sendChat}
              back={back}
            />
          )}

          {/* Static prompt row (non-chat screens) */}
          <StaticPrompt screen={screen} />
        </div>
      </div>
    </div>
  )
}
