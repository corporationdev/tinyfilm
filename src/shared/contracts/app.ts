import { oc } from '@orpc/contract'
import { z } from 'zod'

export const projectStatusSchema = z.enum(['draft', 'missing', 'error'])
export const assetTypeSchema = z.enum(['video', 'audio', 'image', 'other'])

export const projectSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  slug: z.string(),
  rootPath: z.string(),
  entryPoint: z.string(),
  compositionId: z.string(),
  thumbnailPath: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  fps: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  status: projectStatusSchema,
  lastOpenedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int()
})

export const projectAssetSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  type: assetTypeSchema,
  name: z.string(),
  originalPath: z.string(),
  assetPath: z.string(),
  relativePath: z.string(),
  sizeBytes: z.number().int().nullable(),
  mimeType: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  createdAt: z.number().int()
})

export const createProjectInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120, 'Title is too long')
})

export const projectIdInputSchema = z.object({
  id: z.uuid()
})

export const importFilesInputSchema = z.object({
  projectId: z.uuid(),
  filePaths: z.array(z.string().min(1)).min(1)
})

export const projectAssetIdInputSchema = z.object({
  id: z.uuid()
})

export const appContract = {
  projects: {
    list: oc.output(z.array(projectSchema)),
    create: oc.input(createProjectInputSchema).output(projectSchema),
    get: oc.input(projectIdInputSchema).output(projectSchema),
    open: oc.input(projectIdInputSchema).output(projectSchema),
    remove: oc.input(projectIdInputSchema).output(projectIdInputSchema)
  },
  assets: {
    listByProject: oc.input(projectIdInputSchema).output(z.array(projectAssetSchema)),
    importFiles: oc.input(importFilesInputSchema).output(z.array(projectAssetSchema)),
    remove: oc.input(projectAssetIdInputSchema).output(projectAssetIdInputSchema)
  }
}

export type Project = z.infer<typeof projectSchema>
export type ProjectAsset = z.infer<typeof projectAssetSchema>
export type AppContract = typeof appContract
