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

// Server 啟動時呼叫一次：把資料庫裡殘留的 automation_status='running' 或
// 'queued' 標記為 interrupted。這個併發控制（automationRunner.mjs 的
// runningCount/queue）只存在單一 Node process 記憶體中，server 重啟後這些記憶體
// 狀態全部歸零，但資料庫裡對應的 automation_status 仍停留在 running 或
// queued，永遠不會自己更新——因此只要偵測到 running 或 queued，就一定是舊
// process 遺留下來的孤兒，不需要額外確認該 process 是否還活著。佇列中的任務
// 同樣只存在於記憶體 queue 陣列，重啟後一併歸零，因此視為同一類孤兒狀態。
//
// 兩個 UPDATE（automation_runs 與 tasks）各自獨立執行、不包在同一個 transaction
// 裡：server/db/index.mjs 的統一介面（all/get/run）同時支援 sqlite 與 postgres
// 兩種驅動，並未暴露跨驅動一致的 transaction API，貿然引入單一驅動特有的
// transaction 寫法會破壞這層抽象的可替換性。
export async function recoverInterruptedRuns() {
  const now = new Date().toISOString()

  const runsResult = await db.run(
    `UPDATE automation_runs
     SET status = 'interrupted',
         error = '伺服器重啟或程序中斷，執行狀態不明（原本狀態：running 或 queued）',
         finished_at = ?
     WHERE status IN ('running', 'queued')`,
    [now],
  )

  const tasksResult = await db.run(
    `UPDATE tasks SET automation_status = 'interrupted' WHERE automation_status IN ('running', 'queued')`,
  )

  return {
    tasksRecovered: tasksResult.changes,
    runsRecovered: runsResult.changes,
  }
}
