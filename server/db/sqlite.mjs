import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', '..', '.data')
const dbPath = path.join(dataDir, 'taskboard.sqlite')

let db

function initDb() {
  fs.mkdirSync(dataDir, { recursive: true })
  const conn = new Database(dbPath)
  conn.pragma('journal_mode = WAL')

  conn.exec(`
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
  const taskColumns = conn.prepare('PRAGMA table_info(tasks)').all()
  const hasDescription = taskColumns.some((col) => col.name === 'description')
  if (!hasDescription) {
    conn.exec(`ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
  }

  const hasTargetPath = taskColumns.some((col) => col.name === 'target_path')
  if (!hasTargetPath) {
    conn.exec(`ALTER TABLE tasks ADD COLUMN target_path TEXT NOT NULL DEFAULT ''`)
  }

  const hasAutomationStatus = taskColumns.some((col) => col.name === 'automation_status')
  if (!hasAutomationStatus) {
    conn.exec(`ALTER TABLE tasks ADD COLUMN automation_status TEXT NOT NULL DEFAULT 'idle'`)
  }

  const hasDueDate = taskColumns.some((col) => col.name === 'due_date')
  if (!hasDueDate) {
    conn.exec(`ALTER TABLE tasks ADD COLUMN due_date TEXT`)
  }

  const hasAutomationSkill = taskColumns.some((col) => col.name === 'automation_skill')
  if (!hasAutomationSkill) {
    conn.exec(`ALTER TABLE tasks ADD COLUMN automation_skill TEXT NOT NULL DEFAULT ''`)
  }

  conn.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)

  conn.exec(`
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      output TEXT NOT NULL DEFAULT '',
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)

  const runColumns = conn.prepare('PRAGMA table_info(automation_runs)').all()
  const hasWorktreePath = runColumns.some((col) => col.name === 'worktree_path')
  if (!hasWorktreePath) {
    conn.exec(`ALTER TABLE automation_runs ADD COLUMN worktree_path TEXT NOT NULL DEFAULT ''`)
  }
  const hasWorktreeBranch = runColumns.some((col) => col.name === 'worktree_branch')
  if (!hasWorktreeBranch) {
    conn.exec(`ALTER TABLE automation_runs ADD COLUMN worktree_branch TEXT NOT NULL DEFAULT ''`)
  }
  const hasRunSkill = runColumns.some((col) => col.name === 'skill')
  if (!hasRunSkill) {
    conn.exec(`ALTER TABLE automation_runs ADD COLUMN skill TEXT NOT NULL DEFAULT ''`)
  }

  // SQLite 預設不強制外鍵約束，需要每個連線手動開啟才會啟用 CASCADE
  conn.pragma('foreign_keys = ON')

  return conn
}

// SQLite 底層是同步 API，這裡包一層 async 只是為了跟 postgres 驅動介面一致，
// 呼叫端不需要知道底下是同步還是非同步實作。
export async function getDb() {
  if (db) return db
  db = initDb()
  return db
}

export const placeholderStyle = 'question'
