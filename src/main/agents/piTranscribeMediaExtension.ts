import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

const execFileAsync = promisify(execFile)
const defaultModel = 'small'
const cacheVersion = 1
const pendingTranscriptions = new Map<string, Promise<TranscribeMediaFileResult>>()

const transcribeParameterSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['filePath'],
  properties: {
    filePath: {
      type: 'string',
      description:
        'Audio/video file path to transcribe. Provide a path relative to the project root or an absolute local path.'
    },
    model: {
      type: 'string',
      description:
        'Whisper model to use. Defaults to "small". Use ".en" models only when the audio is explicitly English.'
    },
    language: {
      type: 'string',
      description:
        'Optional language code such as en, es, or ja. Omit to let Whisper auto-detect with the multilingual model.'
    }
  }
} as const

interface TranscribeMediaParams {
  filePath: string
  model?: string
  language?: string
}

interface TranscriptWord {
  id?: string
  text: string
  start: number
  end: number
}

interface HyperframesTranscribeResult {
  ok: boolean
  error?: string
  model?: string
  wordCount?: number
  durationSeconds?: number
  speechOnsetSeconds?: number | null
  transcriptPath?: string
}

interface TranscriptFingerprint {
  sizeBytes: number
  mtimeMs: number
}

interface TranscriptCacheOptions {
  model: string
  language: string | null
}

interface TranscriptCacheEntry {
  sourcePath: string
  fingerprint: TranscriptFingerprint
  options: TranscriptCacheOptions
  transcriptPath: string
  wordCount: number
  durationSeconds: number | null
  createdAt: string
  updatedAt: string
}

interface TranscriptCacheIndex {
  version: typeof cacheVersion
  entries: TranscriptCacheEntry[]
}

interface TranscribeMediaFileResult {
  cached: boolean
  sourcePath: string
  transcriptPath: string
  absoluteTranscriptPath: string
  model: string
  language: string | null
  wordCount: number
  durationSeconds: number | null
}

export async function prewarmTranscriptionCache(input: {
  cwd: string
  filePath: string
  model?: string
  language?: string
}): Promise<TranscribeMediaFileResult> {
  return transcribeMediaFile(input)
}

export function createPiTranscribeMediaExtension(): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: 'transcribe_media',
      label: 'Transcribe media',
      description:
        'Transcribe an audio/video file with the HyperFrames CLI and save a cached word-level transcript under .tinyfilm/transcripts.',
      promptSnippet:
        'transcribe_media: Transcribe a local audio/video file path to .tinyfilm/transcripts/*.json. Uses HyperFrames and caches by path, size, mtime, model, and language.',
      promptGuidelines: [
        'Use transcribe_media when you need transcript/caption data, not when you need visual inspection.',
        'Pass a concrete media file path. To transcribe a preview, render/export it first and pass that output path.',
        'The tool returns a cached transcript when the same file path, size, mtime, model, and language were already transcribed.',
        'Default model is "small". Use ".en" models only when the audio is explicitly English.'
      ],
      parameters: transcribeParameterSchema,
      executionMode: 'sequential',
      async execute(_toolCallId, params: TranscribeMediaParams, _signal, _onUpdate, ctx) {
        validateTranscribeOptions(params)
        const result = await transcribeMediaFile({
          cwd: ctx.cwd,
          filePath: params.filePath,
          model: params.model,
          language: params.language
        })

        return transcriptToolResult(result)
      }
    })
  }
}

