# Phase 2：SQLite 後端 + Task CRUD API 實作計畫

> **給 agent 執行者：** 必要子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐一 Task 執行本計畫。步驟採用 checkbox（`- [ ]`）語法追蹤進度。

**目標：** 新增一個單一的 Node.js/Express server，同時 serve build 好的 React SPA，並提供以 SQLite（better-sqlite3）為後端的 `/api/tasks` REST CRUD，取代目前寫死的 `mockTasks.ts` 資料來源，同時保留本機開發時 Vite HMR 透過 proxy 正常運作。

**架構：** 一個 Express server（`server/index.mjs`）負責兩件事：正式環境 serve `dist/` 靜態檔案，以及提供以 `better-sqlite3` 資料庫（`.data/taskboard.sqlite`）為後端的 `/api/tasks` REST 端點。開發模式下，Vite（8088 port）會將 `/api` proxy 到 Express（3001 port），維持 HMR 正常運作。前端則以一個小型 `src/lib/api.ts` client 取代原本的 `mockTasks` import，透過它載入/儲存任務。

**技術棧：** Node.js、Express、better-sqlite3、nanoid（產生 id）、Vite dev proxy，以及既有的 React/TS/Tailwind/dnd-kit 前端。

## 全域限制（Global Constraints）

- SQLite 資料庫檔案位於 `.data/taskboard.sqlite`（已加入 .gitignore，Docker 用 volume 掛載以持久化）。
- 正式環境／Docker 只用單一 Node server —— 不使用 nginx，也不拆成獨立的 API container。
- 開發模式維持 Vite HMR：Vite dev server（8088 port）將 `/api/*` proxy 到 Express（3001 port）。
- API 規格明確為：`GET /api/tasks`、`POST /api/tasks`、`PATCH /api/tasks/:id`、`DELETE /api/tasks/:id`。
- `tasks` 資料表欄位：`id, title, priority, tags (json text), assignees (json text), progress, comment_count, has_unread, column_id, created_at, updated_at`。
- 既有前端型別（`src/types/task.ts`）與元件 props 的形狀不可變動 —— 只改變資料來源（從 API 取代 mock 陣列）。

---

### Task 1：後端依賴套件與專案結構

**檔案：**
- 修改：`package.json`（新增依賴、新增 `dev:server` / `dev:client` / `dev` scripts）
- 新增：`server/db.mjs`
- 新增：`.data/.gitkeep`
- 修改：`.gitignore`（忽略 `.data/*.sqlite`）

**介面：**
- 產出：`server/db.mjs` 匯出 `getDb()`，回傳一個單例（singleton）的 `better-sqlite3` `Database` 實例，若 `tasks` 資料表不存在會自動建立（欄位定義依全域限制）。

- [ ] **Step 1：安裝後端依賴套件**

```bash
npm install express better-sqlite3 nanoid
npm install -D concurrently
```

- [ ] **Step 2：驗證安裝**

執行：`node -e "require('better-sqlite3'); console.log('ok')"`
預期：印出 `ok`（確認 native binding 在此平台編譯成功）

- [ ] **Step 3：建立 `.data/.gitkeep` 並更新 `.gitignore`**

`.data/.gitkeep` —— 空檔案，僅用來讓此目錄被 git 追蹤。

在 `.gitignore` 加入：
```
.data/*.sqlite
.data/*.sqlite-journal
```

- [ ] **Step 4：撰寫 `server/db.mjs`**

```javascript
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', '.data')
const dbPath = path.join(dataDir, 'taskboard.sqlite')

let db

export function getDb() {
  if (db) return db

  fs.mkdirSync(dataDir, { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
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

  return db
}
```

- [ ] **Step 5：驗證資料表建立**

執行：`node -e "import('./server/db.mjs').then(m => { m.getDb(); console.log('table ready') })"`
預期：印出 `table ready`，且 `.data/taskboard.sqlite` 檔案存在（用 `ls .data/` 確認）

- [ ] **Step 6：Commit**

```bash
git add package.json package-lock.json .gitignore server/db.mjs .data/.gitkeep
git commit -m "feat: add SQLite dependency and db module for Phase 2 backend"
```

---

### Task 2：Task Repository（資料存取層）

**檔案：**
- 新增：`server/taskRepository.mjs`

