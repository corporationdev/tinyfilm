import { ElectronAPI } from '@electron-toolkit/preload'
import type { PiAgentUiEvent } from '../main/agents/piAgentEvents'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getPathForFile: (file: File) => string
      onNavigateSettings: (listener: () => void) => () => void
      onPiAgentEvent: (listener: (event: PiAgentUiEvent) => void) => () => void
    }
  }
}
