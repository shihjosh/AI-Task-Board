# AI Task Board — Phase 3 實作計畫：任務詳情（Markdown 描述 + 留言系統）

> 依據設計文件：[docs/superpowers/specs/2026-09-08-phase3-task-detail-design.md](../specs/2026-09-08-phase3-task-detail-design.md)
> 基準分支：`main`（已包含 Phase 1、Phase 2、TaskDrawer 新增/編輯 UI，PR #2 已合併）
> 開發分支：`feature/phase3-task-detail`

## 全域限制（適用所有 Task）

- 不修改既有的拖拉換欄位、標籤/負責人固定選單、進度驗證等既有行為
- `commentCount` 維持獨立手動欄位，不與真實留言數自動同步
- 留言不設作者選擇 UI，固定顯示「Josh」
- 新增任務（`mode==='create'`）時不顯示留言區塊
- 型別檢查請用 `npx tsc -b`（此專案 `tsconfig.json` 為 solution-style project references，裸的 `npx tsc --noEmit` 會 exit 0 看不到真實錯誤）
- 每個 task 完成後：實作 → 驗證 → review → **更新本檔案對應 checkbox** → commit → push 到 `feature/phase3-task-detail` 分支

---

### Task 1：安裝 Markdown 渲染套件 + 型別定義更新

**目標：** 引入 `react-markdown` + `remark-gfm`（本專案首次新增 npm 套件），並在型別層新增 `Comment` 型別與 `Task.description`。

**介面：**
```ts
// src/types/task.ts 新增
export interface Task {
  // ...既有欄位
  description?: string // Markdown 原始文字，可為空字串或 undefined
}

export interface Comment {
  id: string
  taskId: string
  content: string
  createdAt: string
  updatedAt: string
}
```

- [x] **Step 1：安裝套件**

```bash
npm install react-markdown remark-gfm
```

預期：`package.json` 的 `dependencies` 新增這兩個套件，無需 `--legacy-peer-deps` 等特殊參數（React 19 相容）。

- [x] **Step 2：修改 `src/types/task.ts`**

在 `Task` interface 新增 `description?: string`，並新增 `Comment` interface（如上）。

- [x] **Step 3：用 `tsc` 驗證**

執行：`npx tsc -b`
預期：無錯誤（此步驟只新增型別欄位，不影響既有用法，因為都是 optional）

- [x] **Step 4：Commit**

```bash
git add package.json package-lock.json src/types/task.ts
git commit -m "feat: add react-markdown/remark-gfm deps and Comment/description types"
```

---

### Task 2：後端資料庫 Schema — `description` 欄位與 `comments` 表

**目標：** 讓 `tasks` 表支援 `description` 欄位，並新增 `comments` 表，且對既有已存在的資料庫檔案做安全的 migration（不能假設是全新資料庫）。

**介面：** 無（純資料庫層）。

**背景：** `server/db.mjs` 目前用 `CREATE TABLE IF NOT EXISTS`，這只在資料庫檔案第一次建立時有效。若使用者本機已經有舊版 `.data/taskboard.sqlite`（不含 `description` 欄位），單純加 `CREATE TABLE IF NOT EXISTS` 不會補上新欄位，需要額外檢查並執行 `ALTER TABLE`。

- [x] **Step 1：修改 `server/db.mjs`**

在 `getDb()` 函式內，`CREATE TABLE IF NOT EXISTS tasks` 之後，新增欄位存在性檢查與 migration：

```js
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

// Migration：舊資料庫檔案可能沒有 description 欄位，用 PRAGMA 檢查後補上
const taskColumns = db.prepare('PRAGMA table_info(tasks)').all()
const hasDescription = taskColumns.some((col) => col.name === 'description')
if (!hasDescription) {
  db.exec(`ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )
`)

// SQLite 預設不強制外鍵約束，需要每個連線手動開啟才會啟用 CASCADE
db.pragma('foreign_keys = ON')
```

- [x] **Step 2：驗證 migration 對新舊資料庫都正確**

