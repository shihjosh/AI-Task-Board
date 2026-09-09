# TaskDrawer 頁籤化 + Hermes 執行紀錄獨立化 實作計畫

> **給執行的 agent：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐一任務執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤進度。

**目標：** ① 把 `TaskDrawer` 的描述欄位從左右並排改成「編輯 / 預覽」頁籤切換；② 把 Hermes 自動執行的結果從既有 `comments` 表完全分離，改用新的 `automation_runs` 表儲存，並在 `TaskDrawer` 下方新增「留言 / 執行紀錄」頁籤切換顯示。

**架構：** 新增 `automation_runs` SQLite 表與對應的 `automationRunRepository.mjs`，`automationRunner.mjs` 改為呼叫這個新 repository 而非 `createComment`。新增 `GET /api/tasks/:taskId/automation-runs` 唯讀端點。前端 `TaskDrawer` 新增兩組獨立的頁籤 state，新增 `AutomationRunList` 元件（唯讀）取代目前混在留言裡的執行結果顯示。

**技術選型：** 沿用既有技術棧（Express、better-sqlite3、React/TypeScript），不新增 npm 依賴。驗證方式為 curl + 瀏覽器手動測試，沿用本 repo 慣例。

## 全域限制條件

- 不新增任何 npm 依賴。
- 新資料表用 `CREATE TABLE IF NOT EXISTS`（不需要 migration 補丁，因為是全新表，非既有表加欄位）。
- 沿用既有 `db.pragma('foreign_keys = ON')`，讓 `automation_runs.task_id` 的 `ON DELETE CASCADE` 生效。
- `automation_runs` 為唯讀稽核紀錄：不開放任何 POST/PATCH/DELETE 端點，僅由 `automationRunner.mjs` 內部寫入。
- 兩組頁籤（描述的編輯/預覽、下方的留言/執行紀錄）都只在 `mode === 'edit' && initialTask` 時顯示，與現有 `CommentList` 顯示條件一致。
- 所有新增的使用者可見文字一律使用繁體中文。
- 舊資料不遷移：既有寫入 `comments` 表的 Hermes 執行紀錄維持原樣，不做搬移。

## 全域資料模型異動

```sql
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  output TEXT NOT NULL DEFAULT '',
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
)
```

`status` 可能的值：`'running' | 'done' | 'failed'`。

---

### Task 1：`automation_runs` 資料表 + `automationRunRepository.mjs`

**檔案：**
- 修改：`server/db.mjs`（在既有 `comments` 表建立之後，加入 `automation_runs` 表的 `CREATE TABLE IF NOT EXISTS`）
- 新增：`server/automationRunRepository.mjs`
- 修改：`src/types/task.ts`（新增 `AutomationRun` interface）

**介面：**
- 產出：`export function createAutomationRun(taskId, { prompt })` → 回傳新建的 run 物件（含 `id`, `status: 'running'`, `startedAt`）
- 產出：`export function updateAutomationRun(id, { status, output, error })` → 更新 run 並自動填入 `finishedAt`，回傳更新後的 run 物件
- 產出：`export function listAutomationRuns(taskId)` → 回傳依 `startedAt` 升冪排序的 run 陣列
- 產出：`AutomationRun` TypeScript interface：`{ id, taskId, status: 'running'|'done'|'failed', prompt, output, error?: string, startedAt, finishedAt?: string }`

- [x] **Step 1：在 `server/db.mjs` 加入 `automation_runs` 表**

在既有 `comments` 表的 `CREATE TABLE IF NOT EXISTS` 區塊之後（`db.pragma('foreign_keys = ON')` 之前或之後皆可，建議放在同一個 `db.exec` 呼叫鏈的最後）加入：

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      output TEXT NOT NULL DEFAULT '',
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)
```

- [x] **Step 2：撰寫 `server/automationRunRepository.mjs`**

```js
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
  }
}

export function listAutomationRuns(taskId) {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM automation_runs WHERE task_id = ? ORDER BY started_at ASC')
    .all(taskId)
  return rows.map(rowToRun)
}

