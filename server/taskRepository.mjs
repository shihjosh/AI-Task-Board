import { randomUUID } from 'node:crypto'
import { getDb } from './db.mjs'

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
  }
}

export function listTasks() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at ASC').all()
  return rows.map(rowToTask)
}

export function createTask(input) {
  const db = getDb()
  const now = new Date().toISOString()
  const id = input.id ?? randomUUID()

  db.prepare(
    `INSERT INTO tasks (id, title, description, priority, tags, assignees, progress, comment_count, has_unread, column_id, created_at, updated_at, target_path, automation_status, due_date)
     VALUES (@id, @title, @description, @priority, @tags, @assignees, @progress, @commentCount, @hasUnread, @columnId, @createdAt, @updatedAt, @targetPath, @automationStatus, @dueDate)`,
  ).run({
    id,
    title: input.title,
    description: input.description ?? '',
    priority: input.priority,
    tags: JSON.stringify(input.tags ?? []),
    assignees: JSON.stringify(input.assignees ?? []),
    progress: input.progress ?? null,
    commentCount: input.commentCount ?? 0,
    hasUnread: input.hasUnread ? 1 : 0,
    columnId: input.columnId,
    createdAt: now,
    updatedAt: now,
    targetPath: input.targetPath ?? '',
    automationStatus: input.automationStatus ?? 'idle',
    dueDate: input.dueDate ?? null,
  })

  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
}

export function updateTask(id, patch) {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
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
  }

  db.prepare(
    `UPDATE tasks SET title=@title, description=@description, priority=@priority, tags=@tags, assignees=@assignees,
     progress=@progress, comment_count=@commentCount, has_unread=@hasUnread,
     column_id=@columnId, updated_at=@updatedAt, target_path=@targetPath, automation_status=@automationStatus, due_date=@dueDate WHERE id=@id`,
  ).run({ ...merged, id })

  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
}

export function deleteTask(id) {
  const db = getDb()
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  return result.changes > 0
}
