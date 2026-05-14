import { access, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, resolve } from 'node:path'
import { FileState, GoogleGenAI, type File as GeminiFile } from '@google/genai'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

interface PendingVideo {
  path: string
  mimeType: string
  displayName: string
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
  ['.avi', 'video/avi'],
  ['.flv', 'video/x-flv'],
  ['.mpg', 'video/mpg'],
  ['.webm', 'video/webm'],
  ['.wmv', 'video/wmv'],
  ['.3gp', 'video/3gpp'],
  ['.3gpp', 'video/3gpp']
])

const videoParameterSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      description: 'Path to a local video file, relative to the project root or absolute.'
    },
    startSeconds: {
      type: 'number',
      description: 'Optional start offset in seconds for Gemini video clipping.'
    },
    endSeconds: {
      type: 'number',
      description: 'Optional end offset in seconds for Gemini video clipping.'
    },
    fps: {
      type: 'number',
      description: 'Optional frame sampling rate for Gemini video processing, such as 1 or 5.'
    }
  }
} as const

interface ViewVideoParams {
  path: string
  startSeconds?: number
  endSeconds?: number
  fps?: number
}

export function createPiVideoViewExtension(): ExtensionFactory {
  const pendingBySessionId = new Map<string, PendingVideo[]>()

  return (pi) => {
    pi.registerTool({
      name: 'view_video',
      label: 'View video',
      description:
        'View a local video file natively with Gemini on the next reasoning turn. Use this when visual or audio details from footage are needed.',
      promptSnippet: 'view_video: View a local video file natively with Gemini.',
      promptGuidelines: [
        'Use view_video when you need to inspect footage directly; the video will be available on the next model turn.'
      ],
      parameters: videoParameterSchema,
      executionMode: 'sequential',
      async execute(_toolCallId, params: ViewVideoParams, _signal, _onUpdate, ctx) {
        const filePath = await resolveVideoPath(ctx.cwd, params.path)
        const mimeType = mimeTypeForVideoPath(filePath)
        validateVideoOptions(params)

        const pendingVideo: PendingVideo = {
          path: filePath,
          mimeType,
          displayName: basename(filePath),
          ...(params.startSeconds !== undefined ? { startSeconds: params.startSeconds } : {}),
          ...(params.endSeconds !== undefined ? { endSeconds: params.endSeconds } : {}),
          ...(params.fps !== undefined ? { fps: params.fps } : {})
        }

        const sessionId = ctx.sessionManager.getSessionId()
        pendingBySessionId.set(sessionId, [
          ...(pendingBySessionId.get(sessionId) ?? []),
          pendingVideo
        ])

        return {
          content: [
            {
              type: 'text',
              text: `Viewing ${pendingVideo.displayName}`
            }
          ],
          details: {
            path: pendingVideo.path,
            mimeType: pendingVideo.mimeType,
            startSeconds: pendingVideo.startSeconds,
            endSeconds: pendingVideo.endSeconds,
            fps: pendingVideo.fps
          }
        }
      }
    })

    pi.on('before_provider_request', async (event, ctx) => {
      if (ctx.model?.api !== 'google-generative-ai') {
        return undefined
      }

      const sessionId = ctx.sessionManager.getSessionId()
      const pendingVideos = pendingBySessionId.get(sessionId)
      if (!pendingVideos?.length) {
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
        for (const video of pendingVideos) {
          const uploaded = await uploadAndWaitForVideo(ai, video, signal)
          uploadedParts.push(filePartForVideo(uploaded, video))
        }
      } catch (error) {
        console.error('[pi-video:view_video:uploadFailed]', {
          sessionId,
          error
        })
        throw error
      }

      appendVideoUserTurnAfterToolResult(payload, uploadedParts)
      pendingBySessionId.delete(sessionId)
      return payload
    })

    pi.on('agent_end', (_event, ctx) => {
      if (!ctx.hasPendingMessages()) {
        pendingBySessionId.delete(ctx.sessionManager.getSessionId())
      }
    })
  }
}

async function resolveVideoPath(cwd: string, inputPath: string): Promise<string> {
  const trimmed = inputPath.trim()
  if (!trimmed) {
    throw new Error('Video path is required')
  }

  const filePath = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed)
  await access(filePath)

  const stats = await stat(filePath)
  if (!stats.isFile()) {
    throw new Error(`Video path is not a file: ${filePath}`)
  }

  mimeTypeForVideoPath(filePath)
  return filePath
}

function mimeTypeForVideoPath(filePath: string): string {
  const extension = extname(filePath).toLowerCase()
  const mimeType = supportedVideoMimeTypes.get(extension)
  if (!mimeType) {
    throw new Error(`Unsupported Gemini video file type: ${extension || '(no extension)'}`)
  }
  return mimeType
}

function validateVideoOptions(input: {
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

function appendVideoUserTurnAfterToolResult(
  payload: GeminiPayload,
  videoParts: Array<Record<string, unknown>>
): void {
  const contents = payload.contents
  if (!Array.isArray(contents)) {
    return
  }

  const functionResponseIndex = findLastContentIndex(contents, (part) => {
    return (part as GeminiFunctionResponsePart).functionResponse?.name === 'view_video'
  })

  const insertionIndex = functionResponseIndex >= 0 ? functionResponseIndex + 1 : contents.length
  contents.splice(insertionIndex, 0, {
    role: 'user',
    parts: [
      {
        text: 'Video attached from the view_video tool. Inspect the footage directly now and continue from the tool result.'
      },
      ...videoParts
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

async function uploadAndWaitForVideo(
  ai: GoogleGenAI,
  video: PendingVideo,
  signal: AbortSignal | undefined
): Promise<GeminiFile> {
  throwIfAborted(signal)
  const uploaded = await ai.files.upload({
    file: video.path,
    config: {
      mimeType: video.mimeType,
      displayName: video.displayName
    }
  })

  if (!uploaded.name) {
    throw new Error('Gemini Files API did not return a file name')
  }

  let current = uploaded
  const startedAt = Date.now()
  while (current.state === FileState.PROCESSING || current.state === FileState.STATE_UNSPECIFIED) {
    if (Date.now() - startedAt > 5 * 60 * 1000) {
      throw new Error(`Timed out waiting for Gemini to process ${video.displayName}`)
    }

    await sleep(2000, signal)
    current = await ai.files.get({ name: uploaded.name })
  }

  if (current.state === FileState.FAILED) {
    throw new Error(`Gemini failed to process ${video.displayName}`)
  }

  if (!current.uri) {
    throw new Error('Gemini Files API did not return a file URI')
  }

  return current
}

function filePartForVideo(file: GeminiFile, video: PendingVideo): Record<string, unknown> {
  return {
    fileData: {
      fileUri: file.uri,
      mimeType: file.mimeType ?? video.mimeType
    },
    ...(hasVideoMetadata(video) ? { videoMetadata: videoMetadata(video) } : {})
  }
}

function hasVideoMetadata(video: PendingVideo): boolean {
  return (
    video.startSeconds !== undefined || video.endSeconds !== undefined || video.fps !== undefined
  )
}

function videoMetadata(video: PendingVideo): Record<string, unknown> {
  return {
    ...(video.startSeconds !== undefined ? { startOffset: `${video.startSeconds}s` } : {}),
    ...(video.endSeconds !== undefined ? { endOffset: `${video.endSeconds}s` } : {}),
    ...(video.fps !== undefined ? { fps: video.fps } : {})
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
        reject(new Error('Gemini video upload was aborted'))
      },
      { once: true }
    )
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Gemini video upload was aborted')
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
