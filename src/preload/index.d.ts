import { ElectronAPI } from '@electron-toolkit/preload'
import type { PiAgentUiEvent } from '../main/agents/piAgentEvents'
import type { PreviewChangedEvent } from '../shared/contracts/app'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getPathForFile: (file: File) => string
      fileDataUrl: (filePath: string) => Promise<string>
      revealInFolder: (filePath: string) => Promise<void>
      onNavigateSettings: (listener: () => void) => () => void
      onPiAgentEvent: (listener: (event: PiAgentUiEvent) => void) => () => void
      onPreviewChanged: (listener: (event: PreviewChangedEvent) => void) => () => void
    }
  }
}
