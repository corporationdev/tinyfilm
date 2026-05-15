import { BrowserWindow } from 'electron'
import type { PiAgentChat, PiAgentTranscriptItem } from '../../shared/contracts/app'

export type PiAgentUiEvent =
  | {
      type: 'chatUpdated'
      projectId: string
      chat: PiAgentChat
    }
  | {
      type: 'transcriptUpdated'
      projectId: string
      sessionId: string
      transcript: PiAgentTranscriptItem[]
    }
  | {
      type: 'runState'
      projectId: string
      sessionId: string
      status: PiAgentChat['status']
      error?: string
    }

const channel = 'pi-agent:event'

export function emitPiAgentEvent(event: PiAgentUiEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, event)
  }
}

export const piAgentEventChannel = channel