async function transcribeMediaFile(input: {
  cwd: string
  filePath: string
  model?: string
  language?: string
}): Promise<TranscribeMediaFileResult> {
  const filePath = resolveMediaPath(input.cwd, input.filePath)
  assertTranscribablePath(filePath)

  const model = input.model?.trim() || defaultModel
  const language = input.language?.trim() || null
  const sourcePath = sourcePathForCache(input.cwd, filePath)
  const fingerprint = fingerprintFile(filePath)
  const cache = await loadTranscriptCache(input.cwd)
  const cached = findCachedTranscript(cache.index, {
    sourcePath,
    fingerprint,
    options: { model, language }
  })

  if (cached && existsSync(cachePathToAbsolute(input.cwd, cached.transcriptPath))) {
    return {
      cached: true,
      sourcePath,
      transcriptPath: cached.transcriptPath,
      absoluteTranscriptPath: cachePathToAbsolute(input.cwd, cached.transcriptPath),
      model,
      language,
      wordCount: cached.wordCount,
      durationSeconds: cached.durationSeconds
    }
  }

  const pendingKey = transcriptCacheKey({
    sourcePath,
    fingerprint,
    options: { model, language }
  })
  const pending = pendingTranscriptions.get(pendingKey)
  if (pending) {
    return pending
  }

  const promise = transcribeAndCacheMediaFile({
    cwd: input.cwd,
    filePath,
    sourcePath,
    fingerprint,
    options: { model, language }
  }).finally(() => {
    pendingTranscriptions.delete(pendingKey)
  })
  pendingTranscriptions.set(pendingKey, promise)

  return promise
}

async function transcribeAndCacheMediaFile(input: {
  cwd: string
  filePath: string
  sourcePath: string
  fingerprint: TranscriptFingerprint
  options: TranscriptCacheOptions
}): Promise<TranscribeMediaFileResult> {
  const transcribed = await transcribeWithHyperframes(input.cwd, input.filePath, input.options)
  const transcript = await writeCachedTranscript(input.cwd, {
    sourcePath: input.sourcePath,
    fingerprint: input.fingerprint,
    options: input.options,
    words: transcribed.words,
    durationSeconds: transcribed.durationSeconds ?? null
  })
  const cache = await loadTranscriptCache(input.cwd)
  cache.index.entries = upsertCacheEntry(cache.index.entries, transcript.entry)
  await writeTranscriptCacheIndex(cache.indexPath, cache.index)

  return {
    cached: false,
    sourcePath: input.sourcePath,
    transcriptPath: transcript.entry.transcriptPath,
    absoluteTranscriptPath: transcript.absolutePath,
    model: input.options.model,
    language: input.options.language,
    wordCount: transcript.entry.wordCount,
    durationSeconds: transcript.entry.durationSeconds
  }
}

function transcriptCacheKey(input: {
  sourcePath: string
  fingerprint: TranscriptFingerprint
  options: TranscriptCacheOptions
}): string {
  return [
    input.sourcePath,
    input.fingerprint.sizeBytes,
    input.fingerprint.mtimeMs,
    input.options.model,
    input.options.language ?? 'auto'
  ].join('\0')
}

