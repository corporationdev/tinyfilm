import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { is } from '@electron-toolkit/utils'
import { resolvePreviewRequestPath, servePreviewFile } from './previewServer'

export async function recordPreviewClip(input: {
  cwd: string
  startSeconds?: number
  endSeconds?: number
  fps?: number
  signal?: AbortSignal
}): Promise<{ path: string; cleanupDir: string; displayName: string; mimeType: string }> {
  const startedAt = Date.now()
  log('start', {
    cwd: input.cwd,
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
    fps: input.fps
  })
  throwIfAborted(input.signal)

  const tempDir = await mkdtemp(join(tmpdir(), 'tinyfilm-preview-recording-'))
  const outputPath = join(tempDir, displayNameForPreviewClip(input))
  const server = await startPreviewStaticServer(input.cwd)
  log('static-server-ready', { url: server.url, tempDir, outputPath })
  const id = `preview-recorder-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const partition = `tinyfilm-${id}`
  const window = new BrowserWindow({
    width: 1080,
    height: 1920,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition
    }
  })

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    log('browser-console', { level, message, line, sourceId })
  })

  window.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    log('display-media-request', {
      securityOrigin: request.securityOrigin,
      videoRequested: request.videoRequested,
      audioRequested: request.audioRequested,
      hasFrame: Boolean(request.frame),
      userGesture: request.userGesture
    })

    if (!request.frame || !request.videoRequested) {
      log('display-media-denied', { reason: 'missing frame or video request' })
      callback({})
      return
    }

    callback({
      video: request.frame,
      ...(request.audioRequested ? { audio: request.frame } : {})
    })
    log('display-media-granted', { audio: request.audioRequested })
  })

  try {
    const recording = waitForRecording(window, id)
    log('window-load-start')
    await window.loadURL(recorderPageUrl(id, server.url))
    log('window-load-complete')
    throwIfAborted(input.signal)

    await recording.ready
    log('record-in-window-start')
    window.webContents.send('preview-recorder:start', {
      id,
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
      fps: input.fps
    })
    const result = await recording.complete
    await writeFile(outputPath, Buffer.from(result.base64, 'base64'))
    log('recording-file-written', {
      outputPath,
      sizeBytes: statSync(outputPath).size,
      mimeType: result.mimeType
    })
    const sizeBytes = existsSync(outputPath) ? statSync(outputPath).size : 0
    log('record-in-window-complete', { outputPath, sizeBytes, elapsedMs: Date.now() - startedAt })

    return {
      path: outputPath,
      cleanupDir: tempDir,
      displayName: displayNameForPreviewClip(input),
      mimeType: 'video/webm'
    }
  } catch (error) {
    log('failed', {
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error
    })
    await rm(tempDir, { recursive: true, force: true })
    throw error
  } finally {
    log('cleanup-start')
    window.destroy()
    await close(server.server)
    log('cleanup-complete', { elapsedMs: Date.now() - startedAt })
  }
}

function recorderPageUrl(id: string, previewUrl: string): string {
  const params = new URLSearchParams({ id, previewUrl })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/preview-recorder.html?${params.toString()}`
  }

  return `file://${join(__dirname, '../renderer/preview-recorder.html')}?${params.toString()}`
}

