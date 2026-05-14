import { execFile, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, existsSync } from 'node:fs'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import { type ProjectAssetRow, projectAssets } from '../db/schema'

const execFileAsync = promisify(execFile)
const indexVersion = 1

type AssetKind = ProjectAssetRow['type']

interface MediaMetadata {
  durationMs?: number
  width?: number
  height?: number
  mimeType?: string
}

interface TranscriptSegment {
  startMs: number
  endMs: number
  text: string
  words?: TranscriptWord[]
}

interface TranscriptWord {
  startMs: number
  endMs: number
  text: string
}

interface SilenceRange {
  startMs: number
  endMs: number
}

interface AssetIndex {
  version: number
  assetId: string
  kind: AssetKind
  status: 'ready' | 'failed'
  metadata: MediaMetadata
  transcript?: {
    granularity: 'segment'
    segments: TranscriptSegment[]
  }
  silence?: SilenceRange[]
  visual?: {
    contactSheetPath: string
    frameCount: number
  }
  error?: string
}

interface TranscribeResult {
  language?: string
  languageProbability?: number
  segments: TranscriptSegment[]
}

export type TranscriptionGranularity = 'segment' | 'word'

export interface TranscriptionResult {
  language?: string
  languageProbability?: number
  granularity: TranscriptionGranularity
  segments: TranscriptSegment[]
}

type IndexJob = {
  asset: ProjectAssetRow
}

const queue: IndexJob[] = []
let running = false

export function startAssetIndexing(asset: ProjectAssetRow): void {
  queue.push({ asset })
  void drainQueue()
}

export async function indexAssetNow(asset: ProjectAssetRow): Promise<void> {
  const startedAt = Date.now()
  updateAssetIndexState(asset.id, {
    indexStatus: 'pending',
    indexError: null,
    indexUpdatedAt: startedAt
  })

  try {
    const index = await buildAssetIndex(asset)
    await writeAssetIndex(asset, index)
    const metadata = index.metadata
    updateAssetIndexState(asset.id, {
      indexStatus: 'ready',
      indexError: null,
      indexUpdatedAt: Date.now(),
      mimeType: metadata.mimeType ?? null,
      durationMs: metadata.durationMs ?? null,
      width: metadata.width ?? null,
      height: metadata.height ?? null
    })
  } catch (error) {
    const message = shortErrorMessage(error)
    const failedIndex: AssetIndex = {
      version: indexVersion,
      assetId: asset.id,
      kind: asset.type,
      status: 'failed',
      metadata: {},
      error: message
    }

    await writeAssetIndex(asset, failedIndex).catch((writeError) => {
      console.warn('[assets:index:writeFailedIndexFailed]', {
        id: asset.id,
        error: writeError instanceof Error ? writeError.message : writeError
      })
    })

    updateAssetIndexState(asset.id, {
      indexStatus: 'failed',
      indexError: message,
      indexUpdatedAt: Date.now()
    })
    console.warn('[assets:index:failed]', {
      id: asset.id,
      path: asset.assetPath,
      error: message
    })
  }
}

export async function probeMediaMetadata(filePath: string): Promise<MediaMetadata> {
  const ffprobePath = resolveExecutable('ffprobe')
  if (!ffprobePath) {
    throw new Error('ffprobe executable was not found. Install ffmpeg to enable asset indexing.')
  }

  const { stdout } = await execFileAsync(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { maxBuffer: 1024 * 1024 * 20 }
  )
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string }
    streams?: Array<{
      codec_type?: string
      width?: number
      height?: number
      duration?: string
    }>
  }
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video')
  const duration = numberFromString(parsed.format?.duration ?? video?.duration)
  const mimeType = mimeTypeForPath(filePath)

  return {
    ...(duration !== null ? { durationMs: Math.round(duration * 1000) } : {}),
    ...(typeof video?.width === 'number' ? { width: video.width } : {}),
    ...(typeof video?.height === 'number' ? { height: video.height } : {}),
    ...(mimeType ? { mimeType } : {})
  }
}

export async function createImageThumbnail(asset: ProjectAssetRow): Promise<void> {
  if (asset.type !== 'image') {
    return
  }

  await createStillThumbnail(asset.assetPath, join(dirname(asset.assetPath), 'thumbnail.jpg'))
}