**介面：**
- 消費：`server/db.mjs`（Task 1）的 `getDb()`
- 產出：
  - `listTasks(): TaskRow[]`
  - `createTask(input): TaskRow` —— input：`{ title, priority, tags, assignees, progress, columnId }`
  - `updateTask(id, patch): TaskRow | null` —— patch：任意欄位子集
  - `deleteTask(id): boolean`
  - `TaskRow` 形狀（JS 物件，可 JSON 序列化）：`{ id, title, priority, tags: array, assignees: array, progress: number|null, commentCount, hasUnread: boolean, columnId, createdAt, updatedAt }`

- [ ] **Step 1：撰寫 `server/taskRepository.mjs`**

```javascript
import { randomUUID } from 'node:crypto'
import { getDb } from './db.mjs'

function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    tags: JSON.parse(row.tags),
    assignees: JSON.parse(row.assignees),
    progress: row.progress === null ? undefined : row.progress,
    commentCount: row.comment_count,
    hasUnread: !!row.has_unread,
    columnId: row.column_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    `INSERT INTO tasks (id, title, priority, tags, assignees, progress, comment_count, has_unread, column_id, created_at, updated_at)
     VALUES (@id, @title, @priority, @tags, @assignees, @progress, @commentCount, @hasUnread, @columnId, @createdAt, @updatedAt)`,
  ).run({
    id,
    title: input.title,
    priority: input.priority,
    tags: JSON.stringify(input.tags ?? []),
    assignees: JSON.stringify(input.assignees ?? []),
    progress: input.progress ?? null,
    commentCount: input.commentCount ?? 0,
    hasUnread: input.hasUnread ? 1 : 0,
    columnId: input.columnId,
    createdAt: now,
    updatedAt: now,
  })

  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
}

export function updateTask(id, patch) {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  if (!existing) return null

  const merged = {
    title: patch.title ?? existing.title,
    priority: patch.priority ?? existing.priority,
    tags: patch.tags ? JSON.stringify(patch.tags) : existing.tags,
    assignees: patch.assignees ? JSON.stringify(patch.assignees) : existing.assignees,
    progress: patch.progress !== undefined ? patch.progress : existing.progress,
    commentCount: patch.commentCount ?? existing.comment_count,
    hasUnread: patch.hasUnread !== undefined ? (patch.hasUnread ? 1 : 0) : existing.has_unread,
    columnId: patch.columnId ?? existing.column_id,
    updatedAt: new Date().toISOString(),
  }

  db.prepare(
    `UPDATE tasks SET title=@title, priority=@priority, tags=@tags, assignees=@assignees,
     progress=@progress, comment_count=@commentCount, has_unread=@hasUnread,
     column_id=@columnId, updated_at=@updatedAt WHERE id=@id`,
  ).run({ ...merged, id })

  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
}

export function deleteTask(id) {
  const db = getDb()
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  return result.changes > 0
}
```

- [ ] **Step 2：用手動 smoke script 驗證**

執行：
```bash
node -e "
import('./server/taskRepository.mjs').then(repo => {
  const t = repo.createTask({ title: 'Smoke test', priority: 'low', columnId: 'todo' })
  console.log('created', t)
  console.log('list', repo.listTasks())
  console.log('updated', repo.updateTask(t.id, { title: 'Updated' }))
  console.log('deleted', repo.deleteTask(t.id))
  console.log('list after delete', repo.listTasks())
})
"
```
預期：印出建立的任務、出現在列表中、更新後標題正確、刪除回傳 `true`、最終列表中不再有該任務。

- [ ] **Step 3：Commit**

```bash
git add server/taskRepository.mjs
git commit -m "feat: add task repository data access layer"
```

---

### Task 3：Express API Server

**檔案：**
- 新增：`server/index.mjs`
- 修改：`package.json`（scripts：`dev:server`、`start`）

**介面：**
- 消費：`server/taskRepository.mjs`（Task 2）的 `listTasks`、`createTask`、`updateTask`、`deleteTask`
- 產出：HTTP server 監聽 `process.env.PORT ?? 3001`（當 `SERVE_STATIC=true` 時為 `8088`，見 Task 8），提供：
  - `GET /api/tasks` → `200 { tasks: TaskRow[] }`
  - `POST /api/tasks` → `201 { task: TaskRow }`（body：`{ title, priority, tags?, assignees?, progress?, columnId }`；若缺少 `title`/`priority`/`columnId` 則 `400`）
  - `PATCH /api/tasks/:id` → `200 { task: TaskRow }`；找不到 id 則 `404 { error: 'not_found' }`
  - `DELETE /api/tasks/:id` → `204` 空 body；找不到 id 則 `404 { error: 'not_found' }`

