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

  const hasTargetPath = taskColumns.some((col) => col.name === 'target_path')
  if (!hasTargetPath) {
    db.exec(`ALTER TABLE tasks ADD COLUMN target_path TEXT NOT NULL DEFAULT ''`)
  }

  const hasAutomationStatus = taskColumns.some((col) => col.name === 'automation_status')
  if (!hasAutomationStatus) {
    db.exec(`ALTER TABLE tasks ADD COLUMN automation_status TEXT NOT NULL DEFAULT 'idle'`)
  }

  const hasDueDate = taskColumns.some((col) => col.name === 'due_date')
  if (!hasDueDate) {
    db.exec(`ALTER TABLE tasks ADD COLUMN due_date TEXT`)
  }

  const hasAutomationSkill = taskColumns.some((col) => col.name === 'automation_skill')
  if (!hasAutomationSkill) {
    db.exec(`ALTER TABLE tasks ADD COLUMN automation_skill TEXT NOT NULL DEFAULT ''`)
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

  db.exec(`
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

  const runColumns = db.prepare('PRAGMA table_info(automation_runs)').all()
  const hasWorktreePath = runColumns.some((col) => col.name === 'worktree_path')
  if (!hasWorktreePath) {
    db.exec(`ALTER TABLE automation_runs ADD COLUMN worktree_path TEXT NOT NULL DEFAULT ''`)
  }
  const hasWorktreeBranch = runColumns.some((col) => col.name === 'worktree_branch')
  if (!hasWorktreeBranch) {
    db.exec(`ALTER TABLE automation_runs ADD COLUMN worktree_branch TEXT NOT NULL DEFAULT ''`)
  }
  const hasRunSkill = runColumns.some((col) => col.name === 'skill')
  if (!hasRunSkill) {
    db.exec(`ALTER TABLE automation_runs ADD COLUMN skill TEXT NOT NULL DEFAULT ''`)
  }

  // SQLite 預設不強制外鍵約束，需要每個連線手動開啟才會啟用 CASCADE
  db.pragma('foreign_keys = ON')

  return db
}

export function recoverInterruptedRuns(db) {
  const now = new Date().toISOString()

  const runsResult = db
    .prepare(
      `UPDATE automation_runs
       SET status = 'interrupted',
           error = '伺服器重啟或程序中斷，執行狀態不明（原本狀態：running）',
           finished_at = ?
       WHERE status = 'running'`,
    )
    .run(now)

  const tasksResult = db
    .prepare(`UPDATE tasks SET automation_status = 'interrupted' WHERE automation_status = 'running'`)
    .run()

  return {
    tasksRecovered: tasksResult.changes,
    runsRecovered: runsResult.changes,
  }
}
