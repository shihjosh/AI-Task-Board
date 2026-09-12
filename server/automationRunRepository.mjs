import { randomUUID } from 'node:crypto'
import { getDb } from './db.mjs'

function rowToRun(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    prompt: row.prompt,
    output: row.output,
    error: row.error ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    skill: row.skill || undefined,
    worktreePath: row.worktree_path || undefined,
    worktreeBranch: row.worktree_branch || undefined,
  }
}

export function listAutomationRuns(taskId) {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM automation_runs WHERE task_id = ? ORDER BY started_at ASC')
    .all(taskId)
  return rows.map(rowToRun)
}

export function createAutomationRun(taskId, { prompt, skill }) {
  const db = getDb()
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO automation_runs (id, task_id, status, prompt, output, error, started_at, finished_at, skill, worktree_path, worktree_branch)
     VALUES (@id, @taskId, 'running', @prompt, '', NULL, @startedAt, NULL, @skill, '', '')`,
  ).run({ id, taskId, prompt, startedAt, skill: skill ?? '' })
  return rowToRun(db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id))
}

export function updateAutomationRun(id, { status, output, error, worktreePath, worktreeBranch }) {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id)
  if (!existing) return null
  const finishedAt = new Date().toISOString()
  db.prepare(
    `UPDATE automation_runs SET status = @status, output = @output, error = @error, finished_at = @finishedAt,
     worktree_path = @worktreePath, worktree_branch = @worktreeBranch
     WHERE id = @id`,
  ).run({
    id,
    status,
    output: output ?? existing.output,
    error: error ?? null,
    finishedAt,
    worktreePath: worktreePath ?? existing.worktree_path,
    worktreeBranch: worktreeBranch ?? existing.worktree_branch,
  })
  return rowToRun(db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id))
}

export function appendAutomationRunOutput(id, chunk) {
  const db = getDb()
  const existing = db.prepare('SELECT output FROM automation_runs WHERE id = ?').get(id)
  if (!existing) return
  db.prepare('UPDATE automation_runs SET output = @output WHERE id = @id').run({
    id,
    output: existing.output + chunk,
  })
}