- [ ] **Step 1：撰寫 `server/index.mjs`**

```javascript
import express from 'express'
import { listTasks, createTask, updateTask, deleteTask } from './taskRepository.mjs'

const app = express()
app.use(express.json())

app.get('/api/tasks', (req, res) => {
  res.json({ tasks: listTasks() })
})

app.post('/api/tasks', (req, res) => {
  const { title, priority, columnId } = req.body ?? {}
  if (!title || !priority || !columnId) {
    return res.status(400).json({ error: 'title, priority, and columnId are required' })
  }
  const task = createTask(req.body)
  res.status(201).json({ task })
})

app.patch('/api/tasks/:id', (req, res) => {
  const task = updateTask(req.params.id, req.body ?? {})
  if (!task) return res.status(404).json({ error: 'not_found' })
  res.json({ task })
})

app.delete('/api/tasks/:id', (req, res) => {
  const ok = deleteTask(req.params.id)
  if (!ok) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

const port = process.env.PORT ?? 3001
app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
})
```

- [ ] **Step 2：在 `package.json` 加入 `dev:server` 與 `start` scripts**

```json
"dev:server": "node --watch server/index.mjs",
"start": "node server/index.mjs"
```

- [ ] **Step 3：啟動 server 並用 curl 驗證**

執行（背景）：`PORT=3001 node server/index.mjs`

接著在另一個 terminal：
```bash
curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test task","priority":"high","columnId":"todo"}'
```
預期：`201`，JSON body 包含 `task.id`、`task.title == "Test task"`。

```bash
curl -s http://localhost:3001/api/tasks
```
預期：`200`，`{"tasks":[{...剛建立的任務...}]}`。

```bash
curl -s -X PATCH http://localhost:3001/api/tasks/<上面的 id> \
  -H 'Content-Type: application/json' -d '{"columnId":"in_progress"}'
```
預期：`200`，`task.columnId == "in_progress"`。

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3001/api/tasks/<上面的 id>
```
預期：`204`。

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3001/api/tasks/does-not-exist
```
預期：`404`。

驗證完成後記得停掉 server。

- [ ] **Step 4：Commit**

```bash
git add server/index.mjs package.json
git commit -m "feat: add Express API server with task CRUD endpoints"
```

---

### Task 4：把 mock 資料遷移到 SQLite 的 Seed Script

**檔案：**
- 新增：`server/seed.mjs`
- 修改：`package.json`（script：`db:seed`）

**介面：**
- 消費：`server/taskRepository.mjs` 的 `createTask`，資料形狀取自 `src/data/mockTasks.ts`（因 `server/` 在純 Node 環境執行，非 Vite/TS toolchain，此處重新以純 JS literal 撰寫）
- 產出：冪等（idempotent）seed（若 `tasks` 資料表已有資料則跳過寫入）

- [ ] **Step 1：撰寫 `server/seed.mjs`**

```javascript
import { listTasks, createTask } from './taskRepository.mjs'

const seedTasks = [
  { id: 'LOCAL-5', title: '議題中如果圖片太小，應該以實際尺寸顯示', priority: 'high', tags: [{ type: 'issue', label: 'Issue' }], assignees: [{ id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' }], commentCount: 1, columnId: 'todo' },
  { id: 'LOCAL-8', title: '看板卡片支援多標籤篩選', priority: 'medium', tags: [{ type: 'github', label: 'GitHub' }], assignees: [{ id: 'u2', name: 'Amy', avatarColor: 'bg-orange-500', initials: 'AM' }], commentCount: 0, columnId: 'todo' },
  { id: 'LOCAL-12', title: '雲端登入與多人即時協作', priority: 'high', tags: [{ type: 'pr', label: 'PR #40' }], assignees: [{ id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' }, { id: 'u3', name: 'Ken', avatarColor: 'bg-blue-500', initials: 'KN' }], progress: 65, commentCount: 3, columnId: 'in_progress' },
  { id: 'LOCAL-15', title: '暗色主題與 PR #40 收斂', priority: 'medium', tags: [{ type: 'pr', label: 'PR #40' }], assignees: [{ id: 'u3', name: 'Ken', avatarColor: 'bg-blue-500', initials: 'KN' }], progress: 30, commentCount: 2, columnId: 'in_progress' },
  { id: 'LOCAL-18', title: '任務詳情頁 Markdown 渲染優化', priority: 'low', tags: [{ type: 'issue', label: 'Issue' }], assignees: [{ id: 'u2', name: 'Amy', avatarColor: 'bg-orange-500', initials: 'AM' }], progress: 80, commentCount: 0, columnId: 'in_progress' },
  { id: 'LOCAL-21', title: '拖拉排序在行動裝置上偶爾失效', priority: 'high', tags: [{ type: 'bug', label: 'BUG' }], assignees: [{ id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' }], commentCount: 5, hasUnread: true, columnId: 'review' },
  { id: 'LOCAL-24', title: '看板欄位標題可自訂顏色', priority: 'medium', tags: [{ type: 'github', label: 'GitHub' }], assignees: [{ id: 'u2', name: 'Amy', avatarColor: 'bg-orange-500', initials: 'AM' }, { id: 'u3', name: 'Ken', avatarColor: 'bg-blue-500', initials: 'KN' }], commentCount: 2, hasUnread: true, columnId: 'review' },
  { id: 'LOCAL-27', title: '匯出看板資料為 CSV', priority: 'low', tags: [{ type: 'issue', label: 'Issue' }], assignees: [{ id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' }], commentCount: 0, columnId: 'review' },
]

function seed() {
  if (listTasks().length > 0) {
    console.log('Tasks table already has data, skipping seed.')
    return
  }
  for (const task of seedTasks) {
    createTask(task)
  }
  console.log(`Seeded ${seedTasks.length} tasks.`)
}

seed()
```

