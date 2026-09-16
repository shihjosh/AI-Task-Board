import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { recoverInterruptedRuns } from '../server/db.mjs'

function makeTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE tasks (
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
      updated_at TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      target_path TEXT NOT NULL DEFAULT '',
      automation_status TEXT NOT NULL DEFAULT 'idle',
      due_date TEXT,
      automation_skill TEXT NOT NULL DEFAULT ''
    )
  `)
  db.exec(`
    CREATE TABLE automation_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
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
  return db
}

test('recoverInterruptedRuns marks running tasks and runs as interrupted', () => {
  const db = makeTestDb()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO tasks (id, title, priority, column_id, created_at, updated_at, automation_status)
     VALUES ('t1', 'stuck task', 'high', 'in_progress', ?, ?, 'running')`,
  ).run(now, now)
  db.prepare(
    `INSERT INTO tasks (id, title, priority, column_id, created_at, updated_at, automation_status)
     VALUES ('t2', 'idle task', 'low', 'todo', ?, ?, 'idle')`,
  ).run(now, now)
  db.prepare(
    `INSERT INTO automation_runs (id, task_id, status, prompt, started_at)
     VALUES ('r1', 't1', 'running', 'do the thing', ?)`,
  ).run(now)
  db.prepare(
    `INSERT INTO automation_runs (id, task_id, status, prompt, started_at, finished_at)
     VALUES ('r2', 't1', 'done', 'earlier run', ?, ?)`,
  ).run(now, now)

  const result = recoverInterruptedRuns(db)

  assert.equal(result.tasksRecovered, 1)
  assert.equal(result.runsRecovered, 1)

  const t1 = db.prepare('SELECT * FROM tasks WHERE id = ?').get('t1')
  assert.equal(t1.automation_status, 'interrupted')
  const t2 = db.prepare('SELECT * FROM tasks WHERE id = ?').get('t2')
  assert.equal(t2.automation_status, 'idle') // 未受影響

  const r1 = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get('r1')
  assert.equal(r1.status, 'interrupted')
  assert.match(r1.error, /伺服器重啟或程序中斷/)
  assert.ok(r1.finished_at)

  const r2 = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get('r2')
  assert.equal(r2.status, 'done') // 未受影響
})

test('recoverInterruptedRuns is a no-op when nothing is running', () => {
  const db = makeTestDb()
  const result = recoverInterruptedRuns(db)
  assert.equal(result.tasksRecovered, 0)
  assert.equal(result.runsRecovered, 0)
})