export function createAutomationRun(taskId, { prompt }) {
  const db = getDb()
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO automation_runs (id, task_id, status, prompt, output, error, started_at, finished_at)
     VALUES (@id, @taskId, 'running', @prompt, '', NULL, @startedAt, NULL)`,
  ).run({ id, taskId, prompt, startedAt })
  return rowToRun(db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id))
}

export function updateAutomationRun(id, { status, output, error }) {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id)
  if (!existing) return null
  const finishedAt = new Date().toISOString()
  db.prepare(
    `UPDATE automation_runs SET status = @status, output = @output, error = @error, finished_at = @finishedAt
     WHERE id = @id`,
  ).run({
    id,
    status,
    output: output ?? existing.output,
    error: error ?? null,
    finishedAt,
  })
  return rowToRun(db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id))
}
```

- [x] **Step 3：在 `src/types/task.ts` 新增 `AutomationRun` interface**

```ts
export interface AutomationRun {
  id: string
  taskId: string
  status: 'running' | 'done' | 'failed'
  prompt: string
  output: string
  error?: string
  startedAt: string
  finishedAt?: string
}
```

- [x] **Step 4：手動驗證——建立、更新、列出 run**

```bash
node --input-type=module -e "
import { createTask, deleteTask } from './server/taskRepository.mjs'
import { createAutomationRun, updateAutomationRun, listAutomationRuns } from './server/automationRunRepository.mjs'
const task = createTask({ title: 'run repo test', priority: 'low', columnId: 'todo' })
const run = createAutomationRun(task.id, { prompt: 'test prompt' })
console.log('created:', JSON.stringify(run))
const updated = updateAutomationRun(run.id, { status: 'done', output: 'hello output' })
console.log('updated:', JSON.stringify(updated))
console.log('list:', JSON.stringify(listAutomationRuns(task.id)))
deleteTask(task.id)
process.exit(0)
"
```

預期結果：`created` 的 `status` 為 `running`、`finishedAt` 為 `undefined`；`updated` 的 `status` 為 `done`、`output` 為 `hello output`、`finishedAt` 有值；`list` 陣列包含這筆更新後的紀錄。刪除測試任務後，因 `ON DELETE CASCADE`，該筆 run 也應一併被刪除（可額外用 `sqlite3 .data/taskboard.sqlite "SELECT COUNT(*) FROM automation_runs WHERE task_id='<task.id>'"` 確認為 0，但因程序已結束、task.id 不易取得，此步驟為選用加強驗證）。

- [x] **Step 5：Commit**

```bash
git add server/db.mjs server/automationRunRepository.mjs src/types/task.ts
git commit -m "feat: add automation_runs table and repository"
```

---

### Task 2：`GET /api/tasks/:taskId/automation-runs` 端點 + `automationRunner.mjs` 改用新 repository

**檔案：**
- 修改：`server/index.mjs`（新增 GET 端點）
- 修改：`server/automationRunner.mjs`（改用 `createAutomationRun`/`updateAutomationRun` 取代 `createComment`）

**介面：**
- 消耗：Task 1 的 `createAutomationRun`、`updateAutomationRun`、`listAutomationRuns`
- 產出：`GET /api/tasks/:taskId/automation-runs` → `{ runs: AutomationRun[] }`（比照 `GET /api/tasks/:taskId/comments` 的回應格式，欄位改為 `runs`）

- [x] **Step 1：在 `server/index.mjs` 新增 GET 端點**

在既有 `app.get('/api/tasks/:taskId/comments', ...)` 之後加入：

```js
app.get('/api/tasks/:taskId/automation-runs', (req, res) => {
  res.json({ runs: listAutomationRuns(req.params.taskId) })
})
```

並在檔案頂端加入 import：

```js
import { listAutomationRuns } from './automationRunRepository.mjs'
```

- [x] **Step 2：修改 `server/automationRunner.mjs`，改用新 repository**

移除 `import { createComment } from './commentRepository.mjs'`，改為：

```js
import { createAutomationRun, updateAutomationRun } from './automationRunRepository.mjs'
```

`runOne(task)` 開頭（`updateTask(task.id, { automationStatus: 'running' })` 之後）新增：

```js
  const prompt = buildPrompt(task)
  const run = createAutomationRun(task.id, { prompt })
```

（原本 `const prompt = buildPrompt(task)` 這行往下移到這裡，取代原本單獨宣告 `prompt` 的位置）

`finishSuccess`、`finishFailed` 兩個函式簽章都加入 `run` 參數，內容改為：

```js
function finishSuccess(task, run, output) {
  updateAutomationRun(run.id, { status: 'done', output })
  updateTask(task.id, { automationStatus: 'done', columnId: 'review' })
  onSlotFreed()
}

function finishFailed(task, run, reason) {
  updateAutomationRun(run.id, { status: 'failed', error: reason })
  updateTask(task.id, { automationStatus: 'failed' })
  onSlotFreed()
}
```

`runOne` 內所有呼叫 `finishSuccess(task, ...)` / `finishFailed(task, ...)` 的地方，改為傳入 `run`：`finishSuccess(task, run, stdout)`、`finishFailed(task, run, ...)`（含 `child.on('error', ...)`、逾時、非 0 exit code 三處呼叫點）、以及 `catch (err) { finishFailed(task, run, ...) }` 的 spawn 同步例外分支。

`triggerAutomation(task)` 內「`targetPath` 無效」的提前失敗分支，原本呼叫 `createComment(...)`，改為：

```js
export function triggerAutomation(task) {
  if (!task.targetPath || !fs.existsSync(task.targetPath)) {
    const run = createAutomationRun(task.id, { prompt: buildPrompt(task) })
    updateAutomationRun(run.id, {
      status: 'failed',
      error: `targetPath「${task.targetPath}」不存在或未設定`,
    })
    updateTask(task.id, { automationStatus: 'failed' })
    return
  }
  ...
}
```

- [x] **Step 3：手動驗證——curl 呼叫新端點 + 確認執行紀錄不再寫進留言**

```bash
mkdir -p /tmp/automation-runs-test
node server/index.mjs &
```

（實際執行時改用 `terminal(background=true)` 啟動伺服器，見下方指令範例；本步驟示意流程）

```bash
TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"run endpoint test","priority":"low","columnId":"todo","targetPath":"/does/not/exist"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['task']['id'])")
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK_ID -H 'Content-Type: application/json' -d '{"columnId":"in_progress"}' > /dev/null
sleep 1
curl -s http://localhost:3001/api/tasks/$TASK_ID/automation-runs | python3 -m json.tool
curl -s http://localhost:3001/api/tasks/$TASK_ID/comments | python3 -m json.tool
curl -s -X DELETE http://localhost:3001/api/tasks/$TASK_ID
```

預期結果：`automation-runs` 端點回傳一筆 `status: failed` 的紀錄，`error` 欄位說明 targetPath 不存在；`comments` 端點回傳空陣列（因為這次失敗不再寫留言）。

- [x] **Step 4：Commit**

```bash
git add server/index.mjs server/automationRunner.mjs
git commit -m "feat: add automation-runs endpoint, stop writing automation results to comments"
```

---

### Task 3：`src/lib/automationRunsApi.ts` + `AutomationRunList.tsx`

**檔案：**
- 新增：`src/lib/automationRunsApi.ts`
- 新增：`src/components/AutomationRunList.tsx`

**介面：**
- 消耗：`AutomationRun`（Task 1）、`GET /api/tasks/:taskId/automation-runs`（Task 2）
- 產出：`export async function fetchAutomationRuns(taskId: string): Promise<AutomationRun[]>`（`AutomationRunList` 元件使用）
- 產出：`export default function AutomationRunList({ taskId }: { taskId: string })`（`TaskDrawer`，Task 4 會使用）

- [x] **Step 1：撰寫 `src/lib/automationRunsApi.ts`**

```ts
import type { AutomationRun } from '../types/task'

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  return res.json()
}

export async function fetchAutomationRuns(taskId: string): Promise<AutomationRun[]> {
  const res = await fetch(`/api/tasks/${taskId}/automation-runs`)
  const data = await handle<{ runs: AutomationRun[] }>(res)
  return data.runs
}
```

- [x] **Step 2：撰寫 `src/components/AutomationRunList.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { AutomationRun } from '../types/task'
import { fetchAutomationRuns } from '../lib/automationRunsApi'

interface AutomationRunListProps {
  taskId: string
}

function formatTimestamp(iso?: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('zh-TW', { hour12: false })
}

const statusConfig = {
  running: { icon: Loader2, label: '執行中', className: 'text-sky-600', spin: true },
  done: { icon: CheckCircle2, label: '已完成', className: 'text-emerald-600', spin: false },
  failed: { icon: XCircle, label: '失敗', className: 'text-red-600', spin: false },
} as const

export default function AutomationRunList({ taskId }: AutomationRunListProps) {
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIsLoading(true)
    fetchAutomationRuns(taskId)
      .then(setRuns)
      .catch((err) => setError(err instanceof Error ? err.message : '載入執行紀錄失敗'))
      .finally(() => setIsLoading(false))
  }, [taskId])

  if (isLoading) {
    return <p className="text-sm text-slate-400">載入執行紀錄中…</p>
  }

  if (error) {
    return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
  }

  if (runs.length === 0) {
    return <p className="text-sm text-slate-400">尚無執行紀錄</p>
  }

  return (
    <ul className="space-y-2">
      {runs.map((run) => {
        const config = statusConfig[run.status]
        const Icon = config.icon
        return (
          <li key={run.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className={`flex items-center gap-1.5 font-medium ${config.className}`}>
                <Icon size={14} className={config.spin ? 'animate-spin' : ''} />
                {config.label}
              </span>
              <span className="text-xs text-slate-400">
                {formatTimestamp(run.startedAt)}
                {run.finishedAt ? ` ～ ${formatTimestamp(run.finishedAt)}` : ''}
              </span>
            </div>
            {run.error && (
              <p className="whitespace-pre-wrap text-red-600">{run.error}</p>
            )}
            {run.output && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-slate-500">查看輸出內容</summary>
                <p className="mt-1 whitespace-pre-wrap text-slate-600">{run.output}</p>
              </details>
            )}
          </li>
        )
      })}
    </ul>
  )
}
```

- [x] **Step 3：型別檢查**

```bash
npx tsc -b
```

預期結果：無錯誤。

- [x] **Step 4：Commit**

```bash
git add src/lib/automationRunsApi.ts src/components/AutomationRunList.tsx
git commit -m "feat: add AutomationRunList component and API client"
```

---

### Task 4：`TaskDrawer` 頁籤化——描述（編輯/預覽）+ 下方（留言/執行紀錄）

**檔案：**
- 修改：`src/components/TaskDrawer.tsx`

**介面：**
- 消耗：`AutomationRunList`（Task 3）、既有 `CommentList`

- [ ] **Step 1：新增兩組頁籤 state**

在 `const [error, setError] = useState<string | null>(null)` 之後加入：

```ts
  const [descriptionTab, setDescriptionTab] = useState<'edit' | 'preview'>('edit')
  const [bottomTab, setBottomTab] = useState<'comments' | 'automation'>('comments')
```

在既有 `useEffect` 的 `setError(null)` 之後（`}, [isOpen, mode, initialTask])` 之前）加入重置頁籤狀態，確保每次開啟 Drawer 都從「編輯」「留言」開始：

```ts
    setDescriptionTab('edit')
    setBottomTab('comments')
```

- [ ] **Step 2：把描述區塊改成頁籤切換**

將現有的：

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
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 overflow-y-auto text-sm">
              {form.description.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.description}</ReactMarkdown>
              ) : (
                <span className="text-slate-400">預覽區（尚無內容）</span>
              )}
            </div>
          </div>
        </div>
