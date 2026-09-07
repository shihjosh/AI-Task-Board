# Phase 2: SQLite Backend + Task CRUD API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single Node.js/Express server that serves the built React SPA and exposes a `/api/tasks` REST CRUD backed by SQLite (better-sqlite3), replacing the current hardcoded `mockTasks.ts` data source, while keeping local dev with Vite HMR working via a proxy.

**Architecture:** One Express server (`server/index.mjs`) owns two responsibilities: serving `dist/` static files in production, and exposing `/api/tasks` REST endpoints backed by a `better-sqlite3` database at `.data/taskboard.sqlite`. In dev, Vite (port 8088) proxies `/api` to the Express server (port 3001) so HMR keeps working. The frontend replaces its `mockTasks` import with a small `src/lib/api.ts` client and loads/persists tasks through it.

**Tech Stack:** Node.js, Express, better-sqlite3, nanoid (id generation), Vite dev proxy, existing React/TS/Tailwind/dnd-kit frontend.

## Global Constraints

- SQLite database file lives at `.data/taskboard.sqlite` (gitignored, Docker volume-mounted for persistence).
- Single Node server in production/Docker — no nginx, no separate API container.
- Dev mode keeps Vite HMR: Vite dev server on port 8088 proxies `/api/*` to Express on port 3001.
- API contract is exactly: `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id`.
- `tasks` table columns: `id, title, priority, tags (json text), assignees (json text), progress, comment_count, has_unread, column_id, created_at, updated_at`.
- Existing frontend types (`src/types/task.ts`) and component props must not change shape — only the data source changes (API instead of mock array).

---

### Task 1: Backend dependencies and project layout

**Files:**
- Modify: `package.json` (add deps, add `dev:server` / `dev:client` / `dev` scripts)
- Create: `server/db.mjs`
- Create: `.data/.gitkeep`
- Modify: `.gitignore` (ignore `.data/*.sqlite`)

**Interfaces:**
- Produces: `server/db.mjs` exports `getDb()` returning a singleton `better-sqlite3` `Database` instance with the `tasks` table created if missing (schema per Global Constraints).

- [ ] **Step 1: Install backend dependencies**

```bash
npm install express better-sqlite3 nanoid
npm install -D concurrently
```

- [ ] **Step 2: Verify install**

Run: `node -e "require('better-sqlite3'); console.log('ok')"`
Expected: prints `ok` (confirms native binding built successfully on this platform)

- [ ] **Step 3: Create `.data/.gitkeep` and update `.gitignore`**

`.data/.gitkeep` — empty file, just to keep the directory tracked in git.

Add to `.gitignore`:
```
.data/*.sqlite
.data/*.sqlite-journal
```

- [ ] **Step 4: Write `server/db.mjs`**

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

- [ ] **Step 5: Verify table creation**

Run: `node -e "import('./server/db.mjs').then(m => { m.getDb(); console.log('table ready') })"`
Expected: prints `table ready`, and `.data/taskboard.sqlite` file exists (`ls .data/`)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore server/db.mjs .data/.gitkeep
git commit -m "feat: add SQLite dependency and db module for Phase 2 backend"
```

---

### Task 2: Task repository (data access layer)

**Files:**
- Create: `server/taskRepository.mjs`

**Interfaces:**
- Consumes: `getDb()` from `server/db.mjs` (Task 1)
- Produces:
  - `listTasks(): TaskRow[]`
  - `createTask(input): TaskRow` — input: `{ title, priority, tags, assignees, progress, columnId }`
  - `updateTask(id, patch): TaskRow | null` — patch: partial fields, any subset
  - `deleteTask(id): boolean`
  - `TaskRow` shape (JS object, JSON-serializable): `{ id, title, priority, tags: array, assignees: array, progress: number|null, commentCount, hasUnread: boolean, columnId, createdAt, updatedAt }`

- [ ] **Step 1: Write `server/taskRepository.mjs`**

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

- [ ] **Step 2: Verify with a manual smoke script**

Run:
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
Expected: created task printed, appears in list, update reflects new title, delete returns `true`, task absent from final list.

- [ ] **Step 3: Commit**

```bash
git add server/taskRepository.mjs
git commit -m "feat: add task repository data access layer"
```

---

### Task 3: Express API server

**Files:**
- Create: `server/index.mjs`
- Modify: `package.json` (scripts: `dev:server`, `start`)

**Interfaces:**
- Consumes: `listTasks`, `createTask`, `updateTask`, `deleteTask` from `server/taskRepository.mjs` (Task 2)
- Produces: HTTP server listening on `process.env.PORT ?? 3001` (or `8088` when `SERVE_STATIC=true`, see Task 8) exposing:
  - `GET /api/tasks` → `200 { tasks: TaskRow[] }`
  - `POST /api/tasks` → `201 { task: TaskRow }` (body: `{ title, priority, tags?, assignees?, progress?, columnId }`; `400` if `title`/`priority`/`columnId` missing)
  - `PATCH /api/tasks/:id` → `200 { task: TaskRow }`; `404 { error: 'not_found' }` if id missing
  - `DELETE /api/tasks/:id` → `204` empty body; `404 { error: 'not_found' }` if id missing

- [ ] **Step 1: Write `server/index.mjs`**

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

- [ ] **Step 2: Add `dev:server` and `start` scripts to `package.json`**

```json
"dev:server": "node --watch server/index.mjs",
"start": "node server/index.mjs"
```

- [ ] **Step 3: Run server and verify with curl**

Run (in background): `PORT=3001 node server/index.mjs`

Then in another terminal:
```bash
curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test task","priority":"high","columnId":"todo"}'
```
Expected: `201` with JSON body containing `task.id`, `task.title == "Test task"`.

```bash
curl -s http://localhost:3001/api/tasks
```
Expected: `200` with `{"tasks":[{...the created task...}]}`.

```bash
curl -s -X PATCH http://localhost:3001/api/tasks/<id-from-above> \
  -H 'Content-Type: application/json' -d '{"columnId":"in_progress"}'