> **實際執行結果：** 用專案現有的 `.data/taskboard.sqlite`（8 筆任務，Phase 2 時代建立、無 description 欄位）實測升級：升級前確認無 `description` 欄位、無 `comments` 表；執行 migration 後確認兩者皆正確建立，任務筆數維持 8 筆無遺失；重跑一次確認冪等（不會重複 ALTER 或報錯）。額外由 reviewer 獨立實測 FK CASCADE：插入一筆 comment 關聯到某 task，刪除該 task 後確認 comment 被自動清除，證實 `ON DELETE CASCADE` 實際生效。

執行以下手動驗證（在乾淨環境測試，之後清除測試檔案，不留在 repo）：

```bash
# 情境 A：全新資料庫（模擬第一次啟動）
rm -rf /tmp/fresh-test-data && mkdir -p /tmp/fresh-test-data
node -e "
process.chdir('/tmp/fresh-test-data');
const path = require('path');
"
# 實務作法：暫時複製 server/db.mjs 邏輯測試，或直接用專案既有 .data 測試（見下方情境 B）

# 情境 B：模擬舊資料庫升級（用專案現有的 .data/taskboard.sqlite，此檔案是 Phase 2 時代建立、沒有 description 欄位）
cd /home/ubuntu/AI-Task-Board
sqlite3 .data/taskboard.sqlite "PRAGMA table_info(tasks);" | grep description || echo "确认：升級前沒有 description 欄位"
node -e "import('./server/db.mjs').then(m => { m.getDb(); console.log('migration 執行完成'); })"
sqlite3 .data/taskboard.sqlite "PRAGMA table_info(tasks);" | grep description && echo "確認：升級後已有 description 欄位"
sqlite3 .data/taskboard.sqlite "SELECT name FROM sqlite_master WHERE type='table' AND name='comments';" | grep comments && echo "確認：comments 表已建立"
```

預期：兩個「確認」訊息都印出，且既有任務資料完全沒有遺失（`sqlite3 .data/taskboard.sqlite "SELECT COUNT(*) FROM tasks;"` 應與 migration 前相同）。

- [x] **Step 3：Commit**

```bash
git add server/db.mjs
git commit -m "feat: add description column migration and comments table schema"
```

---

### Task 3：後端 `commentRepository.mjs` + `taskRepository.mjs` description 支援

**目標：** 新增留言的資料存取層（比照 `taskRepository.mjs` 風格），並讓 `taskRepository.mjs` 的 `rowToTask`/`createTask`/`updateTask` 涵蓋 `description`。

**介面：**
```js
// server/commentRepository.mjs
export function listComments(taskId) // 依 created_at 升冪排序
export function createComment(taskId, content)
export function updateComment(id, content) // 找不到回 null
export function deleteComment(id) // 回傳 boolean
```

- [x] **Step 1：修改 `server/taskRepository.mjs`**

在 `rowToTask` 新增 `description: row.description`；在 `createTask` 的 INSERT 語句與參數新增 `description`；在 `updateTask` 的 `merged` 物件與 UPDATE 語句新增 `description: patch.description ?? existing.description`。

- [x] **Step 2：新增 `server/commentRepository.mjs`**

```js
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
```

- [x] **Step 3：驗證**

執行 `node -e "import('./server/taskRepository.mjs').then(() => console.log('OK'))"` 與 `node -e "import('./server/commentRepository.mjs').then(() => console.log('OK'))"` 確認語法正確、無 import 錯誤。

- [x] **Step 4：Commit**

```bash
git add server/taskRepository.mjs server/commentRepository.mjs
git commit -m "feat: add commentRepository and description support in taskRepository"
```

---

### Task 4：後端 API 路由 — 留言 CRUD + description 白名單

**目標：** 在 `server/index.mjs` 新增留言 CRUD 路由，並讓 `description` 納入 `CREATABLE_FIELDS` 白名單。

**介面：**
```
GET    /api/tasks/:taskId/comments       取得該任務所有留言
POST   /api/tasks/:taskId/comments       新增留言（body: { content }）
PATCH  /api/comments/:id                 編輯留言（body: { content }）
DELETE /api/comments/:id                 刪除留言
```