```

替換為：

```tsx
        <div className="mb-6">
          <span className="mb-1 block text-sm font-medium text-slate-600">描述（Markdown）</span>
          <div className="mb-2 flex gap-1 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setDescriptionTab('edit')}
              className={`px-3 py-1.5 text-sm font-medium ${
                descriptionTab === 'edit'
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              編輯
            </button>
            <button
              type="button"
              onClick={() => setDescriptionTab('preview')}
              className={`px-3 py-1.5 text-sm font-medium ${
                descriptionTab === 'preview'
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              預覽
            </button>
          </div>
          {descriptionTab === 'edit' ? (
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={8}
              placeholder="支援 Markdown 語法（標題、清單、表格、程式碼區塊等）"
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            />
          ) : (
            <div className="min-h-[12rem] rounded-md border border-slate-200 bg-slate-50 px-3 py-2 overflow-y-auto text-sm">
              {form.description.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.description}</ReactMarkdown>
              ) : (
                <span className="text-slate-400">預覽區（尚無內容）</span>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 3：把下方區塊改成頁籤切換**

將現有的：

```tsx
        {mode === 'edit' && initialTask && <CommentList taskId={initialTask.id} />}
```

替換為：

```tsx
        {mode === 'edit' && initialTask && (
          <div className="mb-6">
            <div className="mb-2 flex gap-1 border-b border-slate-200">
              <button
                type="button"
                onClick={() => setBottomTab('comments')}
                className={`px-3 py-1.5 text-sm font-medium ${
                  bottomTab === 'comments'
                    ? 'border-b-2 border-slate-900 text-slate-900'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                留言
              </button>
              <button
                type="button"
                onClick={() => setBottomTab('automation')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${
                  bottomTab === 'automation'
                    ? 'border-b-2 border-slate-900 text-slate-900'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                執行紀錄
                {initialTask.automationStatus === 'running' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                )}
              </button>
            </div>
            {bottomTab === 'comments' ? (
              <CommentList taskId={initialTask.id} />
            ) : (
              <AutomationRunList taskId={initialTask.id} />
            )}
          </div>
        )}
```

在檔案頂端加入 import：

```ts
import AutomationRunList from './AutomationRunList'
```

- [ ] **Step 4：型別檢查**

```bash
npx tsc -b
```

預期結果：無錯誤。

- [ ] **Step 5：瀏覽器手動驗證**

啟動 `npm run dev`，開啟任一既有任務卡：
1. 確認描述區塊顯示「編輯」「預覽」兩個頁籤，預設在「編輯」，點擊「預覽」能看到 Markdown 渲染結果，再點回「編輯」textarea 內容還在。
2. 確認下方顯示「留言」「執行紀錄」兩個頁籤，預設在「留言」，點擊「執行紀錄」能看到 `AutomationRunList`（若該任務沒有 `targetPath` 或從未觸發過自動執行，應顯示「尚無執行紀錄」）。
3. 建立一張帶 `targetPath` 指向不存在路徑的新任務，拖到「處理中」，重新打開該卡，切到「執行紀錄」頁籤，確認能看到一筆 `failed` 紀錄且「留言」頁籤是空的（未被污染）。驗證後刪除測試任務。

- [ ] **Step 6：Commit**

```bash
git add src/components/TaskDrawer.tsx
git commit -m "feat: split TaskDrawer description into edit/preview tabs, comments/automation tabs"
```

---

### Task 5：README + Spec/Plan 文件同步 + 最終整分支 review

**檔案：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-09-09-task-drawer-tabs-automation-runs.md`（本檔案）

**介面：** 無（純文件任務）。

- [ ] **Step 1：更新 `README.md`**

在「任務詳情」章節，補充說明描述欄位改為頁籤切換；在「Hermes Agent 自動化執行（Phase 4）」章節，補充說明執行結果現在記錄在獨立的「執行紀錄」頁籤（`automation_runs` 表），不再寫入留言。在「API」章節新增 `GET /api/tasks/:taskId/automation-runs` 的說明。

- [ ] **Step 2：最終整分支 review**

- 確認 `src/` 沒有新增 `dangerouslySetInnerHTML`/`innerHTML`/`eval`。
- 執行 `npx tsc -b` 與 `npm run lint`，確認皆乾淨（無新增錯誤；既有的 2 個 pre-existing warning 不算新增）。
- 用 curl 確認刪除任務時，該任務的 `automation_runs` 紀錄也一併被刪除（驗證 `ON DELETE CASCADE` 生效）：
  ```bash
  TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks -H 'Content-Type: application/json' -d '{"title":"cascade test","priority":"low","columnId":"in_progress","targetPath":"/does/not/exist"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['task']['id'])")
  sleep 1
  curl -s http://localhost:3001/api/tasks/$TASK_ID/automation-runs
  curl -s -X DELETE http://localhost:3001/api/tasks/$TASK_ID
  sqlite3 .data/taskboard.sqlite "SELECT COUNT(*) FROM automation_runs WHERE task_id='$TASK_ID'"
  ```
  預期：刪除後 `COUNT(*)` 為 `0`。
- 清理所有手動驗證過程中建立的測試卡片，確保種子資料筆數不變。

- [ ] **Step 3：Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-09-task-drawer-tabs-automation-runs.md
git commit -m "docs: sync README with TaskDrawer tabs and automation runs, mark plan complete"
```

---

## 本計畫範圍外（依 spec 的「範圍外」章節）

- 不涉及 Docker 部署限制的解法。
- 不涉及執行紀錄的分頁/搜尋/篩選。
- 不涉及讓使用者手動重新觸發/取消某次執行。
