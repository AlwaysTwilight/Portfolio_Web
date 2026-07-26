import { useEffect, useRef, useState } from 'react'

// ── Shared retro-terminal chat window ────────────────────────────────────────
// One component, two homes: the 3D desk scene's RajBot chat, and the classic
// site's "AI Assistant" widget. Both should look and behave identically —
// traffic-light title bar, slash-command hints, suggestion chips, a $/>
// scrollback, and a blinking-cursor prompt — so this owns that UI once.
//
// Opens minimized (a small corner widget) by default; the ⛶ button expands
// it to a large centered window, and back again.

export type TerminalMessage = { role: 'user' | 'assistant'; content: string }
export type TerminalSlashCommand = { cmd: string; run: () => void }

const MONO = "'DM Mono','SFMono-Regular',Menlo,Consolas,monospace"
const EMERALD = '#10b981'
const CYAN = '#22d3ee'
const INK = '#fafafa'
const INK2 = '#d4d4d8'
const MUTED = '#a1a1aa'
const BORDER = 'rgba(255,255,255,0.10)'
// Above every z-index already in use on either surface this mounts into
// (the classic site's own .chat-backdrop sits at 250) so its dimming layer
// can never paint over this window's content again.
const Z = 300

interface Props {
  name: string
  messages: TerminalMessage[]
  thinking: boolean
  onSend: (text: string) => void
  onClose: () => void
  subtitle?: string
  greeting?: string
  slashCommands?: TerminalSlashCommand[]
  suggestions?: string[]
  renderAssistant?: (content: string) => React.ReactNode
  /** Opens as the large centered window instead of the small corner widget.
   *  The 3D room wants this (it's the room's main focal interaction); the
   *  classic site wants the corner default since it sits over a scrollable page. */
  defaultMaximized?: boolean
}

export default function TerminalWindow({
  name, messages, thinking, onSend, onClose,
  subtitle = 'cognition_layer online', greeting, slashCommands = [], suggestions = [], renderAssistant,
  defaultMaximized = false,
}: Props) {
  const [input, setInput] = useState('')
  const [maximized, setMaximized] = useState(defaultMaximized)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { const el = transcriptRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages, thinking])
  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = (raw?: string) => {
    const v = (raw ?? input).trim()
    if (!v || thinking) return
    setInput('')
    if (v.startsWith('/')) {
      const found = slashCommands.find(s => s.cmd === v.split(/\s/)[0])
      if (found) { found.run(); return }
    }
    onSend(v)
  }

  const uname = name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'guest'

  const frameStyle: React.CSSProperties = maximized
    ? { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(640px,94vw)', maxHeight: '80vh' }
    : { position: 'fixed', right: 20, bottom: 20, width: 'min(380px,92vw)', maxHeight: '64vh' }

  return (
    <div style={{
      ...frameStyle, zIndex: Z, display: 'flex', flexDirection: 'column',
      background: '#0a0d16', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden',
      boxShadow: `0 24px 70px rgba(0,0,0,0.6), 0 0 40px rgba(16,185,129,0.12)`, fontFamily: MONO,
      animation: 'twPanelIn .28s cubic-bezier(.2,.8,.2,1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: `1px solid ${BORDER}` }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }} />
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }} />
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }} />
        <span style={{ marginLeft: 10, color: EMERALD, fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{uname}_ai v1.0 · {subtitle}</span>
        <button onClick={() => setMaximized(m => !m)} aria-label={maximized ? 'Minimize' : 'Maximize'} title={maximized ? 'Minimize' : 'Full screen'} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', fontSize: 15, padding: 4 }}>{maximized ? '🗗' : '⛶'}</button>
        <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      {slashCommands.length > 0 && (
        <div style={{ padding: '14px 18px 4px' }}>
          <div style={{ color: INK2, fontSize: '0.8rem', fontWeight: 600 }}>
            type a question, or one of: {slashCommands.map(s => <span key={s.cmd} style={{ color: CYAN, marginRight: 6 }}>{s.cmd}</span>)}
          </div>
          <div style={{ color: MUTED, fontSize: '0.78rem', marginTop: 6 }}>{greeting || `// hello. ask me anything about ${name}.`}</div>
        </div>
      )}

      {messages.length === 0 && suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '14px 18px' }}>
          {suggestions.map(s => (
            <button key={s} onClick={() => submit(s)} style={{ fontFamily: MONO, fontSize: '0.76rem', color: INK2, background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 11px', cursor: 'pointer' }}>{s}</button>
          ))}
        </div>
      )}

      <div ref={transcriptRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 100 }}>
        {messages.length === 0 && slashCommands.length === 0 && (
          <div style={{ color: MUTED, fontSize: '0.84rem' }}>{greeting || `Ask about ${name}'s projects, experience, skills, or availability.`}</div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ color: m.role === 'user' ? INK : INK2, fontSize: '0.84rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            <span style={{ color: m.role === 'user' ? CYAN : EMERALD, marginRight: 8 }}>{m.role === 'user' ? '$' : '>'}</span>
            {m.role === 'assistant' && renderAssistant ? renderAssistant(m.content) : m.content}
          </div>
        ))}
        {thinking && <div style={{ color: MUTED, fontSize: '0.84rem' }}><span style={{ color: EMERALD, marginRight: 8 }}>&gt;</span>thinking…</div>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: `1px solid ${BORDER}` }}>
        <span style={{ color: MUTED, fontSize: '0.8rem' }}>guest@{uname}:~</span>
        <span style={{ color: CYAN, fontWeight: 700 }}>$</span>
        <input
          ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: INK, fontFamily: MONO, fontSize: '0.86rem' }}
        />
        <span style={{ width: 8, height: 15, background: EMERALD, animation: 'twCursor 1s step-end infinite' }} />
      </div>
      <style>{`
        @keyframes twCursor{0%,50%{opacity:1}50.01%,100%{opacity:0}}
        @keyframes twPanelIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
      `}</style>
    </div>
  )
}