```
Expected: `200`, `task.columnId == "in_progress"`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3001/api/tasks/<id-from-above>
```
Expected: `204`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3001/api/tasks/does-not-exist
```
Expected: `404`.

Stop the server afterward.

- [ ] **Step 4: Commit**

```bash
git add server/index.mjs package.json
git commit -m "feat: add Express API server with task CRUD endpoints"
```

---

### Task 4: Seed script to migrate mock data into SQLite

**Files:**
- Create: `server/seed.mjs`
- Modify: `package.json` (script: `db:seed`)

**Interfaces:**
- Consumes: `createTask` from `server/taskRepository.mjs`, task/column data shape from `src/data/mockTasks.ts` (re-authored as plain JS literal here since `server/` runs under plain Node, not the Vite/TS toolchain)
- Produces: idempotent seed (skips insert if the `tasks` table is already non-empty)

- [ ] **Step 1: Write `server/seed.mjs`**

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

- [ ] **Step 2: Add `db:seed` script to `package.json`**

```json
"db:seed": "node server/seed.mjs"
```

- [ ] **Step 3: Run and verify**

Run: `rm -f .data/taskboard.sqlite* && npm run db:seed`
Expected: `Seeded 8 tasks.`

Run again: `npm run db:seed`
Expected: `Tasks table already has data, skipping seed.` (idempotency check)

Run: `node -e "import('./server/taskRepository.mjs').then(r => console.log(r.listTasks().length))"`
Expected: `8`

- [ ] **Step 4: Commit**

```bash
git add server/seed.mjs package.json
git commit -m "feat: add idempotent seed script migrating mock tasks into SQLite"
```

---

### Task 5: Frontend API client

**Files:**
- Create: `src/lib/api.ts`

**Interfaces:**
- Consumes: `Task` type from `src/types/task.ts`
- Produces:
  - `fetchTasks(): Promise<Task[]>`
  - `createTaskApi(input: Omit<Task, 'id'>): Promise<Task>`
  - `updateTaskApi(id: string, patch: Partial<Task>): Promise<Task>`
  - `deleteTaskApi(id: string): Promise<void>`

- [ ] **Step 1: Write `src/lib/api.ts`**

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

- [ ] **Step 2: Verify with `tsc`**

Run: `npx tsc --noEmit`
Expected: no errors related to `src/lib/api.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add frontend API client for task CRUD"
```

---

### Task 6: Vite dev proxy configuration

**Files:**
- Modify: `vite.config.ts`

**Interfaces:**
- No new exports; adjusts dev server behavior only.

- [ ] **Step 1: Add proxy config to `vite.config.ts`**

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

- [ ] **Step 2: Verify proxy works end-to-end**

Run backend in one terminal: `npm run db:seed && npm run dev:server`
Run frontend in another: `npm run dev`

```bash
curl -s http://localhost:8088/api/tasks
```
Expected: `200` with the 8 seeded tasks (proxied through Vite to Express).

Stop both processes afterward.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "feat: proxy /api requests from Vite dev server to Express backend"
```

---

