import { access, rm, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, resolve } from 'node:path'
import { FileState, GoogleGenAI, type File as GeminiFile } from '@google/genai'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { recordPreviewClip } from '../hyperframes/previewRecorder'

type MediaKind = 'video' | 'audio' | 'image'

interface PendingMedia {
  path: string
  mimeType: string
  displayName: string
  source: string
  kind: MediaKind
  cleanupDir?: string
  startSeconds?: number
  endSeconds?: number
  fps?: number
}

type GeminiPayload = {
  contents?: Array<{
    role?: string
    parts?: Array<Record<string, unknown>>
  }>
}

type GeminiFunctionResponsePart = {
  functionResponse?: {
    name?: string
    response?: Record<string, unknown>
    parts?: Array<Record<string, unknown>>
  }
}

const supportedVideoMimeTypes = new Map<string, string>([
  ['.mp4', 'video/mp4'],
  ['.mpeg', 'video/mpeg'],
  ['.mov', 'video/mov'],
  ['.m4v', 'video/mp4'],
  ['.avi', 'video/avi'],
  ['.mkv', 'video/x-matroska'],
  ['.flv', 'video/x-flv'],
  ['.mpg', 'video/mpg'],
  ['.webm', 'video/webm'],
  ['.wmv', 'video/wmv'],
  ['.3gp', 'video/3gpp'],
  ['.3gpp', 'video/3gpp']
])

const supportedAudioMimeTypes = new Map<string, string>([
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.aiff', 'audio/aiff'],
  ['.aif', 'audio/aiff'],
  ['.aac', 'audio/aac'],
  ['.ogg', 'audio/ogg'],
  ['.oga', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4']
])

const supportedImageMimeTypes = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif']
])

const previewSource = 'preview'

const mediaParameterSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source'],
  properties: {
    source: {
      type: 'string',
      description:
        'Media source to inspect. Use "preview" for the active Tinyfilm preview video, or provide a local image, audio, or video file path relative to the project root or absolute.'
    },
    startSeconds: {
      type: 'number',
      description:
        'Optional start offset in seconds for video files or the active preview. Ignored for image and audio files.'
    },
    endSeconds: {
      type: 'number',
      description:
        'Optional end offset in seconds for video files or the active preview. Ignored for image and audio files.'
    },
    fps: {
      type: 'number',
      description:
        'Optional frame sampling rate for video files or the active preview, such as 1 or 5. Ignored for image and audio files.'
    }
  }
} as const

interface ViewMediaParams {
  source: string
  startSeconds?: number
  endSeconds?: number
  fps?: number
}

