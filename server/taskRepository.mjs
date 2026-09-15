import { randomUUID } from 'node:crypto'
import * as db from './db/index.mjs'

function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    tags: JSON.parse(row.tags),
    assignees: JSON.parse(row.assignees),
    progress: row.progress === null ? undefined : row.progress,
    commentCount: row.comment_count,
    hasUnread: !!row.has_unread,
    columnId: row.column_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    targetPath: row.target_path,
    automationStatus: row.automation_status,
    dueDate: row.due_date ?? undefined,
    automationSkill: row.automation_skill || undefined,
  }
}

export async function listTasks() {
  const rows = await db.all('SELECT * FROM tasks ORDER BY created_at ASC')
  return rows.map(rowToTask)
}

export async function createTask(input) {
  const now = new Date().toISOString()
  const id = input.id ?? randomUUID()

  await db.run(
    `INSERT INTO tasks (id, title, description, priority, tags, assignees, progress, comment_count, has_unread, column_id, created_at, updated_at, target_path, automation_status, due_date, automation_skill)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.description ?? '',
      input.priority,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.assignees ?? []),
      input.progress ?? null,
      input.commentCount ?? 0,
      input.hasUnread ? 1 : 0,
      input.columnId,
      now,
      now,
      input.targetPath ?? '',
      input.automationStatus ?? 'idle',
      input.dueDate ?? null,
      input.automationSkill ?? '',
    ],
  )

  const row = await db.get('SELECT * FROM tasks WHERE id = ?', [id])
  return rowToTask(row)
}

export async function updateTask(id, patch) {
  const existing = await db.get('SELECT * FROM tasks WHERE id = ?', [id])
  if (!existing) return null

  const merged = {
    title: patch.title ?? existing.title,
    description: patch.description ?? existing.description,
    priority: patch.priority ?? existing.priority,
    tags: patch.tags ? JSON.stringify(patch.tags) : existing.tags,
    assignees: patch.assignees ? JSON.stringify(patch.assignees) : existing.assignees,
    progress: patch.progress !== undefined ? patch.progress : existing.progress,
    commentCount: patch.commentCount ?? existing.comment_count,
    hasUnread: patch.hasUnread !== undefined ? (patch.hasUnread ? 1 : 0) : existing.has_unread,
    columnId: patch.columnId ?? existing.column_id,
    updatedAt: new Date().toISOString(),
    targetPath: patch.targetPath ?? existing.target_path,
    automationStatus: patch.automationStatus ?? existing.automation_status,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : existing.due_date,
    automationSkill: patch.automationSkill ?? existing.automation_skill,
  }

  await db.run(
    `UPDATE tasks SET title=?, description=?, priority=?, tags=?, assignees=?,
     progress=?, comment_count=?, has_unread=?,
     column_id=?, updated_at=?, target_path=?, automation_status=?, due_date=?, automation_skill=? WHERE id=?`,
    [
      merged.title,
      merged.description,
      merged.priority,
      merged.tags,
      merged.assignees,
      merged.progress,
      merged.commentCount,
      merged.hasUnread,
      merged.columnId,
      merged.updatedAt,
      merged.targetPath,
      merged.automationStatus,
      merged.dueDate,
      merged.automationSkill,
      id,
    ],
  )

  const row = await db.get('SELECT * FROM tasks WHERE id = ?', [id])
  return rowToTask(row)
}

export async function deleteTask(id) {
  const result = await db.run('DELETE FROM tasks WHERE id = ?', [id])
  return result.changes > 0
}
