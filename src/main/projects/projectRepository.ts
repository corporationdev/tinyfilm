import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import { type ProjectRow, projects } from '../db/schema'

export function listProjects(): ProjectRow[] {
  return getDatabase().select().from(projects).orderBy(desc(projects.updatedAt)).all()
}

export function getProject(input: { id: string }): ProjectRow {
  const project = getDatabase().select().from(projects).where(eq(projects.id, input.id)).get()

  if (!project) {
    throw new Error('Project not found')
  }

  return project
}

export function createProjectRecord(input: {
  title: string
  slug: string
  rootPath: string
  entryPoint?: string
  compositionId?: string
  fps?: number
  width?: number
  height?: number
}): ProjectRow {
  const now = Date.now()
  const project: ProjectRow = {
    id: randomUUID(),
    title: input.title,
    slug: input.slug,
    rootPath: input.rootPath,
    entryPoint: input.entryPoint ?? 'src/index.ts',
    compositionId: input.compositionId ?? 'MyComp',
    thumbnailPath: null,
    durationMs: null,
    fps: input.fps ?? 30,
    width: input.width ?? 1280,
    height: input.height ?? 720,
    status: 'draft',
    lastOpenedAt: null,
    createdAt: now,
    updatedAt: now
  }

  getDatabase().insert(projects).values(project).run()

  return project
}

export function markProjectOpened(input: { id: string }): ProjectRow {
  const [project] = getDatabase()
    .update(projects)
    .set({ lastOpenedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(projects.id, input.id))
    .returning()
    .all()

  if (!project) {
    throw new Error('Project not found')
  }

  return project
}

export function removeProject(input: { id: string }): { id: string } {
  const result = getDatabase().delete(projects).where(eq(projects.id, input.id)).run()

  if (result.changes === 0) {
    throw new Error('Project not found')
  }

  return input
}