function resolveMediaPath(cwd: string, inputPath: string): string {
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

function validateTranscribeOptions(input: TranscribeMediaParams): void {
  if (!input.filePath?.trim()) {
    throw new Error('filePath is required')
  }

  if (input.model !== undefined && !input.model.trim()) {
    throw new Error('model must not be empty')
  }

  if (input.language !== undefined && !input.language.trim()) {
    throw new Error('language must not be empty')
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

function fingerprintFile(filePath: string): TranscriptFingerprint {
  const stats = statSync(filePath)
  return {
    sizeBytes: stats.size,
    mtimeMs: Math.round(stats.mtimeMs)
  }
}

function sourcePathForCache(cwd: string, filePath: string): string {
  const relativePath = relative(cwd, filePath)

  if (relativePath && !relativePath.startsWith('..') && !relativePath.startsWith(sep)) {
    return normalizePathSeparators(relativePath)
  }

  return normalizePathSeparators(filePath)
}

async function loadTranscriptCache(cwd: string): Promise<{
  index: TranscriptCacheIndex
  indexPath: string
  transcriptsDir: string
}> {
  const transcriptsDir = join(cwd, '.tinyfilm', 'transcripts')
  await mkdir(transcriptsDir, { recursive: true })

  const indexPath = join(transcriptsDir, 'index.json')
  if (!existsSync(indexPath)) {
    return {
      index: { version: cacheVersion, entries: [] },
      indexPath,
      transcriptsDir
    }
  }

  try {
    const parsed = JSON.parse(await readFile(indexPath, 'utf8')) as Partial<TranscriptCacheIndex>
    return {
      index: {
        version: cacheVersion,
        entries: Array.isArray(parsed.entries) ? parsed.entries : []
      },
      indexPath,
      transcriptsDir
    }
  } catch {
    return {
      index: { version: cacheVersion, entries: [] },
      indexPath,
      transcriptsDir
    }
  }
}

function findCachedTranscript(
  index: TranscriptCacheIndex,
  input: {
    sourcePath: string
    fingerprint: TranscriptFingerprint
    options: TranscriptCacheOptions
  }
): TranscriptCacheEntry | null {
  return (
    index.entries.find((entry) => {
      return (
        entry.sourcePath === input.sourcePath &&
        entry.fingerprint.sizeBytes === input.fingerprint.sizeBytes &&
        entry.fingerprint.mtimeMs === input.fingerprint.mtimeMs &&
        entry.options.model === input.options.model &&
        entry.options.language === input.options.language
      )
    }) ?? null
  )
}

async function transcribeWithHyperframes(
  cwd: string,
  filePath: string,
  options: TranscriptCacheOptions
): Promise<HyperframesTranscribeResult & { transcriptPath: string; words: TranscriptWord[] }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'tinyfilm-hyperframes-transcribe-'))
  const executable = resolveHyperframesExecutable(cwd)

  try {
    const { stdout } = await execFileAsync(
      executable.command,
      [
        ...executable.prefixArgs,
        'transcribe',
        filePath,
        '--dir',
        tempDir,
        '--json',
        '--model',
        options.model,
        ...(options.language ? ['--language', options.language] : [])
      ],
      {
        cwd,
        maxBuffer: 1024 * 1024 * 20,
        timeout: 1000 * 60 * 15
      }
    )
    const result = parseHyperframesJson(stdout)

    if (!result.ok) {
      throw new Error(result.error ?? 'HyperFrames transcription failed')
    }

    if (!result.transcriptPath) {
      throw new Error('HyperFrames did not return a transcript path')
    }

    const words = await readTranscriptWords(result.transcriptPath)

    return {
      ...result,
      transcriptPath: result.transcriptPath,
      words
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function resolveHyperframesExecutable(cwd: string): { command: string; prefixArgs: string[] } {
  const localBin = join(
    cwd,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes'
  )
  const repoBin = join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes'
  )

  if (existsSync(localBin)) {
    return { command: localBin, prefixArgs: [] }
  }

  if (existsSync(repoBin)) {
    return { command: repoBin, prefixArgs: [] }
  }

  return {
    command: 'npx',
    prefixArgs: ['--yes', 'hyperframes@0.6.7']
  }
}

function parseHyperframesJson(stdout: string): HyperframesTranscribeResult {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as HyperframesTranscribeResult
    } catch {
      // Keep looking for the JSON status line.
    }
  }

  throw new Error('HyperFrames did not emit machine-readable JSON output')
}

async function readTranscriptWords(transcriptPath: string): Promise<TranscriptWord[]> {
  const parsed = JSON.parse(await readFile(transcriptPath, 'utf8')) as unknown

  if (!Array.isArray(parsed)) {
    throw new Error('HyperFrames transcript output was not a word array')
  }

  return parsed.map((word, index) => normalizeTranscriptWord(word, index))
}

