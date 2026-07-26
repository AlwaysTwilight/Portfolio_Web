import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from './useTerminal'
import { C, glass, hudText } from './theme'

// ── Terminal-styled chat modal ───────────────────────────────────────────────
// Restyles the existing chat dock as a retro OS window: traffic-light dots,
// header line, slash-command hint row, scrollback with a `>` prefix on
// answers, blinking mono cursor on the live input. This is a pure restyle —
// it reuses the SAME sendChat/chatHistory/chatThinking wiring from useTerminal,
// no second chat integration.

const SLASH_COMMANDS: { cmd: string; label: string; nav?: string }[] = [
  { cmd: '/projects', label: 'jump to projects', nav: 'projects' },
  { cmd: '/experience', label: 'jump to experience', nav: 'experience' },
  { cmd: '/skills', label: 'jump to skills', nav: 'skills' },
  { cmd: '/contact', label: 'jump to contact', nav: 'contact' },
  { cmd: '/cv', label: 'download resume' },
]

interface Props {
  chatHistory: ChatMessage[]
  chatThinking: boolean
  sendChat: (msg: string) => void
  onClose: () => void
  onSlashNav?: (section: string) => void
  /** Optional: anchor bottom-right dock style instead of centered modal (used in free-roam). */
  dock?: boolean
}

export default function TerminalChat({ chatHistory, chatThinking, sendChat, onClose, onSlashNav, dock = false }: Props) {
  const [input, setInput] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { const el = transcriptRef.current; if (el) el.scrollTop = el.scrollHeight }, [chatHistory, chatThinking])
  useEffect(() => { inputRef.current?.focus() }, [])

  const runSlash = (cmd: string) => {
    const found = SLASH_COMMANDS.find(s => s.cmd === cmd)
    if (!found) return
    if (found.cmd === '/cv') { window.open('/Raj_Sahoo_Resume.pdf', '_blank'); return }
    if (found.nav && onSlashNav) { onSlashNav(found.nav); return }
  }

  const submit = () => {
    const v = input.trim()
    if (!v || chatThinking) return
    if (v.startsWith('/')) {
      setInput('')
      runSlash(v)
      return
    }
    setInput('')
    sendChat(v)
  }

  return (
    <div style={{
      position: 'absolute', zIndex: 50,
      ...(dock
        ? { bottom: 0, right: 0, width: 'min(430px,96vw)', maxHeight: '64vh' }
        : { bottom: '10%', left: '50%', transform: 'translateX(-50%)', width: 'min(520px,94vw)', maxHeight: '62vh' }),
      display: 'flex', flexDirection: 'column',
      ...glass({ strength: 'heavy', accent: true, radius: dock ? 0 : 14 }),
      borderRadius: dock ? '16px 0 0 0' : 14,
      overflow: 'hidden',
    }}>
      {/* title bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
        <span style={{ ...hudText, fontSize: '0.68rem', color: C.muted, marginLeft: 8 }}>
          rajbot v1.0 &middot; grounded in real documents
        </span>
        <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>&times;</button>
      </div>

      {/* slash-command hint row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 12px', borderBottom: `1px solid ${C.border}` }}>
        {SLASH_COMMANDS.map(s => (
          <button key={s.cmd} onClick={() => runSlash(s.cmd)} title={s.label} style={{
            fontFamily: C.mono, fontSize: '0.68rem', color: C.cyanHex, background: 'rgba(34,211,238,0.08)',
            border: '1px solid rgba(34,211,238,0.25)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
          }}>{s.cmd}</button>
        ))}
      </div>

      {/* scrollback */}
      <div ref={transcriptRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, fontFamily: C.mono, fontSize: '0.84rem', lineHeight: 1.6, minHeight: 160 }}>
        {chatHistory.length === 0 && (
          <div style={{ color: C.muted }}>Ask about projects, experience, skills, or availability. Try a /command above.</div>
        )}
        {chatHistory.map((m, i) => (
          <div key={i} style={{ color: m.role === 'user' ? C.ink : C.ink2, whiteSpace: 'pre-wrap' }}>
            <span style={{ color: m.role === 'user' ? C.cyanHex : C.emeraldHex, marginRight: 8 }}>{m.role === 'user' ? '$' : '>'}</span>
            {m.content}
          </div>
        ))}
        {chatThinking && (
          <div style={{ color: C.muted }}>
            <span style={{ color: C.emeraldHex, marginRight: 8 }}>&gt;</span>thinking&hellip;
          </div>
        )}
      </div>

      {/* input row with blinking block cursor */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: `1px solid ${C.border}` }}>
        <span style={{ color: C.cyanHex, fontFamily: C.mono, fontWeight: 700 }}>$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Type a message or /command"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: C.ink, fontFamily: C.mono, fontSize: '0.86rem' }}
        />
        <span style={{ width: 8, height: 16, background: C.emeraldHex, animation: 'termCursor 1s step-end infinite' }} />
        <button onClick={submit} disabled={chatThinking || !input.trim()} style={{
          background: C.gradient, border: 'none', color: '#04140c', fontFamily: C.font, fontWeight: 700,
          fontSize: '0.78rem', padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
          opacity: chatThinking || !input.trim() ? 0.4 : 1,
        }}>Send</button>
      </div>
      <style>{`@keyframes termCursor { 0%,50% { opacity: 1 } 50.01%,100% { opacity: 0 } }`}</style>
    </div>
  )
}
