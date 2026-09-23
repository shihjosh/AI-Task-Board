import pg from 'pg'

const { Pool } = pg

let pool

function getPool() {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'DB_DRIVER=postgres 需要設定 DATABASE_URL 環境變數（例如 postgres://user:pass@host:5432/dbname）',
    )
  }
  pool = new Pool({ connectionString })
  return pool
}

async function columnExists(client, table, column) {
  const result = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  )
  return result.rowCount > 0
}

export async function init() {
  const client = getPool()

  await client.query(`
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

  if (!(await columnExists(client, 'tasks', 'description'))) {
    await client.query(`ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
  }
  if (!(await columnExists(client, 'tasks', 'target_path'))) {
    await client.query(`ALTER TABLE tasks ADD COLUMN target_path TEXT NOT NULL DEFAULT ''`)
  }
  if (!(await columnExists(client, 'tasks', 'automation_status'))) {
    await client.query(
      `ALTER TABLE tasks ADD COLUMN automation_status TEXT NOT NULL DEFAULT 'idle'`,
    )
  }
  if (!(await columnExists(client, 'tasks', 'due_date'))) {
    await client.query(`ALTER TABLE tasks ADD COLUMN due_date TEXT`)
  }
  if (!(await columnExists(client, 'tasks', 'automation_skill'))) {
    await client.query(`ALTER TABLE tasks ADD COLUMN automation_skill TEXT NOT NULL DEFAULT ''`)
  }
  if (!(await columnExists(client, 'tasks', 'automation_disabled'))) {
    await client.query(
      `ALTER TABLE tasks ADD COLUMN automation_disabled INTEGER NOT NULL DEFAULT 0`,
    )
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  await client.query(`
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      output TEXT NOT NULL DEFAULT '',
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      worktree_path TEXT NOT NULL DEFAULT '',
      worktree_branch TEXT NOT NULL DEFAULT '',
      skill TEXT NOT NULL DEFAULT ''
    )
  `)

  if (!(await columnExists(client, 'automation_runs', 'worktree_path'))) {
    await client.query(
      `ALTER TABLE automation_runs ADD COLUMN worktree_path TEXT NOT NULL DEFAULT ''`,
    )
  }
  if (!(await columnExists(client, 'automation_runs', 'worktree_branch'))) {
    await client.query(
      `ALTER TABLE automation_runs ADD COLUMN worktree_branch TEXT NOT NULL DEFAULT ''`,
    )
  }
  if (!(await columnExists(client, 'automation_runs', 'skill'))) {
    await client.query(`ALTER TABLE automation_runs ADD COLUMN skill TEXT NOT NULL DEFAULT ''`)
  }
}

// 統一介面：SQL 用 $1, $2... placeholder（Postgres 原生語法），
// 回傳 { rows, rowCount } 與 pg 原生行為一致。
export async function query(sql, params = []) {
  const client = getPool()
  return client.query(sql, params)
}