### Task 7: Wire App.tsx to the API instead of mock data

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/BoardColumn.tsx` (only if drop-column callback signature needs adjusting — see Step 1 note)
- Delete: `src/data/mockTasks.ts` import usage (file itself can stay for `columns` export, see Step 1)

**Interfaces:**
- Consumes: `fetchTasks`, `updateTaskApi` from `src/lib/api.ts` (Task 5)
- Produces: `App.tsx` loads tasks from the API on mount, shows a loading state, and calls `updateTaskApi` when a drag-and-drop changes a task's `columnId` (optimistic UI update, API call fire-and-forget with console.error on failure — no rollback UI in this POC phase)

- [ ] **Step 1: Split `mockTasks.ts` — keep `columns`, drop the `mockTasks` array export**

`src/data/mockTasks.ts` currently exports both `columns` (static column definitions, still needed) and `mockTasks` (the array to remove). Rename the file to `src/data/columns.ts` keeping only the `columns` export, and delete the `mockTasks` array entirely.

```typescript
// src/data/columns.ts
import type { Column } from '../types/task'

export const columns: Column[] = [
  { id: 'todo', title: '等待認領', colorClass: 'bg-slate-100 text-slate-600 border-slate-200' },
  { id: 'in_progress', title: '處理中', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'review', title: '等你確認', colorClass: 'bg-sky-50 text-sky-700 border-sky-200' },
]
```

Delete `src/data/mockTasks.ts`.

- [ ] **Step 2: Update `src/App.tsx` to load from API and persist column moves**

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

- [ ] **Step 3: Verify with `tsc` and manual browser check**

Run: `npx tsc --noEmit`
Expected: no errors.

Run backend + frontend dev servers (as in Task 6, Step 2), open `http://localhost:8088` in a browser (or `curl -s http://localhost:8088/ | head -5` to confirm HTML loads).
Manually drag a card between columns in the browser; refresh the page; confirm the card stayed in the new column (proves persistence round-trip).

Stop both dev servers afterward.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/data/columns.ts
git rm src/data/mockTasks.ts
git commit -m "feat: load tasks from API and persist column moves on drag-and-drop"
```

---

### Task 8: Single-container Docker setup (Node serves API + static files)

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `server/index.mjs` (serve static files when `dist/` exists)
- Remove: `nginx.conf` (no longer used)

**Interfaces:**
- Modifies `server/index.mjs`'s existing Express app to also serve `dist/` as static root and fall back to `dist/index.html` for non-API routes (SPA routing), listening on `process.env.PORT ?? 3001` — Docker will set `PORT=8088`.

- [ ] **Step 1: Update `server/index.mjs` to serve static frontend files**

Add near the top (after `app.use(express.json())`) and at the bottom (after the API routes, before `app.listen`):

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

(Place the `import` lines with the other imports at the top of the file, and the `if (fs.existsSync(distDir))` block after all `/api/*` route definitions but before `app.listen(...)`.)

- [ ] **Step 2: Rewrite `Dockerfile` for single-container build**

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

- [ ] **Step 3: Rewrite `docker-compose.yml` for single service**

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

- [ ] **Step 4: Remove obsolete `nginx.conf`**

```bash
git rm nginx.conf
```

- [ ] **Step 5: Update `.dockerignore`**

Ensure `.data` is excluded from the build context (it's runtime state, not build input):

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

- [ ] **Step 6: Build and verify the container end-to-end**

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
Expected: `HTML:200`; first `/api/tasks` call returns `{"tasks":[]}` (fresh DB, no seed run in container); POST returns `201` with the new task; second `/api/tasks` call shows the new task persisted.

```bash
docker rm -f ai-task-board-test
```

- [ ] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml server/index.mjs .dockerignore
git rm nginx.conf
git commit -m "feat: single-container Docker setup serving API and static frontend"
git push origin main
```

---

### Task 9: Update README and spec cross-references

**Files:**
- Modify: `README.md`

**Interfaces:** None (documentation only).

- [ ] **Step 1: Update `README.md`**

- Change Phase 2 status from "🚧 設計完成，開發中" to "✅ 完成"
- Update "開發" section: add concrete commands for running both dev servers (`npm run db:seed`, `npm run dev:server`, `npm run dev` in separate terminals)
- Update "Docker" section: remove references to nginx, note the `.data` volume persists SQLite data across container restarts
- Update "專案結構" tree to include `server/` directory (`server/index.mjs`, `server/db.mjs`, `server/taskRepository.mjs`, `server/seed.mjs`) and `src/lib/api.ts`, and remove `nginx.conf`

- [ ] **Step 2: Commit and push**

```bash
git add README.md
git commit -m "docs: update README for Phase 2 completion (SQLite backend + API)"
git push origin main
```