export function createPiMediaViewExtension(): ExtensionFactory {
  const pendingBySessionId = new Map<string, PendingMedia[]>()

  return (pi) => {
    pi.registerTool({
      name: 'view_media',
      label: 'View media',
      description:
        'Attach a project media file directly to the next Gemini reasoning turn. The source is auto-detected from the file type and may be an image, audio file, video file, or "preview" for the active Tinyfilm preview video.',
      promptSnippet:
        'view_media: Attach media directly to Gemini context. Set source to "preview" for the active Tinyfilm preview video, or to a local image, audio, or video file path.',
      promptGuidelines: [
        'Use view_media only when you need to inspect the actual media contents, not merely list or reference an asset path.',
        'Use source "preview" when the user asks about the current or active Tinyfilm preview; preview is always treated as video.',
        'Use a local path when the user asks about an imported image, audio, or video asset. The tool detects the media type from the file extension.',
        'For long video files, prefer a short segment with startSeconds/endSeconds/fps before inspecting the whole file.'
      ],
      parameters: mediaParameterSchema,
      executionMode: 'sequential',
      async execute(_toolCallId, params: ViewMediaParams, _signal, _onUpdate, ctx) {
        validateMediaOptions(params)
        const resolvedMedia = await resolveMediaSource(ctx.cwd, params)

        const pendingMedia: PendingMedia = {
          path: resolvedMedia.path,
          mimeType: resolvedMedia.mimeType,
          displayName: resolvedMedia.displayName,
          kind: resolvedMedia.kind,
          source: params.source,
          ...(resolvedMedia.cleanupDir ? { cleanupDir: resolvedMedia.cleanupDir } : {}),
          ...(resolvedMedia.useGeminiVideoMetadata && params.startSeconds !== undefined
            ? { startSeconds: params.startSeconds }
            : {}),
          ...(resolvedMedia.useGeminiVideoMetadata && params.endSeconds !== undefined
            ? { endSeconds: params.endSeconds }
            : {}),
          ...(resolvedMedia.useGeminiVideoMetadata && params.fps !== undefined
            ? { fps: params.fps }
            : {})
        }

        const sessionId = ctx.sessionManager.getSessionId()
        pendingBySessionId.set(sessionId, [
          ...(pendingBySessionId.get(sessionId) ?? []),
          pendingMedia
        ])

        return {
          content: [
            {
              type: 'text',
              text: `Viewing ${pendingMedia.displayName}`
            }
          ],
          details: {
            source: pendingMedia.source,
            path: pendingMedia.path,
            kind: pendingMedia.kind,
            mimeType: pendingMedia.mimeType,
            startSeconds: pendingMedia.startSeconds,
            endSeconds: pendingMedia.endSeconds,
            fps: pendingMedia.fps
          }
        }
      }
    })

    pi.on('before_provider_request', async (event, ctx) => {
      if (ctx.model?.api !== 'google-generative-ai') {
        return undefined
      }

      const sessionId = ctx.sessionManager.getSessionId()
      const pendingMedia = pendingBySessionId.get(sessionId)
      if (!pendingMedia?.length) {
        return undefined
      }

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)
      if (!auth.ok) {
        throw new Error(auth.error)
      }
      if (!auth.apiKey) {
        throw new Error('Gemini Files API upload requires a Gemini API key.')
      }

      const payload = cloneGeminiPayload(event.payload)
      if (!Array.isArray(payload.contents)) {
        return undefined
      }
      normalizeGeminiAbortSignal(payload)

      const ai = new GoogleGenAI({ apiKey: auth.apiKey })

      const uploadedParts: Array<Record<string, unknown>> = []
      try {
        const signal = asAbortSignal(ctx.signal)
        for (const media of pendingMedia) {
          const uploaded = await uploadAndWaitForMedia(ai, media, signal)
          uploadedParts.push(filePartForMedia(uploaded, media))
        }
      } catch (error) {
        console.error('[pi-media:view_media:uploadFailed]', {
          sessionId,
          error
        })
        pendingBySessionId.delete(sessionId)
        await cleanupResolvedMedia(pendingMedia)
        throw error
      }

      appendMediaUserTurnAfterToolResult(payload, uploadedParts)
      pendingBySessionId.delete(sessionId)
      await cleanupResolvedMedia(pendingMedia)
      return payload
    })

    pi.on('agent_end', (_event, ctx) => {
      if (!ctx.hasPendingMessages()) {
        pendingBySessionId.delete(ctx.sessionManager.getSessionId())
      }
    })
  }
}

type ResolvedMediaSource = {
  path: string
  mimeType: string
  displayName: string
  kind: MediaKind
  cleanupDir?: string
  useGeminiVideoMetadata: boolean
}

async function resolveMediaSource(
  cwd: string,
  params: ViewMediaParams
): Promise<ResolvedMediaSource> {
  const source = params.source.trim()
  if (!source) {
    throw new Error('Media source is required')
  }

  if (source === previewSource) {
    const recorded = await recordPreviewClip({
      cwd,
      startSeconds: params.startSeconds,
      endSeconds: params.endSeconds,
      fps: params.fps
    })
    return {
      ...recorded,
      kind: 'video',
      useGeminiVideoMetadata: false
    }
  }

  const filePath = await resolveMediaPath(cwd, source)
  const mediaType = mediaTypeForPath(filePath)
  return {
    path: filePath,
    mimeType: mediaType.mimeType,
    displayName: basename(filePath),
    kind: mediaType.kind,
    useGeminiVideoMetadata: mediaType.kind === 'video'
  }
}

async function resolveMediaPath(cwd: string, inputPath: string): Promise<string> {
  const trimmed = inputPath.trim()
  if (!trimmed) {
    throw new Error('Media path is required')
  }

  const filePath = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed)
  await access(filePath)

  const stats = await stat(filePath)
  if (!stats.isFile()) {
    throw new Error(`Media path is not a file: ${filePath}`)
  }

  mediaTypeForPath(filePath)
  return filePath
}

async function cleanupResolvedMedia(mediaItems: PendingMedia[]): Promise<void> {
  await Promise.allSettled(
    Array.from(new Set(mediaItems.map((media) => media.cleanupDir).filter(isString))).map(
      (dir) => {
        return rm(dir, { recursive: true, force: true })
      }
    )
  )
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string'
}

function mediaTypeForPath(filePath: string): { kind: MediaKind; mimeType: string } {
  const extension = extname(filePath).toLowerCase()
  const videoMimeType = supportedVideoMimeTypes.get(extension)
  if (videoMimeType) {
    return { kind: 'video', mimeType: videoMimeType }
  }

  const audioMimeType = supportedAudioMimeTypes.get(extension)
  if (audioMimeType) {
    return { kind: 'audio', mimeType: audioMimeType }
  }

  const imageMimeType = supportedImageMimeTypes.get(extension)
  if (imageMimeType) {
    return { kind: 'image', mimeType: imageMimeType }
  }

  throw new Error(
    `Unsupported Gemini media file type: ${extension || '(no extension)'}. Supported media types are image, audio, and video files.`
  )
}