function normalizeTranscriptWord(value: unknown, index: number): TranscriptWord {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid transcript word at index ${index}`)
  }

  const word = value as Partial<TranscriptWord>
  if (typeof word.text !== 'string') {
    throw new Error(`Invalid transcript word text at index ${index}`)
  }

  if (typeof word.start !== 'number' || typeof word.end !== 'number') {
    throw new Error(`Invalid transcript word timing at index ${index}`)
  }

  return {
    id: typeof word.id === 'string' && word.id ? word.id : `w${index}`,
    text: word.text,
    start: word.start,
    end: word.end
  }
}

async function writeCachedTranscript(
  cwd: string,
  input: {
    sourcePath: string
    fingerprint: TranscriptFingerprint
    options: TranscriptCacheOptions
    words: TranscriptWord[]
    durationSeconds: number | null
  }
): Promise<{ absolutePath: string; entry: TranscriptCacheEntry }> {
  const transcriptsDir = join(cwd, '.tinyfilm', 'transcripts')
  await mkdir(transcriptsDir, { recursive: true })

  const fileName = `${slugify(input.sourcePath)}-${slugify(input.options.model)}-${
    input.options.language ? slugify(input.options.language) : 'auto'
  }.json`
  const absolutePath = join(transcriptsDir, fileName)
  const relativePath = normalizePathSeparators(relative(cwd, absolutePath))
  const now = new Date().toISOString()
  const existingCreatedAt = await findExistingCreatedAt(cwd, input, relativePath)
  const tempPath = `${absolutePath}.${Date.now()}.tmp`

  await writeFile(tempPath, `${JSON.stringify(input.words, null, 2)}\n`, 'utf8')
  await rename(tempPath, absolutePath)

  return {
    absolutePath,
    entry: {
      sourcePath: input.sourcePath,
      fingerprint: input.fingerprint,
      options: input.options,
      transcriptPath: relativePath,
      wordCount: input.words.length,
      durationSeconds: input.durationSeconds,
      createdAt: existingCreatedAt ?? now,
      updatedAt: now
    }
  }
}

async function findExistingCreatedAt(
  cwd: string,
  input: {
    sourcePath: string
    options: TranscriptCacheOptions
  },
  transcriptPath: string
): Promise<string | null> {
  const cache = await loadTranscriptCache(cwd)
  return (
    cache.index.entries.find((entry) => {
      return (
        entry.sourcePath === input.sourcePath &&
        entry.transcriptPath === transcriptPath &&
        entry.options.model === input.options.model &&
        entry.options.language === input.options.language
      )
    })?.createdAt ?? null
  )
}

function upsertCacheEntry(
  entries: TranscriptCacheEntry[],
  nextEntry: TranscriptCacheEntry
): TranscriptCacheEntry[] {
  const nextEntries = entries.filter((entry) => {
    return !(
      entry.sourcePath === nextEntry.sourcePath &&
      entry.options.model === nextEntry.options.model &&
      entry.options.language === nextEntry.options.language
    )
  })
  nextEntries.push(nextEntry)
  nextEntries.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
  return nextEntries
}

async function writeTranscriptCacheIndex(
  indexPath: string,
  index: TranscriptCacheIndex
): Promise<void> {
  const tempPath = `${indexPath}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  await rename(tempPath, indexPath)
}

function transcriptToolResult(input: {
  cached: boolean
  sourcePath: string
  transcriptPath: string
  absoluteTranscriptPath: string
  model: string
  language: string | null
  wordCount: number
  durationSeconds: number | null
}): {
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
} {
  return {
    content: [
      {
        type: 'text',
        text: [
          `${input.cached ? 'Cached transcript' : 'Transcript saved'} to ${input.transcriptPath}`,
          `Source: ${input.sourcePath}`,
          `Model: ${input.model}`,
          `Language: ${input.language ?? 'auto'}`,
          `Words: ${input.wordCount}`
        ].join('\n')
      }
    ],
    details: {
      cached: input.cached,
      sourcePath: input.sourcePath,
      transcriptPath: input.transcriptPath,
      absoluteTranscriptPath: input.absoluteTranscriptPath,
      model: input.model,
      language: input.language,
      wordCount: input.wordCount,
      durationSeconds: input.durationSeconds
    }
  }
}

function cachePathToAbsolute(cwd: string, cachePath: string): string {
  return isAbsolute(cachePath) ? cachePath : resolve(cwd, cachePath)
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(extname(basename(value)), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'transcript'
}
