import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const projectStatuses = ['draft', 'missing', 'error'] as const
export const projectAssetTypes = ['video', 'audio', 'image', 'other'] as const
export const projectAssetIndexStatuses = ['pending', 'ready', 'failed'] as const

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  rootPath: text('root_path').notNull(),
  entryPoint: text('entry_point').notNull().default('index.html'),
  compositionId: text('composition_id').notNull().default('main'),
  thumbnailPath: text('thumbnail_path'),
  durationMs: integer('duration_ms'),
  fps: integer('fps').notNull().default(30),
  width: integer('width').notNull().default(1080),
  height: integer('height').notNull().default(1920),
  status: text('status', { enum: projectStatuses }).notNull().default('draft'),
  lastOpenedAt: integer('last_opened_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const projectAssets = sqliteTable('project_assets', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type', { enum: projectAssetTypes }).notNull(),
  name: text('name').notNull(),
  originalPath: text('original_path').notNull(),
  assetPath: text('asset_path').notNull(),
  relativePath: text('relative_path').notNull(),
  sizeBytes: integer('size_bytes'),
  mimeType: text('mime_type'),
  durationMs: integer('duration_ms'),
  width: integer('width'),
  height: integer('height'),
  indexStatus: text('index_status', { enum: projectAssetIndexStatuses }),
  indexUpdatedAt: integer('index_updated_at'),
  indexError: text('index_error'),
  createdAt: integer('created_at').notNull()
})

export type ProjectRow = typeof projects.$inferSelect
export type NewProjectRow = typeof projects.$inferInsert
export type ProjectAssetRow = typeof projectAssets.$inferSelect
export type NewProjectAssetRow = typeof projectAssets.$inferInsert
