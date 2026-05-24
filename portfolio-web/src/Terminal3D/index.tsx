import { lazy, Suspense } from 'react'
import { useTerminal } from './useTerminal'

const Scene3D = lazy(() => import('./Scene3D'))

function SceneLoader() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#05080c', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#39ff7a', fontFamily: 'monospace', letterSpacing: '0.18em' }}>
      [ LOADING 3D ROOM… ]
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