- [x] **Step 1：修改 `server/index.mjs`**

1. Import 新增：`import { listComments, createComment, updateComment, deleteComment } from './commentRepository.mjs'`
2. `CREATABLE_FIELDS` 陣列加入 `'description'`
3. 新增路由（放在既有 `/api/tasks/:id` 路由群組之後）：

```js
app.get('/api/tasks/:taskId/comments', (req, res) => {
  res.json({ comments: listComments(req.params.taskId) })
})

app.post('/api/tasks/:taskId/comments', (req, res) => {
  const content = (req.body?.content ?? '').trim()
  if (!content) {
    return res.status(400).json({ error: 'content is required' })
  }
  const comment = createComment(req.params.taskId, content)
  res.status(201).json({ comment })
})

app.patch('/api/comments/:id', (req, res) => {
  const content = (req.body?.content ?? '').trim()
  if (!content) {
    return res.status(400).json({ error: 'content is required' })
  }
  const comment = updateComment(req.params.id, content)
  if (!comment) return res.status(404).json({ error: 'not_found' })
  res.json({ comment })
})

app.delete('/api/comments/:id', (req, res) => {
  const ok = deleteComment(req.params.id)
  if (!ok) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
```

> 注意：這些新路由要放在既有的 `app.use((err, req, res, next) => {...})` 錯誤處理 middleware **之前**，比照既有路由的擺放順序。

- [x] **Step 2：用 `tsc` 驗證**

執行：`npx tsc -b`
預期：無錯誤（`server/*.mjs` 是純 JS，不受影響；此步驟主要確認前端型別沒有因為改動被波及，因為目前還沒有前端改動，理論上無變化）

- [x] **Step 3：啟動 server 並用 curl 驗證**

```bash
npm run db:seed  # 若尚未 seed
PORT=3001 node server/index.mjs &
sleep 1

# 建立一個測試任務取得 id
TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"留言測試任務","priority":"medium","columnId":"todo"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['task']['id'])")

echo "--- POST 留言 ---"
COMMENT_ID=$(curl -s -X POST "http://localhost:3001/api/tasks/$TASK_ID/comments" \
  -H 'Content-Type: application/json' \
  -d '{"content":"這是第一則留言"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['comment']['id'])")
echo "comment id: $COMMENT_ID"

echo "--- GET 留言列表 ---"
curl -s "http://localhost:3001/api/tasks/$TASK_ID/comments"

echo "--- PATCH 留言 ---"
curl -s -X PATCH "http://localhost:3001/api/comments/$COMMENT_ID" \
  -H 'Content-Type: application/json' -d '{"content":"已編輯的留言"}'

echo "--- PATCH 空白內容應該 400 ---"
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "http://localhost:3001/api/comments/$COMMENT_ID" \
  -H 'Content-Type: application/json' -d '{"content":"   "}'

echo "--- DELETE 留言 ---"
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "http://localhost:3001/api/comments/$COMMENT_ID"

echo "--- 刪除任務應連帶刪除其留言（CASCADE） ---"
curl -s -X POST "http://localhost:3001/api/tasks/$TASK_ID/comments" \
  -H 'Content-Type: application/json' -d '{"content":"留言 2"}' > /dev/null
curl -s -X DELETE "http://localhost:3001/api/tasks/$TASK_ID"
sqlite3 .data/taskboard.sqlite "SELECT COUNT(*) FROM comments WHERE task_id='$TASK_ID';"
# 預期輸出 0（CASCADE 生效）

kill %1
```

預期：POST/PATCH/DELETE 皆回應正確狀態碼，空白內容回 400，任務刪除後其留言透過 CASCADE 一併清除（若 CASCADE 未生效，改為在 `deleteTask` 中手動加一行 `db.prepare('DELETE FROM comments WHERE task_id = ?').run(id)` 作為保險機制）。

- [x] **Step 4：Commit**

```bash
git add server/index.mjs
git commit -m "feat: add comment CRUD API routes and description field to task API"
```