export async function createVideoThumbnail(asset: ProjectAssetRow): Promise<void> {
  if (asset.type !== 'video') {
    return
  }

  await createStillThumbnail(
    asset.assetPath,
    join(dirname(asset.assetPath), 'thumbnail.jpg'),
    '0.1'
  )
}

export async function detectSilence(filePath: string): Promise<SilenceRange[]> {
  const ffmpegPath = resolveExecutable('ffmpeg')
  if (!ffmpegPath) {
    throw new Error('ffmpeg executable was not found. Install ffmpeg to enable silence detection.')
  }

  const stderr = await execFileCapturingStderr(ffmpegPath, [
    '-i',
    filePath,
    '-af',
    'silencedetect=noise=-35dB:d=0.45',
    '-f',
    'null',
    '-'
  ])

  return parseSilenceDetect(stderr)
}

export async function transcribeFile(
  filePath: string,
  options: {
    granularity?: TranscriptionGranularity
    offsetMs?: number
  } = {}
): Promise<TranscriptionResult> {
  const pythonPath = resolvePythonExecutable()
  if (!pythonPath) {
    throw new Error(
      'python3 executable was not found. Install Python and faster-whisper to enable transcription.'
    )
  }

  const scriptPath = resolveTranscribeScriptPath()
  const model = process.env['TINYFILM_WHISPER_MODEL'] ?? 'base'
  const granularity = options.granularity ?? 'segment'
  const { stdout } = await execFileAsync(
    pythonPath,
    [
      scriptPath,
      '--input',
      filePath,
      '--model',
      model,
      ...(granularity === 'word' ? ['--word-timestamps'] : [])
    ],
    { maxBuffer: 1024 * 1024 * 100 }
  )
  const parsed = JSON.parse(stdout) as TranscribeResult

  return {
    language: parsed.language,
    languageProbability: parsed.languageProbability,
    granularity,
    segments: normalizeTranscriptSegments(parsed.segments, options.offsetMs ?? 0)
  }
}

