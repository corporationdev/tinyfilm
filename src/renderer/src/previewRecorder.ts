import '@hyperframes/player'

type StartMessage = {
  id: string
  startSeconds?: number
  endSeconds?: number
  fps?: number
}

type HyperframesPlayerElement = HTMLElement & {
  currentTime: number
  duration: number
  muted: boolean
  ready: boolean
  pause: () => void
  play: () => void
  seek: (timeInSeconds: number) => void
}

const params = new URLSearchParams(window.location.search)
const id = params.get('id') ?? ''
const previewUrl = params.get('previewUrl') ?? ''

if (!id || !previewUrl) {
  throw new Error('Preview recorder requires id and previewUrl query params')
}

const player = document.createElement('hyperframes-player') as HyperframesPlayerElement
player.setAttribute('autoplay', 'false')
player.setAttribute('controls', 'false')
player.setAttribute('muted', 'false')
player.style.display = 'block'
player.style.width = '100vw'
player.style.height = '100vh'
player.style.background = '#000'

document.documentElement.style.width = '100%'
document.documentElement.style.height = '100%'
document.documentElement.style.margin = '0'
document.documentElement.style.overflow = 'hidden'
document.body.style.width = '100%'
document.body.style.height = '100%'
document.body.style.margin = '0'
document.body.style.overflow = 'hidden'
document.body.style.background = '#000'
document.getElementById('root')?.append(player)

void loadPreview()

window.electron.ipcRenderer.on('preview-recorder:start', (_event, message: StartMessage) => {
  if (message.id !== id) {
    return
  }

  void recordPreview(message)
})

send('preview-recorder:ready', { id })

async function loadPreview(): Promise<void> {
  try {
    progress('preview-html-fetch-start', { previewUrl })
    const response = await fetch(previewUrl)
    if (!response.ok) {
      throw new Error(`Preview HTML failed to load: ${response.status} ${response.statusText}`)
    }

    const html = await response.text()
    progress('preview-html-fetch-complete', { bytes: html.length })
    player.setAttribute('srcdoc', withBaseElement(html, previewUrl))
  } catch (error) {
    send('preview-recorder:error', {
      id,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
  }
}

async function recordPreview(input: StartMessage): Promise<void> {
  try {
    progress('wait-for-player-ready-start')
    await waitForPlayerReady(player)
    progress('wait-for-player-ready-complete', { duration: player.duration })

    const startSeconds = input.startSeconds ?? 0
    const endSeconds = input.endSeconds ?? player.duration
    const durationMs = Math.max(0, endSeconds - startSeconds) * 1000
    progress('recording-range', { startSeconds, endSeconds, durationMs, fps: input.fps ?? 30 })

    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error('Preview recording duration must be greater than 0')
    }

    player.muted = false
    player.pause()
    progress('seek-start', { startSeconds })
    player.seek(startSeconds)
    await delay(500)
    progress('seek-complete', { currentTime: player.currentTime })

    progress('get-display-media-start')
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: input.fps ?? 30 },
      audio: true
    })
    progress('get-display-media-complete', {
      videoTracks: stream.getVideoTracks().length,
      audioTracks: stream.getAudioTracks().length
    })

    try {
      const mimeType = chooseRecorderMimeType()
      progress('media-recorder-create', { mimeType })
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
          progress('dataavailable', { size: event.data.size, chunkCount: chunks.length })
        }
      })

      const stopped = new Promise<void>((resolveStop, rejectStop) => {
        recorder.addEventListener('stop', () => resolveStop(), { once: true })
        recorder.addEventListener('error', (event) => rejectStop(event), { once: true })
      })

      progress('media-recorder-start')
      recorder.start(250)
      progress('player-play')
      player.play()
      await delay(durationMs)
      progress('player-pause')
      player.pause()
      progress('media-recorder-stop')
      recorder.stop()
      await stopped
      progress('media-recorder-stopped', { chunkCount: chunks.length, mimeType: recorder.mimeType })

      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
      progress('blob-created', { size: blob.size, type: blob.type })
      send('preview-recorder:complete', {
        id,
        base64: await blobToBase64(blob),
        mimeType: blob.type || 'video/webm'
      })
    } finally {
      progress('stream-stop-start')
      for (const track of stream.getTracks()) {
        track.stop()
      }
      progress('stream-stop-complete')
    }
  } catch (error) {
    send('preview-recorder:error', {
      id,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
  }
}

function chooseRecorderMimeType(): string | undefined {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
}

async function waitForPlayerReady(playerElement: HyperframesPlayerElement): Promise<void> {
  await customElements.whenDefined('hyperframes-player')

  if (playerElement.ready) {
    return
  }

  await new Promise<void>((resolveReady, rejectReady) => {
    const timeout = window.setTimeout(() => {
      rejectReady(new Error('Timed out waiting for HyperFrames preview to become ready'))
    }, 30000)

    playerElement.addEventListener(
      'ready',
      () => {
        window.clearTimeout(timeout)
        resolveReady()
      },
      { once: true }
    )

    playerElement.addEventListener(
      'error',
      (event) => {
        window.clearTimeout(timeout)
        const detail = event instanceof CustomEvent ? JSON.stringify(event.detail) : 'no detail'
        rejectReady(new Error(`HyperFrames preview failed to load: ${detail}`))
      },
      { once: true }
    )
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolveBase64, rejectBase64) => {
    const reader = new FileReader()
    reader.addEventListener('error', () => rejectBase64(reader.error))
    reader.addEventListener('loadend', () => {
      const result = reader.result
      if (typeof result !== 'string') {
        rejectBase64(new Error('Preview recording did not produce a data URL'))
        return
      }

      resolveBase64(result.replace(/^data:.*?;base64,/, ''))
    })
    reader.readAsDataURL(blob)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => window.setTimeout(resolveDelay, ms))
}

function progress(phase: string, details?: Record<string, unknown>): void {
  send('preview-recorder:progress', { id, phase, details: details ?? {} })
}

function send(channel: string, payload: unknown): void {
  window.electron.ipcRenderer.send(channel, payload)
}

function withBaseElement(html: string, baseUrl: string): string {
  const base = `<base href="${escapeHtmlAttribute(baseUrl)}" />`

  if (/<base\b/i.test(html)) {
    return html
  }

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n    ${base}`)
  }

  return `${base}\n${html}`
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
