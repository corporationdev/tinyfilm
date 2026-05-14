import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import {
  transcribeFile,
  type TranscriptionGranularity,
  type TranscriptionResult
} from '../assets/assetIndexer'
import { recordPreviewClip } from '../hyperframes/previewRecorder'

const execFileAsync = promisify(execFile)
const previewSource = 'preview'

const transcribeParameterSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source'],
  properties: {
    source: {
      type: 'string',
      description:
        'Media source to transcribe. Use "preview" for the active Tinyfilm preview, or provide a local audio/video file path relative to the project root or absolute.'
    },
    startSeconds: {
      type: 'number',
      description:
        'Optional start offset in seconds. Returned timestamps remain relative to the original source/preview timeline.'
    },
    endSeconds: {
      type: 'number',
      description:
        'Optional end offset in seconds. Must be greater than startSeconds when both are provided.'
    },
    granularity: {
      type: 'string',
      enum: ['word', 'segment'],
      description:
        'Transcript timestamp detail. Defaults to "word", which is best for captions. Use "segment" for smaller rough transcripts.'
    }
  }
} as const

interface TranscribeMediaParams {
  source: string
  startSeconds?: number
  endSeconds?: number
  granularity?: TranscriptionGranularity
}

type TranscriptArtifact = {
  version: 1
  source: string
  sourcePath?: string
  createdAt: string
  granularity: TranscriptionGranularity
  range: {
    startMs: number
    endMs: number | null
  }
  staleWarning: string
  language?: string
  languageProbability?: number
  segments: TranscriptionResult['segments']
}

export function createPiTranscribeMediaExtension(): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: 'transcribe_media',
      label: 'Transcribe media',
      description:
        'Transcribe an audio/video file or the active Tinyfilm preview and save the transcript JSON under .tinyfilm/transcripts. Use this for captions and timestamped transcript data.',
      promptSnippet:
        'transcribe_media: Transcribe an audio/video file or "preview" to .tinyfilm/transcripts/*.json. Defaults to word-level timestamps for captions.',
      promptGuidelines: [
        'Use transcribe_media when you need transcript/caption data, not when you need visual inspection.',
        'Use source "preview" to transcribe the current rendered Tinyfilm preview after edits.',
        'The tool saves a timestamped JSON artifact and returns its path. Preview transcripts are snapshots; regenerate after edits that affect timing or audio.',
        'Returned transcript timestamps are relative to the original source or preview timeline, even when startSeconds is nonzero.'
      ],
      parameters: transcribeParameterSchema,
      executionMode: 'sequential',
      async execute(_toolCallId, params: TranscribeMediaParams, _signal, _onUpdate, ctx) {
        validateTranscribeOptions(params)
        const granularity = params.granularity ?? 'word'
        const resolved = await resolveTranscriptionSource(ctx.cwd, params)

        try {
          const transcript = await transcribeFile(resolved.path, {
            granularity,
            offsetMs: Math.round((params.startSeconds ?? 0) * 1000)
          })
          const artifact = await writeTranscriptArtifact(ctx.cwd, {
            version: 1,
            source: params.source.trim(),
            ...(resolved.sourcePath ? { sourcePath: relative(ctx.cwd, resolved.sourcePath) } : {}),
            createdAt: new Date().toISOString(),
            granularity,
            range: {
              startMs: Math.round((params.startSeconds ?? 0) * 1000),
              endMs: params.endSeconds === undefined ? null : Math.round(params.endSeconds * 1000)
            },
            staleWarning:
              params.source.trim() === previewSource
                ? 'This transcript is a snapshot of the preview at creation time. Regenerate after edits that affect timing or audio.'
                : 'This transcript is a snapshot of the source media at creation time.',
            language: transcript.language,
            languageProbability: transcript.languageProbability,
            segments: transcript.segments
          })
          const wordCount = transcript.segments.reduce((count, segment) => {
            return (
              count + (segment.words?.length ?? segment.text.split(/\s+/).filter(Boolean).length)
            )
          }, 0)

          return {
            content: [
              {
                type: 'text',
                text: [
                  `Transcript saved to ${artifact.relativePath}`,
                  `Granularity: ${granularity}`,
                  `Segments: ${transcript.segments.length}`,
                  `Words: ${wordCount}`,
                  'Preview transcripts are snapshots; regenerate after edits that affect timing or audio.'
                ].join('\n')
              }
            ],
            details: {
              source: params.source.trim(),
              transcriptPath: artifact.relativePath,
              absoluteTranscriptPath: artifact.absolutePath,
              granularity,
              segmentCount: transcript.segments.length,
              wordCount,
              startMs: Math.round((params.startSeconds ?? 0) * 1000),
              endMs: params.endSeconds === undefined ? null : Math.round(params.endSeconds * 1000)
            }
          }
        } finally {
          await cleanupResolvedSource(resolved)
        }
      }
    })
  }
}

