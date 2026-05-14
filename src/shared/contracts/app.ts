import { oc } from '@orpc/contract'
import { z } from 'zod'

export const projectStatusSchema = z.enum(['draft', 'missing', 'error'])
export const assetTypeSchema = z.enum(['video', 'audio', 'image', 'other'])
export const assetIndexStatusSchema = z.enum(['pending', 'ready', 'failed'])

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
  indexStatus: assetIndexStatusSchema.nullable(),
  indexUpdatedAt: z.number().int().nullable(),
  indexError: z.string().nullable(),
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

export const renameProjectAssetInputSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(255)
})

export const previewSessionSchema = z.object({
  projectId: z.uuid(),
  url: z.url(),
  port: z.number().int().positive()
})

export const piAgentChatSchema = z.object({
  id: z.string().min(1),
  sessionFilePath: z.string().min(1),
  title: z.string(),
  preview: z.string(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(['idle', 'running', 'failed'])
})

export const piAgentMessageTranscriptItemSchema = z.object({
  kind: z.literal('message'),
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  createdAt: z.string(),
  isError: z.boolean().optional(),
  optimistic: z.boolean().optional()
})

export const piAgentToolTranscriptItemSchema = z.object({
  kind: z.literal('tool'),
  id: z.string().min(1),
  callId: z.string().min(1),
  toolName: z.string(),
  status: z.enum(['running', 'success', 'error']),
  label: z.string(),
  text: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  createdAt: z.string()
})

export const piAgentActivityTranscriptItemSchema = z.object({
  kind: z.literal('activity'),
  id: z.string().min(1),
  label: z.string(),
  detail: z.string().optional(),
  tone: z.enum(['neutral', 'success', 'warning', 'error']).optional(),
  createdAt: z.string()
})

export const piAgentTranscriptItemSchema = z.discriminatedUnion('kind', [
  piAgentMessageTranscriptItemSchema,
  piAgentToolTranscriptItemSchema,
  piAgentActivityTranscriptItemSchema
])

export const piAgentProjectInputSchema = z.object({
  projectId: z.uuid()
})

export const piAgentChatInputSchema = z.object({
  projectId: z.uuid(),
  sessionId: z.string().min(1)
})

export const createPiAgentChatInputSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1).max(120).optional()
})

export const sendPiAgentMessageInputSchema = z.object({
  projectId: z.uuid(),
  sessionId: z.string().min(1),
  text: z.string().trim().min(1)
})

export const piAgentAuthStatusSchema = z.object({
  provider: z.literal('google'),
  configured: z.boolean(),
  source: z.string().optional(),
  label: z.string().optional()
})

export const setPiAgentGeminiKeyInputSchema = z.object({
  apiKey: z.string().trim().min(1, 'Gemini API key is required')
})

export const appContract = {
  projects: {
    list: oc.output(z.array(projectSchema)),
    create: oc.input(createProjectInputSchema).output(projectSchema),
    get: oc.input(projectIdInputSchema).output(projectSchema),
    open: oc.input(projectIdInputSchema).output(projectSchema),
    startPreview: oc.input(projectIdInputSchema).output(previewSessionSchema),
    stopPreview: oc.input(projectIdInputSchema).output(projectIdInputSchema),
    remove: oc.input(projectIdInputSchema).output(projectIdInputSchema)
  },
  assets: {
    listByProject: oc.input(projectIdInputSchema).output(z.array(projectAssetSchema)),
    importFiles: oc.input(importFilesInputSchema).output(z.array(projectAssetSchema)),
    rename: oc.input(renameProjectAssetInputSchema).output(projectAssetSchema),
    remove: oc.input(projectAssetIdInputSchema).output(projectAssetIdInputSchema)
  },
  agents: {
    listChats: oc.input(piAgentProjectInputSchema).output(z.array(piAgentChatSchema)),
    createChat: oc.input(createPiAgentChatInputSchema).output(piAgentChatSchema),
    openChat: oc.input(piAgentChatInputSchema).output(
      z.object({
        chat: piAgentChatSchema,
        transcript: z.array(piAgentTranscriptItemSchema)
      })
    ),
    getTranscript: oc.input(piAgentChatInputSchema).output(z.array(piAgentTranscriptItemSchema)),
    sendMessage: oc.input(sendPiAgentMessageInputSchema).output(piAgentChatSchema),
    cancelRun: oc.input(piAgentChatInputSchema).output(piAgentChatSchema),
    getGeminiAuthStatus: oc.output(piAgentAuthStatusSchema),
    setGeminiApiKey: oc.input(setPiAgentGeminiKeyInputSchema).output(piAgentAuthStatusSchema)
  }
}

export type Project = z.infer<typeof projectSchema>
export type ProjectAsset = z.infer<typeof projectAssetSchema>
export type PreviewSession = z.infer<typeof previewSessionSchema>
export type PreviewChangedEvent = {
  projectId: string
  version: number
  changedPath: string | null
}
export type PiAgentChat = z.infer<typeof piAgentChatSchema>
export type PiAgentTranscriptItem = z.infer<typeof piAgentTranscriptItemSchema>
export type PiAgentAuthStatus = z.infer<typeof piAgentAuthStatusSchema>
export type AppContract = typeof appContract
