import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from 'electron'
import * as schema from './schema'

let sqlite: Database.Database | undefined
let db: ReturnType<typeof drizzle<typeof schema>> | undefined

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'tinyfilm.db')
}

export function getDatabase(): AppDatabase {
  if (!sqlite || !db) {
    const databasePath = getDatabasePath()
    mkdirSync(dirname(databasePath), { recursive: true })

    sqlite = new Database(databasePath)
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')

    db = drizzle(sqlite, { schema })
    migrate(db, {
      migrationsFolder: join(__dirname, 'migrations')
    })
  }

  return db
}