export async function createVideoContactSheet(
  asset: ProjectAssetRow,
  metadata: MediaMetadata
): Promise<{ contactSheetPath: string; frameCount: number } | null> {
  if (asset.type !== 'video' || !metadata.durationMs || metadata.durationMs <= 0) {
    return null
  }

  const ffmpegPath = resolveExecutable('ffmpeg')
  if (!ffmpegPath) {
    throw new Error('ffmpeg executable was not found. Install ffmpeg to enable contact sheets.')
  }

  const assetDir = dirname(asset.assetPath)
  const tempDir = await mkdtemp(join(tmpdir(), `tinyfilm-contact-sheet-${asset.id}-`))
  const times = contactSheetSampleTimes(metadata.durationMs)
  const framePaths: string[] = []

  try {
    for (let index = 0; index < times.length; index += 1) {
      const framePath = join(tempDir, `frame-${String(index + 1).padStart(3, '0')}.jpg`)
      await extractContactSheetFrame(ffmpegPath, asset.assetPath, framePath, times[index])
      framePaths.push(framePath)
    }

    const contactSheetPath = join(assetDir, 'contact-sheet.jpg')
    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-framerate',
        '1',
        '-i',
        join(tempDir, 'frame-%03d.jpg'),
        '-frames:v',
        '1',
        '-vf',
        'tile=3x3:padding=8:margin=8:color=black',
        contactSheetPath
      ],
      { maxBuffer: 1024 * 1024 * 20 }
    )

    return {
      contactSheetPath: basename(contactSheetPath),
      frameCount: framePaths.length
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function writeAssetIndex(asset: ProjectAssetRow, index: AssetIndex): Promise<void> {
  const indexPath = join(dirname(asset.assetPath), 'index.json')
  const tempPath = `${indexPath}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  await rename(tempPath, indexPath)
}

export function parseSilenceDetect(stderr: string): SilenceRange[] {
  const ranges: SilenceRange[] = []
  let pendingStart: number | null = null

  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/)
    if (startMatch) {
      pendingStart = Number(startMatch[1])
      continue
    }

    const endMatch = line.match(/silence_end:\s*([0-9.]+)/)
    if (endMatch && pendingStart !== null) {
      const end = Number(endMatch[1])
      if (Number.isFinite(pendingStart) && Number.isFinite(end) && end >= pendingStart) {
        ranges.push({
          startMs: Math.round(pendingStart * 1000),
          endMs: Math.round(end * 1000)
        })
      }
      pendingStart = null
    }
  }

  return ranges
}

async function drainQueue(): Promise<void> {
  if (running) {
    return
  }

  running = true
  try {
    while (queue.length > 0) {
      const job = queue.shift()
      if (job) {
        await indexAssetNow(job.asset)
      }
    }
  } finally {
    running = false
  }
}

async function buildAssetIndex(asset: ProjectAssetRow): Promise<AssetIndex> {
  if (asset.type === 'other') {
    return {
      version: indexVersion,
      assetId: asset.id,
      kind: asset.type,
      status: 'ready',
      metadata: {
        mimeType: mimeTypeForPath(asset.assetPath) ?? undefined
      }
    }
  }

  const metadata = await probeMediaMetadata(asset.assetPath)
  updateAssetMetadata(asset.id, metadata)

  if (asset.type === 'image') {
    await createImageThumbnail(asset)
    return {
      version: indexVersion,
      assetId: asset.id,
      kind: asset.type,
      status: 'ready',
      metadata
    }
  }

  if (asset.type === 'audio') {
    const [silence, transcript] = await Promise.all([
      detectSilence(asset.assetPath),
      transcribeFile(asset.assetPath)
    ])
    return {
      version: indexVersion,
      assetId: asset.id,
      kind: asset.type,
      status: 'ready',
      metadata,
      transcript: {
        granularity: 'segment',
        segments: transcript.segments
      },
      silence
    }
  }

  const contactSheet = await createVideoContactSheet(asset, metadata)
  const [silence, transcript] = await Promise.all([
    detectSilence(asset.assetPath),
    transcribeFile(asset.assetPath)
  ])

  return {
    version: indexVersion,
    assetId: asset.id,
    kind: asset.type,
    status: 'ready',
    metadata,
    transcript: {
      granularity: 'segment',
      segments: transcript.segments
    },
    silence,
    ...(contactSheet
      ? {
          visual: {
            contactSheetPath: contactSheet.contactSheetPath,
            frameCount: contactSheet.frameCount
          }
        }
      : {})
  }
}

async function createStillThumbnail(
  inputPath: string,
  outputPath: string,
  seekSeconds?: string
): Promise<void> {
  const ffmpegPath = resolveExecutable('ffmpeg')
  if (!ffmpegPath) {
    throw new Error('ffmpeg executable was not found. Install ffmpeg to enable thumbnails.')
  }

  await execFileAsync(
    ffmpegPath,
    [
      '-y',
      ...(seekSeconds ? ['-ss', seekSeconds] : []),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-1',
      outputPath
    ],
    { maxBuffer: 1024 * 1024 * 20 }
  )
}

async function extractContactSheetFrame(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  timeMs: number
): Promise<void> {
  const timestamp = formatTimestamp(timeMs)
  const label = escapeDrawText(` ${timestamp} `)
  const filters = [
    'scale=360:-1',
    'drawbox=x=0:y=0:w=iw:h=42:color=black@0.65:t=fill',
    `drawtext=text='${label}':x=12:y=10:fontsize=22:fontcolor=white`
  ]

  await execFileAsync(
    ffmpegPath,
    [
      '-y',
      '-ss',
      String(timeMs / 1000),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      filters.join(','),
      outputPath
    ],
    { maxBuffer: 1024 * 1024 * 20 }
  )
}

function contactSheetSampleTimes(durationMs: number): number[] {
  const frameCount = 9
  const start = Math.min(durationMs * 0.03, 1000)
  const end = Math.max(durationMs - Math.min(durationMs * 0.03, 1000), start)

  if (end <= start) {
    return [Math.round(durationMs / 2)]
  }

  return Array.from({ length: frameCount }, (_value, index) => {
    return Math.round(start + ((end - start) * index) / (frameCount - 1))
  })
}

function execFileCapturingStderr(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 * 20 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }

      resolve(stderr)
    })
  })
}

function updateAssetIndexState(
  assetId: string,
  values: Partial<
    Pick<
      ProjectAssetRow,
      | 'indexStatus'
      | 'indexUpdatedAt'
      | 'indexError'
      | 'mimeType'
      | 'durationMs'
      | 'width'
      | 'height'
    >
  >
): void {
  getDatabase().update(projectAssets).set(values).where(eq(projectAssets.id, assetId)).run()
}

function updateAssetMetadata(assetId: string, metadata: MediaMetadata): void {
  getDatabase()
    .update(projectAssets)
    .set({
      mimeType: metadata.mimeType ?? null,
      durationMs: metadata.durationMs ?? null,
      width: metadata.width ?? null,
      height: metadata.height ?? null
    })
    .where(eq(projectAssets.id, assetId))
    .run()
}

function resolveTranscribeScriptPath(): string {
  const candidates = [
    join(__dirname, 'assets/indexer/transcribe.py'),
    join(process.cwd(), 'src/main/assets/indexer/transcribe.py')
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error('faster-whisper transcription sidecar was not found.')
}

function resolvePythonExecutable(): string | null {
  const configured = process.env['TINYFILM_PYTHON_PATH']?.trim()
  const candidates = [
    ...(configured ? [configured] : []),
    join(process.cwd(), '.venv/bin/python'),
    join(process.cwd(), '.venv/bin/python3'),
    resolveExecutable('python3'),
    resolveExecutable('python')
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      accessSync(candidate)
      return candidate
    } catch {
      // Try the next configured Python path.
    }
  }

  return null
}

function resolveExecutable(name: 'ffmpeg' | 'ffprobe' | 'python3' | 'python'): string | null {
  const pathResult = spawnSync('command', ['-v', name], { shell: true, encoding: 'utf8' })
  const pathCandidate = pathResult.status === 0 ? pathResult.stdout.trim().split(/\r?\n/)[0] : ''
  const candidates = [
    ...executableCandidates(name).filter((candidate) => candidate !== name),
    ...(pathCandidate ? [pathCandidate] : [])
  ]

  for (const candidate of candidates) {
    try {
      accessSync(candidate)
      return candidate
    } catch {
      // Try the next common install location.
    }
  }

  return null
}

function executableCandidates(name: 'ffmpeg' | 'ffprobe' | 'python3' | 'python'): string[] {
  if (name === 'python' || name === 'python3') {
    return [name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`]
  }

  return [
    name,
    `/opt/homebrew/opt/ffmpeg-full/bin/${name}`,
    `/usr/local/opt/ffmpeg-full/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`
  ]
}