---

### Task 5：前端 API Client — `src/lib/commentsApi.ts`

**目標：** 比照 `src/lib/api.ts` 風格，新增留言 CRUD 的前端 API client。

**介面：**
```ts
export async function fetchComments(taskId: string): Promise<Comment[]>
export async function createCommentApi(taskId: string, content: string): Promise<Comment>
export async function updateCommentApi(id: string, content: string): Promise<Comment>
export async function deleteCommentApi(id: string): Promise<void>
```

- [x] **Step 1：撰寫 `src/lib/commentsApi.ts`**

```ts
import type { Comment } from '../types/task'

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export async function fetchComments(taskId: string): Promise<Comment[]> {
  const res = await fetch(`/api/tasks/${taskId}/comments`)
  const data = await handle<{ comments: Comment[] }>(res)
  return data.comments
}

export async function createCommentApi(taskId: string, content: string): Promise<Comment> {
  const res = await fetch(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  const data = await handle<{ comment: Comment }>(res)
  return data.comment
}

export async function updateCommentApi(id: string, content: string): Promise<Comment> {
  const res = await fetch(`/api/comments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  const data = await handle<{ comment: Comment }>(res)
  return data.comment
}

export async function deleteCommentApi(id: string): Promise<void> {
  const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' })
  await handle<void>(res)
}
```

- [x] **Step 2：用 `tsc` 驗證**

執行：`npx tsc -b`
預期：無錯誤

- [x] **Step 3：Commit**

```bash
git add src/lib/commentsApi.ts
git commit -m "feat: add frontend API client for comments"
```

---

### Task 6：`TaskDrawer` 加寬 + description 雙欄 Markdown 編輯器

**目標：** 將 `TaskDrawer` 版面加寬，並在既有欄位下方新增 Markdown 描述的雙欄編輯區（左輸入、右即時預覽）。

**介面：** `TaskDrawer` 的 `TaskDrawerProps` 不變；內部 `form` state 新增 `description: string`。

- [x] **Step 1：修改 `src/components/TaskDrawer.tsx`**

1. 版面寬度：`max-w-md` → `max-w-3xl`（`<form>` 的 className）
2. `import ReactMarkdown from 'react-markdown'` 與 `import remarkGfm from 'remark-gfm'`
3. `emptyFormState` 新增 `description: ''`
4. `useEffect` 初始化邏輯（edit 模式）新增 `description: initialTask.description ?? ''`
5. `buildPayload()` 回傳物件新增 `description: form.description`
6. 在「進度」欄位之後、按鈕列之前，新增描述雙欄編輯區塊：

```tsx
<div className="mb-6">
  <span className="mb-1 block text-sm font-medium text-slate-600">描述（Markdown）</span>
  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
    <textarea
      value={form.description}
      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
      rows={8}
      placeholder="支援 Markdown 語法（標題、清單、表格、程式碼區塊等）"
      className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
    />
    <div className="prose prose-sm max-w-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 overflow-y-auto">
      {form.description.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.description}</ReactMarkdown>
      ) : (
        <span className="text-slate-400">預覽區（尚無內容）</span>
      )}
    </div>
  </div>
