import { randomUUID } from 'node:crypto'
import * as db from './db/index.mjs'

function rowToComment(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listComments(taskId) {
  const rows = await db.all('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC', [
    taskId,
  ])
  return rows.map(rowToComment)
}

export async function createComment(taskId, content) {
  const now = new Date().toISOString()
  const id = randomUUID()
  await db.run(
    `INSERT INTO comments (id, task_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, taskId, content, now, now],
  )
  const row = await db.get('SELECT * FROM comments WHERE id = ?', [id])
  return rowToComment(row)
}

export async function updateComment(id, content) {
  const existing = await db.get('SELECT * FROM comments WHERE id = ?', [id])
  if (!existing) return null
  const now = new Date().toISOString()
  await db.run('UPDATE comments SET content = ?, updated_at = ? WHERE id = ?', [content, now, id])
  const row = await db.get('SELECT * FROM comments WHERE id = ?', [id])
  return rowToComment(row)
}

export async function deleteComment(id) {
  const result = await db.run('DELETE FROM comments WHERE id = ?', [id])
  return result.changes > 0
}