- [ ] **Step 2：在 `package.json` 加入 `db:seed` script**

```json
"db:seed": "node server/seed.mjs"
```

- [ ] **Step 3：執行並驗證**

執行：`rm -f .data/taskboard.sqlite* && npm run db:seed`
預期：`Seeded 8 tasks.`

再執行一次：`npm run db:seed`
預期：`Tasks table already has data, skipping seed.`（冪等性檢查）

執行：`node -e "import('./server/taskRepository.mjs').then(r => console.log(r.listTasks().length))"`
預期：`8`

- [ ] **Step 4：Commit**

```bash
git add server/seed.mjs package.json
git commit -m "feat: add idempotent seed script migrating mock tasks into SQLite"
```

---

### Task 5：前端 API Client

**檔案：**
- 新增：`src/lib/api.ts`

**介面：**
- 消費：`src/types/task.ts` 的 `Task` 型別
- 產出：
  - `fetchTasks(): Promise<Task[]>`
  - `createTaskApi(input: Omit<Task, 'id'>): Promise<Task>`
  - `updateTaskApi(id: string, patch: Partial<Task>): Promise<Task>`
  - `deleteTaskApi(id: string): Promise<void>`

- [ ] **Step 1：撰寫 `src/lib/api.ts`**

```typescript
import type { Task } from '../types/task'

const BASE = '/api/tasks'

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch(BASE)
  const data = await handle<{ tasks: Task[] }>(res)
  return data.tasks
}

export async function createTaskApi(input: Omit<Task, 'id'>): Promise<Task> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await handle<{ task: Task }>(res)
  return data.task
}

export async function updateTaskApi(id: string, patch: Partial<Task>): Promise<Task> {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const data = await handle<{ task: Task }>(res)
  return data.task
}

export async function deleteTaskApi(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' })
  await handle<void>(res)
}
```

- [ ] **Step 2：用 `tsc` 驗證**

執行：`npx tsc --noEmit`
預期：無與 `src/lib/api.ts` 相關的錯誤

- [ ] **Step 3：Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add frontend API client for task CRUD"
```

---

### Task 6：Vite Dev Proxy 設定

**檔案：**
- 修改：`vite.config.ts`

**介面：**
- 無新匯出；僅調整 dev server 行為。

- [ ] **Step 1：在 `vite.config.ts` 加入 proxy 設定**

```typescript
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 8088,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 2：驗證 proxy 端到端運作**

在一個 terminal 啟動後端：`npm run db:seed && npm run dev:server`
在另一個 terminal 啟動前端：`npm run dev`

```bash
curl -s http://localhost:8088/api/tasks
```
預期：`200`，回傳 8 筆種子任務（透過 Vite proxy 到 Express）。

驗證完成後記得停掉兩個 process。

- [ ] **Step 3：Commit**

```bash
git add vite.config.ts
git commit -m "feat: proxy /api requests from Vite dev server to Express backend"
```

---

### Task 7：讓 App.tsx 改接 API 而非 mock 資料

