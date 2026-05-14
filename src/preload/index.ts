import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { PiAgentUiEvent } from '../main/agents/piAgentEvents'

// Custom APIs for renderer
const api = {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  fileDataUrl: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('app:file-data-url', filePath),
  onNavigateSettings: (listener: () => void): (() => void) => {
    const wrapped = (): void => {
      listener()
    }

    ipcRenderer.on('app:navigate-settings', wrapped)

    return () => {
      ipcRenderer.off('app:navigate-settings', wrapped)
    }
  },
  onPiAgentEvent: (listener: (event: PiAgentUiEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: PiAgentUiEvent): void => {
      listener(payload)
    }

    ipcRenderer.on('pi-agent:event', wrapped)

    return () => {
      ipcRenderer.off('pi-agent:event', wrapped)
    }
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data !== 'rpc:connect') {
    return
  }

  const [serverPort] = event.ports

  if (!serverPort) {
    return
  }

  ipcRenderer.postMessage('rpc:connect', null, [serverPort])
})

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
