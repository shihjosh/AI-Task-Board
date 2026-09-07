import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', '.data')
const dbPath = path.join(dataDir, 'taskboard.sqlite')

let db

export function getDb() {
  if (db) return db

  fs.mkdirSync(dataDir, { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      priority TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      assignees TEXT NOT NULL DEFAULT '[]',
      progress INTEGER,
      comment_count INTEGER NOT NULL DEFAULT 0,
      has_unread INTEGER NOT NULL DEFAULT 0,
      column_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  return db
}
