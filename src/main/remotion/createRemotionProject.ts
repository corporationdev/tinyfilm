import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { createProjectRecord } from '../projects/projectRepository'

const execFileAsync = promisify(execFile)
const entryPoint = 'src/index.ts'
const compositionId = 'MyComp'
const fps = 30
const width = 1280
const height = 720

export async function createRemotionProject(input: {
  title: string
}): Promise<ReturnType<typeof createProjectRecord>> {
  const slug = slugify(input.title)
  const projectDir = uniqueProjectDir(slug)

  await execFileAsync('bun', ['create', 'video', '--yes', '--blank', projectDir], {
    cwd: app.getPath('userData'),
    env: process.env,
    maxBuffer: 1024 * 1024 * 20
  })

  mkdirSync(join(projectDir, 'public', 'assets', 'imports'), { recursive: true })
  mkdirSync(join(projectDir, 'public', 'assets', 'generated'), { recursive: true })
  mkdirSync(join(projectDir, 'renders'), { recursive: true })

  return createProjectRecord({
    title: input.title,
    slug,
    rootPath: projectDir,
    entryPoint,
    compositionId,
    fps,
    width,
    height
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

function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'untitled-film'
}
