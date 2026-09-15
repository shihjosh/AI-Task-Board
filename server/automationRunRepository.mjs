import { randomUUID } from 'node:crypto'
import * as db from './db/index.mjs'

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

export async function listAutomationRuns(taskId) {
  const rows = await db.all(
    'SELECT * FROM automation_runs WHERE task_id = ? ORDER BY started_at ASC',
    [taskId],
  )
  return rows.map(rowToRun)
}

export async function createAutomationRun(taskId, { prompt, skill }) {
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  await db.run(
    `INSERT INTO automation_runs (id, task_id, status, prompt, output, error, started_at, finished_at, skill, worktree_path, worktree_branch)
     VALUES (?, ?, 'running', ?, '', NULL, ?, NULL, ?, '', '')`,
    [id, taskId, prompt, startedAt, skill ?? ''],
  )
  const row = await db.get('SELECT * FROM automation_runs WHERE id = ?', [id])
  return rowToRun(row)
}

export async function updateAutomationRun(id, { status, output, error, worktreePath, worktreeBranch }) {
  const existing = await db.get('SELECT * FROM automation_runs WHERE id = ?', [id])
  if (!existing) return null
  const finishedAt = new Date().toISOString()
  await db.run(
    `UPDATE automation_runs SET status = ?, output = ?, error = ?, finished_at = ?,
     worktree_path = ?, worktree_branch = ?
     WHERE id = ?`,
    [
      status,
      output ?? existing.output,
      error ?? null,
      finishedAt,
      worktreePath ?? existing.worktree_path,
      worktreeBranch ?? existing.worktree_branch,
      id,
    ],
  )
  const row = await db.get('SELECT * FROM automation_runs WHERE id = ?', [id])
  return rowToRun(row)
}

export async function appendAutomationRunOutput(id, chunk) {
  const existing = await db.get('SELECT output FROM automation_runs WHERE id = ?', [id])
  if (!existing) return
  await db.run('UPDATE automation_runs SET output = ? WHERE id = ?', [
    existing.output + chunk,
    id,
  ])
}
