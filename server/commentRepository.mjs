import { randomUUID } from 'node:crypto'
import { getDb } from './db.mjs'

function rowToComment(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listComments(taskId) {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId)
  return rows.map(rowToComment)
}

export function createComment(taskId, content) {
  const db = getDb()
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO comments (id, task_id, content, created_at, updated_at)
     VALUES (@id, @taskId, @content, @createdAt, @updatedAt)`,
  ).run({ id, taskId, content, createdAt: now, updatedAt: now })
  return rowToComment(db.prepare('SELECT * FROM comments WHERE id = ?').get(id))
}

export function updateComment(id, content) {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM comments WHERE id = ?').get(id)
  if (!existing) return null
  const now = new Date().toISOString()
  db.prepare('UPDATE comments SET content = ?, updated_at = ? WHERE id = ?').run(content, now, id)
  return rowToComment(db.prepare('SELECT * FROM comments WHERE id = ?').get(id))
}

export function deleteComment(id) {
  const db = getDb()
  const result = db.prepare('DELETE FROM comments WHERE id = ?').run(id)
  return result.changes > 0
}
