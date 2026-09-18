import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', '..', '.data')
const dbPath = path.join(dataDir, 'taskboard.sqlite')

let db

// node --test 預設把每個測試檔 spawn 成獨立 process 平行執行，多個 process
// 可能同時對同一份全新 SQLite 檔案呼叫 initDb()：都用 PRAGMA table_info 檢查
// 到欄位不存在、都決定要 ALTER TABLE ADD COLUMN，第一個成功後，其餘會因為
// 欄位已存在而丟出 SQLITE_ERROR: duplicate column name。這是良性的併發競態
// （最終結果一致，只是誰先跑到的問題），用這個 helper 吞掉該特定錯誤即可，
// 其餘真正的 SQL 錯誤仍會往外拋。
function addColumnIfMissing(conn, table, columnDefinition) {
  try {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`)
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) {
      throw err
    }
  }
}

function initDb() {
  fs.mkdirSync(dataDir, { recursive: true })
  const conn = new Database(dbPath)
  // node --test 把每個測試檔 spawn 成獨立 process 平行執行，多個 process 可能
  // 同時對同一份全新 SQLite 檔案開連線並嘗試寫入（建表、開啟 WAL 模式等），
  // better-sqlite3 預設遇到 SQLITE_BUSY（檔案被其他連線鎖住）會立刻拋錯，不會
  // 重試等待。設定 busy timeout 讓它在鎖定時等待、輪詢重試，而不是馬上失敗，
  // 一次性涵蓋所有 initDb() 階段可能撞到的鎖定衝突（不只是欄位新增，包含
  // journal_mode 切換、CREATE TABLE 等所有寫入語句）。
  conn.pragma('busy_timeout = 5000')
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

  // Migration：舊資料庫檔案可能沒有 description 欄位，用 PRAGMA 檢查後補上。
  // 併發初始化時仍可能兩個 process 都判定「欄位不存在」而搶著 ALTER TABLE，
  // 交給 addColumnIfMissing 吞掉良性的 duplicate column 錯誤（見上方註解）。
  const taskColumns = conn.prepare('PRAGMA table_info(tasks)').all()
  const hasDescription = taskColumns.some((col) => col.name === 'description')
  if (!hasDescription) {
    addColumnIfMissing(conn, 'tasks', `description TEXT NOT NULL DEFAULT ''`)
  }

  const hasTargetPath = taskColumns.some((col) => col.name === 'target_path')
  if (!hasTargetPath) {
    addColumnIfMissing(conn, 'tasks', `target_path TEXT NOT NULL DEFAULT ''`)
  }

  const hasAutomationStatus = taskColumns.some((col) => col.name === 'automation_status')
  if (!hasAutomationStatus) {
    addColumnIfMissing(conn, 'tasks', `automation_status TEXT NOT NULL DEFAULT 'idle'`)
  }

  const hasDueDate = taskColumns.some((col) => col.name === 'due_date')
  if (!hasDueDate) {
    addColumnIfMissing(conn, 'tasks', `due_date TEXT`)
  }

  const hasAutomationSkill = taskColumns.some((col) => col.name === 'automation_skill')
  if (!hasAutomationSkill) {
    addColumnIfMissing(conn, 'tasks', `automation_skill TEXT NOT NULL DEFAULT ''`)
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
    addColumnIfMissing(conn, 'automation_runs', `worktree_path TEXT NOT NULL DEFAULT ''`)
  }
  const hasWorktreeBranch = runColumns.some((col) => col.name === 'worktree_branch')
  if (!hasWorktreeBranch) {
    addColumnIfMissing(conn, 'automation_runs', `worktree_branch TEXT NOT NULL DEFAULT ''`)
  }
  const hasRunSkill = runColumns.some((col) => col.name === 'skill')
  if (!hasRunSkill) {
    addColumnIfMissing(conn, 'automation_runs', `skill TEXT NOT NULL DEFAULT ''`)
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
