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

  // Migration：舊資料庫檔案可能沒有 description 欄位，用 PRAGMA 檢查後補上
  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all()
  const hasDescription = taskColumns.some((col) => col.name === 'description')
  if (!hasDescription) {
    db.exec(`ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)

  // SQLite 預設不強制外鍵約束，需要每個連線手動開啟才會啟用 CASCADE
  db.pragma('foreign_keys = ON')

  return db
}
