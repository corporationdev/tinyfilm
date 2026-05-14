import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
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
