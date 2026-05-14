import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import { type ProjectAssetRow, projectAssets } from '../db/schema'
import { getProject } from '../projects/projectRepository'
import { createVideoThumbnail, startAssetIndexing } from './assetIndexer'

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
  return input.filePaths
    .filter((filePath) => filePath.trim().length > 0 && existsSync(filePath))
    .map((filePath) =>
      registerProjectAssetFromPath({ projectId: input.projectId, sourcePath: filePath })
    )
}

export function registerProjectAssetFromPath(input: {
  projectId: string
  sourcePath: string
  displayName?: string
}): ProjectAssetRow {
  const project = getProject({ id: input.projectId })
  const assetsDir = join(project.rootPath, 'assets')
  mkdirSync(assetsDir, { recursive: true })

  const sourcePath = input.sourcePath.trim()
  const now = Date.now()
  const id = randomUUID()
  const name = input.displayName?.trim() || basename(sourcePath)
  const assetDir = join(assetsDir, id)
  const extension = extname(sourcePath).toLowerCase()
  const assetPath = join(assetDir, `original${extension}`)
  const stats = statSync(sourcePath)

  mkdirSync(assetDir, { recursive: true })
  copyFileSync(sourcePath, assetPath)

  const asset: ProjectAssetRow = {
    id,
    projectId: project.id,
    type: inferAssetType(sourcePath),
    name,
    originalPath: sourcePath,
    assetPath,
    relativePath: relative(project.rootPath, assetPath),
    sizeBytes: stats.size,
    mimeType: null,
    durationMs: null,
    width: null,
    height: null,
    indexStatus: null,
    indexUpdatedAt: null,
    indexError: null,
    createdAt: now
  }

  getDatabase().insert(projectAssets).values(asset).run()
  createAssetThumbnail(asset)
  startAssetIndexing(asset)

  return asset
}

export function removeProjectAsset(input: { id: string }): { id: string } {
  const asset = getDatabase()
    .select()
    .from(projectAssets)
    .where(eq(projectAssets.id, input.id))
    .get()

  if (!asset) {
    throw new Error('Asset not found')
  }

  const result = getDatabase().delete(projectAssets).where(eq(projectAssets.id, input.id)).run()

  if (result.changes === 0) {
    throw new Error('Asset not found')
  }

  removeAssetFiles(asset)

  return input
}

export function renameProjectAsset(input: { id: string; name: string }): ProjectAssetRow {
  const name = input.name.trim()

  if (!name) {
    throw new Error('Asset name is required')
  }

  getDatabase().update(projectAssets).set({ name }).where(eq(projectAssets.id, input.id)).run()

  const asset = getDatabase()
    .select()
    .from(projectAssets)
    .where(eq(projectAssets.id, input.id))
    .get()

  if (!asset) {
    throw new Error('Asset not found')
  }

  return asset
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

function createAssetThumbnail(asset: ProjectAssetRow): void {
  if (asset.type !== 'video') {
    return
  }

  void createVideoThumbnail(asset).catch((error) => {
    console.warn('[assets:thumbnailFailed]', {
      id: asset.id,
      path: asset.assetPath,
      error: error instanceof Error ? error.message : error
    })
  })
}

function removeAssetFiles(asset: ProjectAssetRow): void {
  const assetDir = dirname(asset.assetPath)

  try {
    if (basename(assetDir) === asset.id) {
      rmSync(assetDir, { force: true, recursive: true })
      return
    }

    rmSync(asset.assetPath, { force: true })
  } catch (error) {
    console.warn('[assets:removeFilesFailed]', {
      id: asset.id,
      path: asset.assetPath,
      error: error instanceof Error ? error.message : error
    })
  }
}