**檔案：**
- 修改：`src/App.tsx`
- 修改：`src/components/BoardColumn.tsx`（僅在放置欄位的 callback 簽名需要調整時 —— 見 Step 1 備註）
- 刪除：`src/data/mockTasks.ts` 的使用（檔案本身可保留 `columns` 匯出，見 Step 1）

**介面：**
- 消費：`src/lib/api.ts`（Task 5）的 `fetchTasks`、`updateTaskApi`
- 產出：`App.tsx` 在 mount 時從 API 載入任務、顯示載入狀態，並在拖拉改變任務 `columnId` 時呼叫 `updateTaskApi`（樂觀 UI 更新，API 呼叫為 fire-and-forget，失敗時 console.error —— 此 POC 階段不做 rollback UI）

- [ ] **Step 1：拆分 `mockTasks.ts` —— 保留 `columns`，移除 `mockTasks` 陣列匯出**

`src/data/mockTasks.ts` 目前同時匯出 `columns`（靜態欄位定義，仍需要）與 `mockTasks`（要移除的陣列）。將檔案重新命名為 `src/data/columns.ts`，只保留 `columns` 匯出，並完全刪除 `mockTasks` 陣列。

```typescript
// src/data/columns.ts
import type { Column } from '../types/task'

export const columns: Column[] = [
  { id: 'todo', title: '等待認領', colorClass: 'bg-slate-100 text-slate-600 border-slate-200' },
  { id: 'in_progress', title: '處理中', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'review', title: '等你確認', colorClass: 'bg-sky-50 text-sky-700 border-sky-200' },
]
```

刪除 `src/data/mockTasks.ts`。

- [ ] **Step 2：更新 `src/App.tsx`，改從 API 載入並持久化欄位移動**

```typescript
import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import Toolbar from './components/Toolbar'
import BoardColumn from './components/BoardColumn'
import TaskCard from './components/TaskCard'
import { columns } from './data/columns'
import { fetchTasks, updateTaskApi } from './lib/api'
import type { ColumnId, Task } from './types/task'

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  useEffect(() => {
    fetchTasks()
      .then(setTasks)
      .catch((err) => setLoadError(err.message))
      .finally(() => setIsLoading(false))
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const tasksByColumn = useMemo(() => {
    const map: Record<ColumnId, Task[]> = { todo: [], in_progress: [], review: [] }
    for (const task of tasks) {
      map[task.columnId].push(task)
    }
    return map
  }, [tasks])

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id)
    setActiveTask(task ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)
    if (!over) return

    const draggedTask = tasks.find((t) => t.id === active.id)
    if (!draggedTask) return

    const overId = over.id as string
    const overColumnId = (columns.find((c) => c.id === overId)?.id ??
      tasks.find((t) => t.id === overId)?.columnId) as ColumnId | undefined

    if (!overColumnId) return

    const columnChanged = draggedTask.columnId !== overColumnId

    setTasks((prev) => {
      const activeIndex = prev.findIndex((t) => t.id === active.id)
      if (activeIndex === -1) return prev

      if (!columnChanged) {
        const overIndex = prev.findIndex((t) => t.id === overId)
        if (overIndex === -1 || activeIndex === overIndex) return prev
        return arrayMove(prev, activeIndex, overIndex)
      }

      const updated = [...prev]
      updated[activeIndex] = { ...draggedTask, columnId: overColumnId }
      return updated
    })

    if (columnChanged) {
      updateTaskApi(draggedTask.id, { columnId: overColumnId }).catch((err) => {
        console.error('Failed to persist column change', err)
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        載入任務中…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-red-500">
        載入失敗：{loadError}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Toolbar />
      <main className="flex-1 overflow-x-auto bg-slate-50 px-6 py-5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4">
            {columns.map((column) => (
              <BoardColumn key={column.id} column={column} tasks={tasksByColumn[column.id]} />
            ))}
          </div>
          <DragOverlay>{activeTask ? <TaskCard task={activeTask} /> : null}</DragOverlay>
        </DndContext>
      </main>
    </div>
  )
}
```

- [ ] **Step 3：用 `tsc` 與手動瀏覽器檢查驗證**

執行：`npx tsc --noEmit`
預期：無錯誤。

啟動前後端 dev server（如 Task 6 Step 2），瀏覽器打開 `http://localhost:8088`（或 `curl -s http://localhost:8088/ | head -5` 確認 HTML 有載入）。
在瀏覽器中手動把一張卡片拖到另一個欄位；重新整理頁面；確認卡片仍停留在新欄位（證明持久化的往返流程正確）。

驗證完成後記得停掉兩個 dev server。

- [ ] **Step 4：Commit**

