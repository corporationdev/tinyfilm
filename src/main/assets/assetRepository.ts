import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import { type ProjectAssetRow, projectAssets } from '../db/schema'
import { getProject } from '../projects/projectRepository'

export function listProjectAssets(input: { projectId: string }): ProjectAssetRow[] {
  return getDatabase()
    .select()
    .from(projectAssets)
    .where(eq(projectAssets.projectId, input.projectId))
    .orderBy(asc(projectAssets.createdAt))
    .all()
}

export function importProjectFiles(input: {
  projectId: string
  filePaths: string[]
}): ProjectAssetRow[] {
  const project = getProject({ id: input.projectId })
  const importsDir = join(project.rootPath, 'public', 'assets', 'imports')
  mkdirSync(importsDir, { recursive: true })

  const imported = input.filePaths
    .filter((filePath) => filePath.trim().length > 0 && existsSync(filePath))
    .map((filePath) => {
      const now = Date.now()
      const name = basename(filePath)
      const assetPath = join(importsDir, uniqueAssetName(importsDir, name))
      const stats = statSync(filePath)

      copyFileSync(filePath, assetPath)

      const asset: ProjectAssetRow = {
        id: randomUUID(),
        projectId: project.id,
        type: inferAssetType(filePath),
        name,
        originalPath: filePath,
        assetPath,
        relativePath: relative(project.rootPath, assetPath),
        sizeBytes: stats.size,
        mimeType: null,
        durationMs: null,
        width: null,
        height: null,
        createdAt: now
      }

      getDatabase().insert(projectAssets).values(asset).run()

      return asset
    })

  return imported
}

export function removeProjectAsset(input: { id: string }): { id: string } {
  const result = getDatabase().delete(projectAssets).where(eq(projectAssets.id, input.id)).run()

  if (result.changes === 0) {
    throw new Error('Asset not found')
  }

  return input
}

function uniqueAssetName(directory: string, fileName: string): string {
  const extension = extname(fileName)
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName
  let candidate = sanitizeFileName(fileName)
  let index = 1

  while (existsSync(join(directory, candidate))) {
    candidate = `${sanitizeFileName(baseName)}-${index}${extension}`
    index += 1
  }

  return candidate
}

function sanitizeFileName(fileName: string): string {
  const extension = extname(fileName)
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName
  const safeBaseName = baseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${safeBaseName || 'asset'}${extension.toLowerCase()}`
}

function inferAssetType(filePath: string): ProjectAssetRow['type'] {
  const extension = extname(filePath).toLowerCase()

  if (['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'].includes(extension)) {
    return 'video'
  }

  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(extension)) {
    return 'audio'
  }

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(extension)) {
    return 'image'
  }

  return 'other'
}