function waitForRecording(
  window: BrowserWindow,
  id: string
): {
  ready: Promise<void>
  complete: Promise<{ base64: string; mimeType: string }>
} {
  let cleanup = (): void => {}

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      rejectReady(new Error('Timed out waiting for preview recorder page to become ready'))
    }, 30000)

    const onReady = (event: IpcMainEvent, payload: unknown): void => {
      if (!isRecorderPayload(payload, id) || event.sender.id !== window.webContents.id) {
        return
      }

      clearTimeout(timeout)
      log('renderer-ready')
      ipcMain.off('preview-recorder:ready', onReady)
      resolveReady()
    }

    ipcMain.on('preview-recorder:ready', onReady)
  })

  const complete = new Promise<{ base64: string; mimeType: string }>(
    (resolveComplete, rejectComplete) => {
      const onProgress = (event: IpcMainEvent, payload: unknown): void => {
        if (!isRecorderPayload(payload, id) || event.sender.id !== window.webContents.id) {
          return
        }

        const progress = payload as { phase?: unknown; details?: unknown }
        log(`renderer:${String(progress.phase ?? 'progress')}`, asDetails(progress.details))
      }

      const onComplete = (event: IpcMainEvent, payload: unknown): void => {
        if (!isRecorderPayload(payload, id) || event.sender.id !== window.webContents.id) {
          return
        }

        cleanup()
        const result = payload as { base64?: unknown; mimeType?: unknown }
        if (typeof result.base64 !== 'string') {
          rejectComplete(new Error('Preview recorder completed without base64 media data'))
          return
        }

        resolveComplete({
          base64: result.base64,
          mimeType: typeof result.mimeType === 'string' ? result.mimeType : 'video/webm'
        })
      }

      const onError = (event: IpcMainEvent, payload: unknown): void => {
        if (!isRecorderPayload(payload, id) || event.sender.id !== window.webContents.id) {
          return
        }

        cleanup()
        const error = payload as { message?: unknown; stack?: unknown }
        const message =
          typeof error.message === 'string' ? error.message : 'Preview recorder failed'
        const wrapped = new Error(message)
        if (typeof error.stack === 'string') {
          wrapped.stack = error.stack
        }
        rejectComplete(wrapped)
      }

      const onDestroyed = (): void => {
        cleanup()
        rejectComplete(new Error('Preview recorder window was destroyed before completion'))
      }

      cleanup = (): void => {
        ipcMain.off('preview-recorder:progress', onProgress)
        ipcMain.off('preview-recorder:complete', onComplete)
        ipcMain.off('preview-recorder:error', onError)
        window.webContents.off('destroyed', onDestroyed)
      }

      ipcMain.on('preview-recorder:progress', onProgress)
      ipcMain.on('preview-recorder:complete', onComplete)
      ipcMain.on('preview-recorder:error', onError)
      window.webContents.once('destroyed', onDestroyed)
    }
  )

  return { ready, complete }
}

function isRecorderPayload(payload: unknown, id: string): payload is { id: string } {
  return Boolean(payload && typeof payload === 'object' && (payload as { id?: unknown }).id === id)
}

function asDetails(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

async function startPreviewStaticServer(cwd: string): Promise<{
  url: string
  server: Server
}> {
  const rootPath = resolve(cwd)
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Accept-Ranges, Content-Length, Content-Range'
    )

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405)
      response.end('Method not allowed')
      return
    }

    const filePath = resolvePreviewRequestPath(rootPath, 'index.html', request.url ?? '/')
    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    const stats = statSync(filePath)
    const resolvedFilePath = stats.isDirectory() ? join(filePath, 'index.html') : filePath

    if (!existsSync(resolvedFilePath) || !statSync(resolvedFilePath).isFile()) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    servePreviewFile(request, response, resolvedFilePath)
  })

  const port = await listen(server)
  return {
    url: `http://127.0.0.1:${port}/index.html`,
    server
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()

      if (typeof address === 'object' && address !== null) {
        resolvePort(address.port)
        return
      }

      reject(new Error('Unable to start preview recording server'))
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolveClose()
    })
  })
}

function displayNameForPreviewClip(input: { startSeconds?: number; endSeconds?: number }): string {
  const start = input.startSeconds ?? 0
  const end = input.endSeconds

  if (end === undefined) {
    return `preview-from-${formatSecondsForName(start)}s.webm`
  }

  return `preview-${formatSecondsForName(start)}s-${formatSecondsForName(end)}s.webm`
}

function formatSecondsForName(seconds: number): string {
  return String(seconds).replace(/\./g, '_')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Preview recording was aborted')
  }
}

function log(phase: string, details?: Record<string, unknown>): void {
  console.log('[tinyfilm-preview-recorder]', phase, details ?? {})
}
