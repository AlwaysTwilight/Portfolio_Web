import { lazy, Suspense } from 'react'
import { useTerminal } from './useTerminal'

const Scene3D = lazy(() => import('./Scene3D'))

function SceneLoader() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0b0d', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fafafa', fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif", fontWeight: 600, letterSpacing: '0.02em' }}>
      Loading 3D room…
    </div>
  )
}

interface Props {
  onExitTerminal: () => void
}

export default function Terminal3D({ onExitTerminal }: Props) {
  const { portfolio, chatHistory, chatThinking, sendChat } = useTerminal()

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Suspense fallback={<SceneLoader />}>
        <Scene3D
          portfolio={portfolio}
          chatHistory={chatHistory}
          chatThinking={chatThinking}
          sendChat={sendChat}
          onExitClassic={onExitTerminal}
        />
      </Suspense>
    </div>
  )
}