```bash
git add src/App.tsx src/data/columns.ts
git rm src/data/mockTasks.ts
git commit -m "feat: load tasks from API and persist column moves on drag-and-drop"
```

---

### Task 8：單一 Container Docker 設定（Node 同時 serve API + 靜態檔）

**檔案：**
- 修改：`Dockerfile`
- 修改：`docker-compose.yml`
- 修改：`server/index.mjs`（當 `dist/` 存在時 serve 靜態檔）
- 移除：`nginx.conf`（不再使用）

**介面：**
- 修改既有 `server/index.mjs` 的 Express app，讓它同時 serve `dist/` 作為靜態根目錄，並對非 API 路由 fallback 到 `dist/index.html`（SPA 路由），監聽 `process.env.PORT ?? 3001`（Docker 會設定 `PORT=8088`）。

- [ ] **Step 1：更新 `server/index.mjs` 以 serve 靜態前端檔案**

在頂部（`app.use(express.json())` 之後）與底部（API 路由之後、`app.listen` 之前）加入：

```javascript
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist')

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}
```

（將 `import` 那幾行放到檔案頂部與其他 import 一起；`if (fs.existsSync(distDir))` 區塊放在所有 `/api/*` 路由定義之後、`app.listen(...)` 之前。）

- [ ] **Step 2：改寫 `Dockerfile` 為單一 container 建置**

```dockerfile
# ---- Build stage ----
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8088

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 8088
VOLUME ["/app/.data"]

CMD ["node", "server/index.mjs"]
```

- [ ] **Step 3：改寫 `docker-compose.yml` 為單一 service**

```yaml
services:
  taskboard:
    build:
      context: .
      dockerfile: Dockerfile
    image: ai-task-board:latest
    container_name: ai-task-board
    ports:
      - "8088:8088"
    volumes:
      - taskboard-data:/app/.data
    restart: unless-stopped

volumes:
  taskboard-data:
```

- [ ] **Step 4：移除已不需要的 `nginx.conf`**

```bash
git rm nginx.conf
```

- [ ] **Step 5：更新 `.dockerignore`**

確保 `.data` 從 build context 排除（它是執行期狀態，不是建置輸入）：

```
node_modules
dist
.git
.gitignore
README.md
docs
*.md
.data
```

- [ ] **Step 6：建置並端到端驗證 container**

```bash
docker build -t ai-task-board:latest .
docker run -d --name ai-task-board-test -p 8088:8088 ai-task-board:latest
sleep 2
curl -s -o /dev/null -w "HTML:%{http_code}\n" http://localhost:8088/
curl -s http://localhost:8088/api/tasks
curl -s -X POST http://localhost:8088/api/tasks -H 'Content-Type: application/json' \
  -d '{"title":"Docker smoke test","priority":"low","columnId":"todo"}'
curl -s http://localhost:8088/api/tasks
```
預期：`HTML:200`；第一次 `/api/tasks` 呼叫回傳 `{"tasks":[]}`（全新資料庫，container 內未執行 seed）；POST 回傳 `201` 與新任務；第二次 `/api/tasks` 呼叫顯示新任務已持久化。

```bash
docker rm -f ai-task-board-test
```

- [ ] **Step 7：Commit**

```bash
git add Dockerfile docker-compose.yml server/index.mjs .dockerignore
git rm nginx.conf
git commit -m "feat: single-container Docker setup serving API and static frontend"
git push origin main
```

---

### Task 9：更新 README 與 spec 交叉引用

**檔案：**
- 修改：`README.md`

**介面：** 無（純文件更新）。

- [ ] **Step 1：更新 `README.md`**

- 將 Phase 2 狀態從「🚧 設計完成，開發中」改為「✅ 完成」
- 更新「開發」章節：加入同時啟動兩個 dev server 的具體指令（在不同 terminal 分別執行 `npm run db:seed`、`npm run dev:server`、`npm run dev`）
- 更新「Docker」章節：移除 nginx 相關描述，說明 `.data` volume 讓 SQLite 資料在 container 重啟後仍然保留
- 更新「專案結構」樹狀圖，加入 `server/` 目錄（`server/index.mjs`、`server/db.mjs`、`server/taskRepository.mjs`、`server/seed.mjs`）與 `src/lib/api.ts`，並移除 `nginx.conf`

- [ ] **Step 2：Commit 並 push**

```bash
git add README.md
git commit -m "docs: update README for Phase 2 completion (SQLite backend + API)"
git push origin main
```