function numberFromString(value: string | undefined): number | null {
  const parsed = value === undefined ? Number.NaN : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeTranscriptSegments(
  segments: TranscriptSegment[] | undefined,
  offsetMs: number
): TranscriptSegment[] {
  if (!Array.isArray(segments)) {
    return []
  }

  return segments
    .map((segment) => ({
      startMs: Math.max(0, Math.round(Number(segment.startMs) + offsetMs)),
      endMs: Math.max(0, Math.round(Number(segment.endMs) + offsetMs)),
      text: String(segment.text ?? '').trim(),
      ...(Array.isArray(segment.words)
        ? {
            words: normalizeTranscriptWords(segment.words, offsetMs)
          }
        : {})
    }))
    .filter((segment) => segment.text && segment.endMs >= segment.startMs)
}

function normalizeTranscriptWords(
  words: TranscriptWord[] | undefined,
  offsetMs: number
): TranscriptWord[] {
  if (!Array.isArray(words)) {
    return []
  }

  return words
    .map((word) => ({
      startMs: Math.max(0, Math.round(Number(word.startMs) + offsetMs)),
      endMs: Math.max(0, Math.round(Number(word.endMs) + offsetMs)),
      text: String(word.text ?? '').trim()
    }))
    .filter((word) => word.text && word.endMs >= word.startMs)
}

function formatTimestamp(timeMs: number): string {
  const totalTenths = Math.max(0, Math.round(timeMs / 100))
  const totalSeconds = Math.floor(totalTenths / 10)
  const tenths = totalTenths % 10
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`
}

function escapeDrawText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')
}

function mimeTypeForPath(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.avi':
      return 'video/x-msvideo'
    case '.mkv':
      return 'video/x-matroska'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    case '.flac':
      return 'audio/flac'
    case '.ogg':
      return 'audio/ogg'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.avif':
      return 'image/avif'
    default:
      return null
  }
}

function shortErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 1000 ? `${message.slice(0, 997)}...` : message
}