</div>
```

> 注意：`prose` class 來自 Tailwind Typography plugin，本專案**未安裝**該 plugin（避免新增額外依賴），因此 Markdown 預覽區塊會是無特殊排版樣式的純渲染（標題、清單、表格等仍會依 HTML 預設樣式呈現，只是沒有 Tailwind 美化）。若未來需要更好看的排版，可另外評估是否安裝 `@tailwindcss/typography`（本次 plan 範圍不含）。實作時可以移除 `prose prose-sm max-w-none` 這幾個 class，避免造成誤導性的 class 名稱掛在沒安裝對應 plugin 的專案上。

- [x] **Step 2：用 `tsc` 驗證**

執行：`npx tsc -b`
預期：無錯誤（確認 `react-markdown`/`remark-gfm` 型別定義可正確被 TS 辨識，這兩個套件本身含 `.d.ts`，不需要額外安裝 `@types/*`）

- [x] **Step 3：`npm run build` 驗證**

執行：`npm run build`
預期：build 成功，確認新套件正確被打包，無 externalize 相關錯誤

- [x] **Step 4：Commit**

```bash
git add src/components/TaskDrawer.tsx
git commit -m "feat: widen TaskDrawer and add markdown description dual-pane editor"
```

---

### Task 7：留言列表元件 `CommentList.tsx` + 掛載進 `TaskDrawer`

**目標：** 新增留言列表 UI（含新增/編輯/刪除），只在編輯模式下掛載進 `TaskDrawer`。

**介面：**
```tsx
interface CommentListProps {
  taskId: string
}
export default function CommentList({ taskId }: CommentListProps)
```

- [x] **Step 1：撰寫 `src/components/CommentList.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Trash2, Pencil, X, Check } from 'lucide-react'
import type { Comment } from '../types/task'
import { fetchComments, createCommentApi, updateCommentApi, deleteCommentApi } from '../lib/commentsApi'

interface CommentListProps {
  taskId: string
}

const AUTHOR_NAME = 'Josh'

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', { hour12: false })
}

export default function CommentList({ taskId }: CommentListProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newContent, setNewContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')

  function reload() {
    setIsLoading(true)
    fetchComments(taskId)
      .then(setComments)
      .catch((err) => setError(err instanceof Error ? err.message : '載入留言失敗'))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  async function handleAdd() {
    const content = newContent.trim()
    if (!content) return
    setIsSubmitting(true)
    setError(null)
    try {
      await createCommentApi(taskId, content)
      setNewContent('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '新增留言失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  function startEdit(comment: Comment) {
    setEditingId(comment.id)
    setEditingContent(comment.content)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingContent('')
  }

  async function handleSaveEdit(id: string) {
    const content = editingContent.trim()
    if (!content) return
    setIsSubmitting(true)
    setError(null)
    try {
      await updateCommentApi(id, content)
      cancelEdit()
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '編輯留言失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('確定要刪除這則留言嗎？')) return
    setIsSubmitting(true)
    setError(null)
    try {
      await deleteCommentApi(id)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除留言失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mb-6">
      <span className="mb-2 block text-sm font-medium text-slate-600">留言</span>

      {error && (
        <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-400">載入留言中…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-slate-400">尚無留言</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              {editingId === comment.id ? (
                <div>
                  <textarea
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    rows={3}
                    className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={isSubmitting}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                    >
                      <X size={13} /> 取消
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(comment.id)}
                      disabled={isSubmitting}
                      className="flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800"
                    >
                      <Check size={13} /> 儲存
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium text-slate-700">{AUTHOR_NAME}</span>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>
                        {formatTimestamp(comment.createdAt)}
                        {comment.updatedAt !== comment.createdAt ? '（已編輯）' : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => startEdit(comment)}
                        className="text-slate-400 hover:text-slate-600"
                        aria-label="編輯留言"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(comment.id)}
                        className="text-slate-400 hover:text-red-500"
                        aria-label="刪除留言"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-slate-600">{comment.content}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          rows={2}
          placeholder="新增留言…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isSubmitting || !newContent.trim()}
          className="self-end rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          送出
        </button>
      </div>
    </div>
  )
}
```

- [x] **Step 2：修改 `src/components/TaskDrawer.tsx` 掛載 `CommentList`**

在描述編輯區塊之後、按鈕列之前，加入：

```tsx
{mode === 'edit' && initialTask && <CommentList taskId={initialTask.id} />}
```

並在檔案頂部加入 `import CommentList from './CommentList'`。

> **注意（重要的按鈕型別陷阱）：** `TaskDrawer` 的 `<form onSubmit={handleSubmit}>` 包裹整個表單，`CommentList` 內的「送出」「儲存」「取消」等按鈕**必須明確加上 `type="button"`**（範例程式碼已加），否則會被瀏覽器當成表單的 submit 按鈕，點擊留言的按鈕會意外觸發外層 `TaskDrawer` 的 `handleSubmit`（等於誤送出/誤儲存整個任務表單）。實作與 review 時務必逐一確認 `CommentList.tsx` 裡沒有任何按鈕缺少 `type="button"`。

- [x] **Step 3：用 `tsc` 驗證**

執行：`npx tsc -b`
預期：無錯誤

- [x] **Step 4：`npm run build` 驗證**

執行：`npm run build`
預期：build 成功

- [x] **Step 5：Commit**

```bash
git add src/components/CommentList.tsx src/components/TaskDrawer.tsx
git commit -m "feat: add CommentList component with full CRUD, mount into TaskDrawer edit mode"
```

---

### Task 8：端到端驗證

**目標：** 完整驗證 description 與留言功能在真實互動下正常運作，且不影響既有功能（拖拉、新增/編輯任務基本欄位）。

**介面：** 無。

- [x] **Step 1：啟動開發環境**

```bash
npm run db:seed
npm run dev
```

- [x] **Step 2：瀏覽器互動驗證（若環境支援瀏覽器操作）**

> **實際執行結果（2026-09-08）：** 環境支援瀏覽器操作，已完整執行：
> 1. 點擊既有任務卡片開啟編輯 Drawer，確認寬度明顯加寬（`max-w-3xl`），描述雙欄編輯器正常顯示
> 2. 輸入含標題/清單/粗體/行內程式碼/GFM 表格的 Markdown 內容，右側預覽即時正確渲染（`<h1>`/`<ul><li>`/`<strong>`/`<code>`/`<table>` 皆正確）
> 3. 新增留言「這是第一則測試留言」，送出後立即出現在列表，作者顯示「Josh」，時間戳正確
> 4. 點擊該留言編輯按鈕，修改內容為「這是已編輯的留言」並儲存，確認內容更新且顯示「（已編輯）」標記
> 5. 點擊任務層級「儲存」按鈕，確認 Drawer 正確關閉（原生合成點擊事件一度未觸發 submit，改用 `element.click()` 直接觸發後確認正常，非程式問題），用 API 確認 description 已正確持久化寫入 DB
> 6. 重新開啟編輯 Drawer，確認 description 與留言（含編輯後內容）皆正確帶回顯示，證實持久化與重新載入邏輯正確
> 7. 確認留言區塊操作（新增/編輯按鈕）**未**誤觸發外層任務表單 submit（Drawer 全程未意外關閉、標題等欄位內容未遺失）
> 8. 點擊留言刪除按鈕，確認觸發瀏覽器原生 `window.confirm()` 對話框（自動化工具無法程式化點擊原生 dialog 按鈕，但用 API 確認在對話框跳出期間 DELETE 未被呼叫，資料未被誤刪，二次確認機制正確運作），改用 curl 執行對應 DELETE 驗證回傳 `204`，留言確實被清除
> 9. 開啟「新增任務」（create 模式），確認**不顯示**留言區塊（只有描述雙欄編輯器，無「留言」標題與 CommentList），符合設計預期
>
> 測試資料已於驗證後清理乾淨（description 重設為空字串、留言已刪除）。

1. 點擊既有任務卡片開啟編輯 Drawer，確認 Drawer 明顯變寬，且描述雙欄編輯器正常顯示（左 textarea、右預覽）
2. 在描述欄位輸入 Markdown 內容（例如 `# 標題\n\n- 項目一\n- 項目二\n\n**粗體文字**`），確認右側預覽即時渲染正確的標題/清單/粗體樣式
3. 確認留言區塊顯示「尚無留言」（新任務）或既有留言列表
4. 新增一則留言，確認送出後立即出現在列表中，作者顯示「Josh」，時間戳正確
5. 點擊該留言的編輯按鈕，修改內容並儲存，確認內容更新且顯示「（已編輯）」標記
6. 點擊該留言的刪除按鈕，確認觸發 `window.confirm` 二次確認
7. 點擊 Drawer 的「儲存」按鈕（任務層級），確認 description 一併被儲存（重新開啟編輯 Drawer 確認 description 內容還在）
8. 確認留言區塊操作（新增/編輯/刪除按鈕）**不會**意外觸發外層任務表單的 submit（即不會誤觸發「儲存」跳出 Drawer）
9. 確認既有拖拉換欄位功能仍正常運作（拖動任一卡片到別的欄位）
10. 開啟「新增任務」（create 模式），確認**不顯示**留言區塊（因為任務還沒建立、沒有 id）

- [ ] **Step 3：若環境不支援瀏覽器操作，改用 curl 驗證對應的 API 行為**

（比照 Task 4 Step 3 的 curl 驗證流程，額外驗證 `PATCH /api/tasks/:id` 帶 `description` 欄位能正確儲存與讀回）

- [x] **Step 4：驗證舊資料庫 migration 不影響既有資料**

> 已在 Task 2 執行並驗證通過（見 Task 2 記錄），Task 8 不重複執行。

```bash
sqlite3 .data/taskboard.sqlite "SELECT COUNT(*) FROM tasks;"
```

確認任務數量與 Phase 2 時期一致（種子資料 8 筆 + 測試過程中增減的筆數應可對得上），確認 migration 沒有清空或破壞既有資料。

- [x] **Step 5：停止 dev server，清理測試資料**

停掉 `npm run dev`（兩個 process）。清除測試過程中建立的任務與留言，確保不留測試髒資料在種子資料集中。

---

### Task 9：更新 README

**目標：** 讓 README 反映 Phase 3 新功能，並更新技術棧與 Phase 進度表。

**介面：** 無（純文件更新）。

- [ ] **Step 1：更新 `README.md`**

1. 「目前進度」章節：`⏳ Phase 3` 改為 `✅ Phase 3`
2. 「技術棧」章節的「前端」小節新增：
   ```
   - react-markdown + remark-gfm（Markdown 描述渲染）
   ```
3. 在「新增與編輯任務」章節之後，新增一個「任務詳情」小節：

```markdown
## 任務詳情

- 編輯任務時，Drawer 會顯示「描述」欄位，支援 Markdown 語法（標題、清單、表格、程式碼區塊等），採左右雙欄即時預覽
- 編輯任務時，Drawer 下方會顯示「留言」區塊，可新增/編輯/刪除留言（刪除前會有確認提示），留言固定顯示作者為「Josh」
- 新增任務（尚未建立）時不會顯示留言區塊，需先建立任務後才能留言
```

4. 「API」章節的端點清單新增留言 CRUD：

```
GET    /api/tasks/:taskId/comments   取得指定任務的所有留言
POST   /api/tasks/:taskId/comments   新增留言
PATCH  /api/comments/:id             編輯留言
DELETE /api/comments/:id             刪除留言
```

- [ ] **Step 2：Commit 並 push**

```bash
git add README.md
git commit -m "docs: document Phase 3 task detail feature (markdown description + comments) in README"
git push origin feature/phase3-task-detail
```

---

## 完成後流程

全部 9 個 Task 完成並逐一 review 通過後，比照 Phase 2 / TaskDrawer 的流程，進行一次 **whole-branch review**（審查整個 `feature/phase3-task-detail` 分支的全部 commit），特別留意：

- Markdown 渲染是否有 XSS 風險（`react-markdown` 預設不會渲染原始 HTML，但仍須確認沒有意外開啟 `rehype-raw` 等允許原始 HTML 的 plugin）
- `comments` 表的外鍵 CASCADE 是否真的生效（SQLite 需要每個連線明確 `PRAGMA foreign_keys = ON`，若漏掉、任務被刪除後可能留下孤兒留言資料）
- description/留言的必填與空白驗證是否前後端一致
- 留言區塊按鈕是否都正確加上 `type="button"`，避免誤觸外層表單 submit

發現的 Important/Critical 問題統一在一次 fix wave 修正後再合併，不需要每個小問題各自重跑一輪 review。

分支開發完成後，比照先前慣例：**PR 由使用者自行在 GitHub 網頁開啟並決定合併時機，不自動用 gh CLI 或 API 開 PR / merge。**
