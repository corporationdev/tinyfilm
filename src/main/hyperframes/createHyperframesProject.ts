import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { createProjectRecord } from '../projects/projectRepository'

const execFileAsync = promisify(execFile)
const defaultEntryPoint = 'index.html'
const defaultCompositionId = 'main'
const defaultFps = 30
const defaultWidth = 1080
const defaultHeight = 1920

export async function createHyperframesProject(input: {
  title: string
}): Promise<ReturnType<typeof createProjectRecord>> {
  const slug = slugify(input.title)
  const projectDir = uniqueProjectDir(slug)

  await execFileAsync(
    'npx',
    [
      '--yes',
      'hyperframes',
      'init',
      '--non-interactive',
      '--skip-skills',
      '--example',
      'blank',
      '--resolution',
      'portrait',
      projectDir
    ],
    {
      cwd: app.getPath('userData'),
      env: process.env,
      maxBuffer: 1024 * 1024 * 20
    }
  )

  mkdirSync(join(projectDir, 'assets', 'imports'), { recursive: true })
  mkdirSync(join(projectDir, 'assets', 'generated'), { recursive: true })
  mkdirSync(join(projectDir, 'renders'), { recursive: true })

  const metadata = readCompositionMetadata(join(projectDir, defaultEntryPoint))

  return createProjectRecord({
    title: input.title,
    slug,
    rootPath: projectDir,
    entryPoint: defaultEntryPoint,
    compositionId: metadata.compositionId,
    durationMs: metadata.durationMs,
    fps: metadata.fps,
    width: metadata.width,
    height: metadata.height
  })
}

function uniqueProjectDir(slug: string): string {
  const projectsDir = join(app.getPath('userData'), 'projects')
  mkdirSync(projectsDir, { recursive: true })

  let candidate = join(projectsDir, slug)
  let index = 1

  while (existsSync(candidate) && readdirSync(candidate).length > 0) {
    candidate = join(projectsDir, `${slug}-${index}`)
    index += 1
  }

  return candidate
}

function readCompositionMetadata(entryPath: string): {
  compositionId: string
  durationMs: number | null
  fps: number
  width: number
  height: number
} {
  if (!existsSync(entryPath)) {
    return {
      compositionId: defaultCompositionId,
      durationMs: null,
      fps: defaultFps,
      width: defaultWidth,
      height: defaultHeight
    }
  }

  const html = readFileSync(entryPath, 'utf8')
  const durationSeconds = readNumberAttribute(html, 'data-duration')

  return {
    compositionId: readStringAttribute(html, 'data-composition-id') ?? defaultCompositionId,
    durationMs: durationSeconds === null ? null : Math.round(durationSeconds * 1000),
    fps: readNumberAttribute(html, 'data-fps') ?? defaultFps,
    width: readNumberAttribute(html, 'data-width') ?? defaultWidth,
    height: readNumberAttribute(html, 'data-height') ?? defaultHeight
  }
}

function readStringAttribute(html: string, attributeName: string): string | null {
  const match = html.match(new RegExp(`${attributeName}=["']([^"']+)["']`))
  return match?.[1] ?? null
}

function readNumberAttribute(html: string, attributeName: string): number | null {
  const value = readStringAttribute(html, attributeName)
  const numberValue = value === null ? Number.NaN : Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'untitled-film'
}