async function resolveTranscriptionSource(
  cwd: string,
  params: TranscribeMediaParams
): Promise<{ path: string; sourcePath?: string; cleanupDir?: string }> {
  const source = params.source.trim()
  if (!source) {
    throw new Error('Media source is required')
  }

  if (source === previewSource) {
    const recorded = await recordPreviewClip({
      cwd,
      startSeconds: params.startSeconds,
      endSeconds: params.endSeconds
    })
    return {
      path: recorded.path,
      cleanupDir: recorded.cleanupDir
    }
  }

  const filePath = await resolveMediaPath(cwd, source)
  assertTranscribablePath(filePath)

  if (params.startSeconds === undefined && params.endSeconds === undefined) {
    return {
      path: filePath,
      sourcePath: filePath
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'tinyfilm-transcribe-media-'))
  const clippedPath = join(tempDir, `clip${audioExtensionForSource(filePath)}`)
  await extractAudioClip(filePath, clippedPath, params)

  return {
    path: clippedPath,
    sourcePath: filePath,
    cleanupDir: tempDir
  }
}

async function resolveMediaPath(cwd: string, inputPath: string): Promise<string> {
  const trimmed = inputPath.trim()
  if (!trimmed) {
    throw new Error('Media path is required')
  }

  const filePath = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed)
  if (!existsSync(filePath)) {
    throw new Error(`Media path does not exist: ${filePath}`)
  }

  return filePath
}

async function extractAudioClip(
  inputPath: string,
  outputPath: string,
  params: Pick<TranscribeMediaParams, 'startSeconds' | 'endSeconds'>
): Promise<void> {
  const ffmpegPath = resolveFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg executable was not found. Install ffmpeg to transcribe time ranges.')
  }

  await execFileAsync(
    ffmpegPath,
    [
      '-y',
      ...(params.startSeconds !== undefined ? ['-ss', String(params.startSeconds)] : []),
      '-i',
      inputPath,
      ...(params.endSeconds !== undefined
        ? ['-t', String(params.endSeconds - (params.startSeconds ?? 0))]
        : []),
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      outputPath
    ],
    { maxBuffer: 1024 * 1024 * 20 }
  )
}

async function writeTranscriptArtifact(
  cwd: string,
  artifact: TranscriptArtifact
): Promise<{ absolutePath: string; relativePath: string }> {
  const transcriptsDir = join(cwd, '.tinyfilm', 'transcripts')
  await mkdir(transcriptsDir, { recursive: true })
  const sourceName =
    artifact.source === previewSource ? 'preview' : basename(artifact.sourcePath ?? artifact.source)
  const fileName = `${slugify(sourceName)}-${slugify(artifact.createdAt)}.json`
  const absolutePath = join(transcriptsDir, fileName)
  const tempPath = `${absolutePath}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  await rename(tempPath, absolutePath)

  return {
    absolutePath,
    relativePath: relative(cwd, absolutePath)
  }
}

async function cleanupResolvedSource(resolved: { cleanupDir?: string }): Promise<void> {
  if (!resolved.cleanupDir) {
    return
  }

  await rm(resolved.cleanupDir, { recursive: true, force: true })
}

function validateTranscribeOptions(input: TranscribeMediaParams): void {
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

  if (
    input.granularity !== undefined &&
    input.granularity !== 'word' &&
    input.granularity !== 'segment'
  ) {
    throw new Error('granularity must be "word" or "segment"')
  }
}

function assertTranscribablePath(filePath: string): void {
  const extension = extname(filePath).toLowerCase()
  if (
    ![
      '.mp4',
      '.mov',
      '.m4v',
      '.webm',
      '.avi',
      '.mkv',
      '.mp3',
      '.wav',
      '.m4a',
      '.aac',
      '.flac',
      '.ogg'
    ].includes(extension)
  ) {
    throw new Error(`Unsupported transcription media file type: ${extension || '(no extension)'}`)
  }
}

function audioExtensionForSource(filePath: string): string {
  const extension = extname(filePath).toLowerCase()
  return extension === '.wav' ? '.wav' : '.m4a'
}

function resolveFfmpegPath(): string | null {
  const candidates = [
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/usr/local/opt/ffmpeg-full/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    'ffmpeg'
  ]

  for (const candidate of candidates) {
    try {
      if (candidate.includes('/')) {
        if (existsSync(candidate)) {
          return candidate
        }
        continue
      }

      return candidate
    } catch {
      // Try the next common install location.
    }
  }

  return null
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'transcript'
}