function validateMediaOptions(input: {
  startSeconds?: number
  endSeconds?: number
  fps?: number
}): void {
  if (input.startSeconds !== undefined && input.startSeconds < 0) {
    throw new Error('startSeconds must be 0 or greater')
  }

  if (input.endSeconds !== undefined && input.endSeconds <= 0) {
    throw new Error('endSeconds must be greater than 0')
  }

  if (
    input.startSeconds !== undefined &&
    input.endSeconds !== undefined &&
    input.endSeconds <= input.startSeconds
  ) {
    throw new Error('endSeconds must be greater than startSeconds')
  }

  if (input.fps !== undefined && input.fps <= 0) {
    throw new Error('fps must be greater than 0')
  }
}

function cloneGeminiPayload(payload: unknown): GeminiPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Gemini provider payload was not an object')
  }

  return structuredClone(payload) as GeminiPayload
}

function normalizeGeminiAbortSignal(payload: GeminiPayload): void {
  const config = (payload as { config?: Record<string, unknown> }).config
  if (!config || !('abortSignal' in config)) {
    return
  }

  if (!asAbortSignal(config.abortSignal)) {
    delete config.abortSignal
  }
}

function appendMediaUserTurnAfterToolResult(
  payload: GeminiPayload,
  mediaParts: Array<Record<string, unknown>>
): void {
  const contents = payload.contents
  if (!Array.isArray(contents)) {
    return
  }

  const functionResponseIndex = findLastContentIndex(contents, (part) => {
    return (part as GeminiFunctionResponsePart).functionResponse?.name === 'view_media'
  })

  const insertionIndex = functionResponseIndex >= 0 ? functionResponseIndex + 1 : contents.length
  contents.splice(insertionIndex, 0, {
    role: 'user',
    parts: [
      {
        text: 'Media attached from the view_media tool. Inspect the media directly now and continue from the tool result.'
      },
      ...mediaParts
    ]
  })
}

function findLastContentIndex(
  contents: NonNullable<GeminiPayload['contents']>,
  predicate: (part: Record<string, unknown>) => boolean
): number {
  for (let contentIndex = contents.length - 1; contentIndex >= 0; contentIndex -= 1) {
    const parts = contents[contentIndex]?.parts
    if (!Array.isArray(parts)) {
      continue
    }

    if (parts.some(predicate)) {
      return contentIndex
    }
  }

  return -1
}

async function uploadAndWaitForMedia(
  ai: GoogleGenAI,
  media: PendingMedia,
  signal: AbortSignal | undefined
): Promise<GeminiFile> {
  throwIfAborted(signal)
  const uploaded = await ai.files.upload({
    file: media.path,
    config: {
      mimeType: media.mimeType,
      displayName: media.displayName
    }
  })

  if (!uploaded.name) {
    throw new Error('Gemini Files API did not return a file name')
  }

  let current = uploaded
  const startedAt = Date.now()
  while (current.state === FileState.PROCESSING || current.state === FileState.STATE_UNSPECIFIED) {
    if (Date.now() - startedAt > 5 * 60 * 1000) {
      throw new Error(`Timed out waiting for Gemini to process ${media.displayName}`)
    }

    await sleep(2000, signal)
    current = await ai.files.get({ name: uploaded.name })
  }

  if (current.state === FileState.FAILED) {
    throw new Error(`Gemini failed to process ${media.displayName}`)
  }

  if (!current.uri) {
    throw new Error('Gemini Files API did not return a file URI')
  }

  return current
}

function filePartForMedia(file: GeminiFile, media: PendingMedia): Record<string, unknown> {
  return {
    fileData: {
      fileUri: file.uri,
      mimeType: file.mimeType ?? media.mimeType
    },
    ...(hasVideoMetadata(media) ? { videoMetadata: videoMetadata(media) } : {})
  }
}

function hasVideoMetadata(media: PendingMedia): boolean {
  return (
    media.kind === 'video' &&
    (media.startSeconds !== undefined || media.endSeconds !== undefined || media.fps !== undefined)
  )
}

function videoMetadata(media: PendingMedia): Record<string, unknown> {
  return {
    ...(media.startSeconds !== undefined ? { startOffset: `${media.startSeconds}s` } : {}),
    ...(media.endSeconds !== undefined ? { endOffset: `${media.endSeconds}s` } : {}),
    ...(media.fps !== undefined ? { fps: media.fps } : {})
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal)
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new Error('Gemini media upload was aborted'))
      },
      { once: true }
    )
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Gemini media upload was aborted')
  }
}

function asAbortSignal(value: unknown): AbortSignal | undefined {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as AbortSignal).aborted === 'boolean' &&
    typeof (value as AbortSignal).addEventListener === 'function'
  ) {
    return value as AbortSignal
  }

  return undefined
}
