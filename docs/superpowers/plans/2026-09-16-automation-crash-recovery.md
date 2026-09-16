# Automation 崩潰後孤兒狀態偵測與恢復 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server 啟動時自動把資料庫裡殘留的 `running` automation 狀態標記為新狀態
`interrupted`，並在前端讓使用者能看到、且能手動選擇「重新執行」或「放棄」。

**Architecture:** 新增一個純函式 `recoverInterruptedRuns(db)`（`server/db.mjs` 匯出的
`getDb()` 取得連線），在 `server/index.mjs` 監聽 port 前呼叫一次。新增
`POST /api/tasks/:id/retry-automation` API 呼叫既有 `triggerAutomation()`。
前端三個既有 component（`TaskCard`、`TaskDrawer`、`AutomationRunList`）都要
新增 `interrupted` 分支渲染邏輯。

**Tech Stack:** Node.js 24（內建 `node --test`，無需新增後端測試框架）、
better-sqlite3、Express 5、React 19 + TypeScript、新增 vitest +
@testing-library/react + @testing-library/jest-dom + jsdom 作為前端測試框架
（此 repo 目前完全沒有測試基礎設施，這是第一次引入）。

## Global Constraints

- 分支：本次改動都在 `feature/automation-crash-recovery`（已從 `main` 切出）
  上進行，不直接 push `main`/`dev`
- Commit author 統一使用 `josh <shihjosh@users.noreply.github.com>`（個人專案）
- 資料庫層是 `server/db.mjs`（`main` 分支目前的實際檔名，不是 dev 分支上
  已合併但尚未進 main 的 `server/db/index.mjs` 多驅動架構——本次改動只
  針對 `main` 現有的單一 SQLite 實作）
- 不做 schema migration：`automation_status`/`status` 是自由 TEXT 欄位
- 不做自動重跑、不做失敗次數上限、不做 WebSocket 通知（Out of Scope，見 spec）
- 每個 task 結束都要 commit
- Plan 全部 checkbox 打勾後，需要額外一個 commit 只更新這個 plan 檔案本身

---

### Task 1: 後端 — 啟動時掃描並恢復孤兒 running 狀態

**Files:**
- Modify: `server/db.mjs`（新增 `recoverInterruptedRuns` 匯出函式）
- Modify: `server/index.mjs:229-232`（監聽 port 前呼叫恢復函式）
- Test: `test/db.recover.test.mjs`（新增）

**Interfaces:**
- Produces: `export function recoverInterruptedRuns(db)`——接受一個
  better-sqlite3 Database 實例，回傳
  `{ tasksRecovered: number, runsRecovered: number }`

- [x] **Step 1: 寫失敗的測試**

建立 `test/db.recover.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { recoverInterruptedRuns } from '../server/db.mjs'

function makeTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE tasks (
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
      updated_at TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      target_path TEXT NOT NULL DEFAULT '',
      automation_status TEXT NOT NULL DEFAULT 'idle',
      due_date TEXT,
      automation_skill TEXT NOT NULL DEFAULT ''
    )
  `)
  db.exec(`
    CREATE TABLE automation_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      output TEXT NOT NULL DEFAULT '',
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      worktree_path TEXT NOT NULL DEFAULT '',
      worktree_branch TEXT NOT NULL DEFAULT '',
      skill TEXT NOT NULL DEFAULT ''
    )
  `)
  return db
}

test('recoverInterruptedRuns marks running tasks and runs as interrupted', () => {
  const db = makeTestDb()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO tasks (id, title, priority, column_id, created_at, updated_at, automation_status)
     VALUES ('t1', 'stuck task', 'high', 'in_progress', ?, ?, 'running')`,
  ).run(now, now)
  db.prepare(
    `INSERT INTO tasks (id, title, priority, column_id, created_at, updated_at, automation_status)
     VALUES ('t2', 'idle task', 'low', 'todo', ?, ?, 'idle')`,
  ).run(now, now)
  db.prepare(
    `INSERT INTO automation_runs (id, task_id, status, prompt, started_at)
     VALUES ('r1', 't1', 'running', 'do the thing', ?)`,
  ).run(now)
  db.prepare(
    `INSERT INTO automation_runs (id, task_id, status, prompt, started_at, finished_at)
     VALUES ('r2', 't1', 'done', 'earlier run', ?, ?)`,
  ).run(now, now)

  const result = recoverInterruptedRuns(db)

  assert.equal(result.tasksRecovered, 1)
  assert.equal(result.runsRecovered, 1)

  const t1 = db.prepare('SELECT * FROM tasks WHERE id = ?').get('t1')
  assert.equal(t1.automation_status, 'interrupted')
  const t2 = db.prepare('SELECT * FROM tasks WHERE id = ?').get('t2')
  assert.equal(t2.automation_status, 'idle') // 未受影響

  const r1 = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get('r1')
  assert.equal(r1.status, 'interrupted')
  assert.match(r1.error, /伺服器重啟或程序中斷/)
  assert.ok(r1.finished_at)

  const r2 = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get('r2')
  assert.equal(r2.status, 'done') // 未受影響
})

test('recoverInterruptedRuns is a no-op when nothing is running', () => {
  const db = makeTestDb()
  const result = recoverInterruptedRuns(db)
  assert.equal(result.tasksRecovered, 0)
  assert.equal(result.runsRecovered, 0)
})
```

- [x] **Step 2: 執行測試確認失敗**

Run: `node --test test/db.recover.test.mjs`
Expected: FAIL，錯誤訊息類似
`recoverInterruptedRuns is not a function`（因為還沒實作，也還沒 export）

- [x] **Step 3: 在 `server/db.mjs` 實作 `recoverInterruptedRuns`**

在 `server/db.mjs` 檔案最後（`export function getDb()` 之後）新增：

```js
export function recoverInterruptedRuns(db) {
  const now = new Date().toISOString()

  const runsResult = db
    .prepare(
      `UPDATE automation_runs
       SET status = 'interrupted',
           error = '伺服器重啟或程序中斷，執行狀態不明（原本狀態：running）',
           finished_at = ?
       WHERE status = 'running'`,
    )
    .run(now)

  const tasksResult = db
    .prepare(`UPDATE tasks SET automation_status = 'interrupted' WHERE automation_status = 'running'`)
    .run()

  return {
    tasksRecovered: tasksResult.changes,
    runsRecovered: runsResult.changes,
  }
}
```

- [x] **Step 4: 執行測試確認通過**

Run: `node --test test/db.recover.test.mjs`
Expected: PASS，兩個測試都綠燈

- [x] **Step 5: 在 `server/index.mjs` 啟動流程中呼叫恢復函式**

修改 `server/index.mjs` 的 import 區塊，加入：

```js
import { getDb, recoverInterruptedRuns } from './db.mjs'
```

在檔案最底部、`app.listen(port, ...)` 呼叫之前，新增：

```js
const recovery = recoverInterruptedRuns(getDb())
if (recovery.tasksRecovered > 0 || recovery.runsRecovered > 0) {
  console.log(
    `[startup] 偵測到 ${recovery.tasksRecovered} 筆任務、${recovery.runsRecovered} 筆執行紀錄` +
      `處於中斷的 running 狀態，已標記為 interrupted`,
  )
}
```

- [x] **Step 6: 手動驗證整合行為**

Run:
```bash
node -e "
const { getDb, recoverInterruptedRuns } = require('./server/db.mjs')
"
```
（注意：`server/db.mjs` 是 ESM，上面這行僅供示意，實際驗證改用下方方式）

改用實際跑一次 server 驗證 log 有無報錯：
```bash
timeout 3 node server/index.mjs || true
```
Expected: 印出 `API server listening on port 3001`，且若 `.data/taskboard.sqlite`
裡本來就沒有 running 資料，不印出 `[startup]` 那行（因為 `tasksRecovered` 和
`runsRecovered` 都是 0）

- [x] **Step 7: Commit**

```bash
git add server/db.mjs server/index.mjs test/db.recover.test.mjs
git commit -m "feat: recover orphaned running automation status on server startup"
```

---

### Task 2: 型別擴充 — 前後端都認得 `interrupted`

**Files:**
- Modify: `src/types/task.ts`

**Interfaces:**
- Produces: `Task.automationStatus` 與 `AutomationRun.status` 的 union type
  都新增 `'interrupted'`，供 Task 3、4 使用

- [x] **Step 1: 修改 `src/types/task.ts`**

```ts
// 第 31 行，原本：
automationStatus: 'idle' | 'running' | 'done' | 'failed'
// 改成：
automationStatus: 'idle' | 'running' | 'done' | 'failed' | 'interrupted'
```

```ts
// 第 48 行，原本：
status: 'running' | 'done' | 'failed'
// 改成：
status: 'running' | 'done' | 'failed' | 'interrupted'
```

- [x] **Step 2: 執行 typecheck，確認錯誤範圍符合預期**

Run: `npx tsc -b`
Expected: **會報一個、且僅一個 TS7053 錯誤**，來源是
`src/components/AutomationRunList.tsx` 的 `statusConfig[run.status]`
（第 62 行附近）。原因：`TaskCard.tsx`、`TaskDrawer.tsx` 都是用 `===`
個別比對 status，容許新增列舉值不報錯；但 `AutomationRunList.tsx` 是用
`statusConfig` 物件做 index lookup（`const config = statusConfig[run.status]`），
目前只定義了 `running`/`done`/`failed` 三個 key，型別新增 `interrupted`
後，TypeScript 會正確地標出這個既有查表缺漏——這正是 spec 裡指出的
「若不修正會導致執行期白屏崩潰」的同一個 bug，將在 Task 5 修正
`statusConfig`（新增 `interrupted` key）後解決。

**確認方式**：錯誤訊息只涉及 `AutomationRunList.tsx` 這一個檔案、
一個 TS7053 錯誤即符合預期，可以放心繼續下一步；若出現其他檔案或其他
錯誤類型，才需要停下來回報。

- [x] **Step 3: Commit（即使 tsc -b 顯示上述已知的、將由 Task 5 修正的錯誤）**

```bash
git add src/types/task.ts
git commit -m "feat: add interrupted to automationStatus and AutomationRun status types"
```

---

### Task 3: 後端 — 新增 `POST /api/tasks/:id/retry-automation` API

**Files:**
- Modify: `server/index.mjs`
- Test: `test/index.retryAutomation.test.mjs`（新增）

**Interfaces:**
- Consumes: `triggerAutomation(task)`（`server/automationRunner.mjs` 既有匯出，
  簽名不變）、`listTasks()`（`server/taskRepository.mjs` 既有匯出）
- Produces: `POST /api/tasks/:id/retry-automation` — 成功回應
  `202 { task }`；task 不存在回應 `404 { error: 'not_found' }`

- [x] **Step 1: 寫失敗的 API 測試**

這個 API 會呼叫 `triggerAutomation` 進而 `spawn('hermes', ...)`，測試環境
不應該真的啟動 hermes。測試策略：測試「task 不存在回 404」與「task 存在時
回 202 且回應包含 task 本體」，不驗證 automation 是否真的觸發成功（那是
`automationRunner.mjs` 既有邏輯的責任，不在本次新增範圍）。

建立 `test/index.retryAutomation.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

// 使用真正的 server（含真正的 SQLite 檔案），透過隨機 port 啟動，
// 測試完清除建立的任務，避免污染本機 .data/taskboard.sqlite。
process.env.PORT = '0'
const { default: app } = await import('../server/app.mjs')

function request(server, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path, method },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

test('POST /api/tasks/:id/retry-automation returns 404 for missing task', async () => {
  const server = app.listen(0)
  try {
    const res = await request(server, 'POST', '/api/tasks/does-not-exist/retry-automation')
    assert.equal(res.status, 404)
    assert.equal(res.body.error, 'not_found')
  } finally {
    server.close()
  }
})
```

- [x] **Step 2: 執行測試確認失敗**

Run: `node --test test/index.retryAutomation.test.mjs`
Expected: FAIL——此時 `server/app.mjs` 還不存在（目前 `server/index.mjs`
直接在檔案底部呼叫 `app.listen()`，沒有把 `app` 匯出成獨立模組可供測試
import）

- [x] **Step 3: 把 `server/index.mjs` 拆成 `server/app.mjs`（可測試）+ `server/index.mjs`（啟動進入點）**

建立 `server/app.mjs`：把現有 `server/index.mjs` 從第 1 行到
`app.use((err, req, res, next) => {...})` 錯誤處理 middleware 為止的內容
整段搬過去，並在檔案最後加上 `export default app`（不含 `recoverInterruptedRuns`
呼叫、不含 `app.listen(...)`——這兩塊留在新的精簡版 `server/index.mjs`）。

新增 `POST /api/tasks/:id/retry-automation` route（加在既有
`app.patch('/api/tasks/:id', ...)` 之後）：

```js
app.post('/api/tasks/:id/retry-automation', (req, res) => {
  const task = listTasks().find((t) => t.id === req.params.id)
  if (!task) return res.status(404).json({ error: 'not_found' })
  triggerAutomation(task)
  res.status(202).json({ task })
})
```

新的 `server/index.mjs` 全部內容：

```js
import app from './app.mjs'
import { getDb, recoverInterruptedRuns } from './db.mjs'

const recovery = recoverInterruptedRuns(getDb())
if (recovery.tasksRecovered > 0 || recovery.runsRecovered > 0) {
  console.log(
    `[startup] 偵測到 ${recovery.tasksRecovered} 筆任務、${recovery.runsRecovered} 筆執行紀錄` +
      `處於中斷的 running 狀態，已標記為 interrupted`,
  )
}

const port = process.env.PORT ?? 3001
app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
})
```

（這一步同時完成 Task 1 Step 5 原本規劃放在 `index.mjs` 的恢復呼叫——
拆檔後改放在新的精簡 `index.mjs`，`app.mjs` 保持純粹只定義 routes）

- [x] **Step 4: 執行測試確認通過**

Run: `node --test test/index.retryAutomation.test.mjs`
Expected: PASS

- [x] **Step 5: 手動驗證既有功能沒有回歸**

Run: `npm run dev:server`（背景執行或另開一個 terminal），然後：
```bash
curl -s http://localhost:3001/api/tasks | head -c 200
```
Expected: 回傳 JSON 格式的 tasks 列表（跟拆檔前行為一致），確認
`server/index.mjs` → `server/app.mjs` 的拆分沒有破壞既有 API

- [x] **Step 6: Commit**

```bash
git add server/app.mjs server/index.mjs test/index.retryAutomation.test.mjs
git commit -m "feat: split app.mjs from index.mjs, add POST /api/tasks/:id/retry-automation"
```

---

### Task 4: 前端 — 引入 vitest 測試基礎設施

**Files:**
- Modify: `package.json`（新增 devDependencies + test script）
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

**Interfaces:**
- Produces: `npm test` 指令可執行 vitest；後續 Task 5 的
  `AutomationRunList.test.tsx` 依賴這裡建立的設定

- [x] **Step 1: 安裝套件**

```bash
npm install --save-dev vitest@^5.0.1 @testing-library/react@^16.3.3 @testing-library/jest-dom@^7.0.1 jsdom@^30.0.1
```

- [x] **Step 2: 建立 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // 只掃 src/ 底下的測試檔。專案 test/ 目錄放的是後端 node:test 測試
    // （Task 1、Task 3 建立的 test/*.test.mjs），用 `node --test test/`
    // 獨立執行，不歸 vitest 管——vitest 預設 include glob 會抓到
    // test/*.mjs，兩種測試框架的語法互不相容，必須用 include 明確排除。
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

- [x] **Step 3: 建立 `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [x] **Step 4: 在 `package.json` 新增 test script**

```json
"scripts": {
  "test": "vitest run"
}
```
（加在現有 `"db:seed": "node server/seed.mjs"` 那行之後）

- [x] **Step 5: 寫一個煙霧測試確認設定正確**

建立 `src/test/smoke.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

describe('vitest setup smoke test', () => {
  it('renders and finds text', () => {
    render(<div>hello vitest</div>)
    expect(screen.getByText('hello vitest')).toBeInTheDocument()
  })
})
```

- [x] **Step 6: 執行確認通過**

Run: `npm test`
Expected: PASS，1 個測試通過

- [x] **Step 7: 刪除煙霧測試檔案（僅用於驗證設定，不留在 repo）**

```bash
rm src/test/smoke.test.tsx
```

- [x] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test/setup.ts
git commit -m "chore: add vitest + testing-library frontend test infrastructure"
```

---

### Task 5: 前端 — `AutomationRunList.tsx` 支援 `interrupted`（修正潛在白屏 bug）

**Files:**
- Modify: `src/components/AutomationRunList.tsx`
- Test: `src/components/AutomationRunList.test.tsx`（新增）

**Interfaces:**
- Consumes: `AutomationRun.status`（Task 2 已擴充為含 `'interrupted'`）
- Produces: 無新增匯出，`statusConfig` 內部物件新增一個 key

- [x] **Step 1: 寫失敗的測試（重現目前會白屏崩潰的既有 bug）**

建立 `src/components/AutomationRunList.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AutomationRunList from './AutomationRunList'
import * as automationRunsApi from '../lib/automationRunsApi'
import type { AutomationRun } from '../types/task'

vi.mock('../lib/automationRunsApi')

const interruptedRun: AutomationRun = {
  id: 'run-1',
  taskId: 'task-1',
  status: 'interrupted',
  prompt: 'do something',
  output: '',
  error: '伺服器重啟或程序中斷，執行狀態不明（原本狀態：running）',
  startedAt: '2026-09-16T00:00:00.000Z',
  finishedAt: '2026-09-16T00:01:00.000Z',
}

describe('AutomationRunList', () => {
  beforeEach(() => {
    vi.mocked(automationRunsApi.fetchAutomationRuns).mockResolvedValue([interruptedRun])
  })

  it('renders interrupted status without throwing', async () => {
    render(<AutomationRunList taskId="task-1" />)
    expect(await screen.findByText('已中斷')).toBeInTheDocument()
  })
})
```

- [x] **Step 2: 執行測試確認失敗**

Run: `npm test -- AutomationRunList`
Expected: FAIL——`statusConfig` 目前沒有 `interrupted` key，
`config.icon`/`config.label` 存取 `undefined` 會拋出 TypeError，
測試會顯示 component render 拋出例外（這正是 spec 中指出的既有 bug）

- [x] **Step 3: 修正 `src/components/AutomationRunList.tsx`**

修改 import（第 2 行）：
```ts
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
```

修改 `statusConfig`（第 15-19 行）：
```ts
const statusConfig = {
  running: { icon: Loader2, label: '執行中', className: 'text-sky-600 dark:text-sky-400', spin: true },
  done: { icon: CheckCircle2, label: '已完成', className: 'text-emerald-600 dark:text-emerald-400', spin: false },
  failed: { icon: XCircle, label: '失敗', className: 'text-red-600 dark:text-red-400', spin: false },
  interrupted: { icon: AlertTriangle, label: '已中斷', className: 'text-amber-600 dark:text-amber-400', spin: false },
} as const
```

- [x] **Step 4: 執行測試確認通過**

Run: `npm test -- AutomationRunList`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/components/AutomationRunList.tsx src/components/AutomationRunList.test.tsx
git commit -m "fix: AutomationRunList renders interrupted status instead of crashing"
```

---

### Task 6: 前端 — `TaskCard.tsx` 顯示「執行中斷」標籤

**Files:**
- Modify: `src/components/TaskCard.tsx`

**Interfaces:**
- Consumes: `Task.automationStatus`（Task 2 已擴充）

- [x] **Step 1: 修改 import（第 1 行）**

```ts
import { MessageSquare, AlertTriangle, GitPullRequest, Code2, CircleDot, Loader2 } from 'lucide-react'
```

`AlertTriangle` 已經有 import（原本用在 `tagIcon.bug`），不需要新增 import，
確認這點後跳過此步驟的實際修改。

- [x] **Step 2: 在既有 running 區塊後新增 interrupted 分支**

修改 `src/components/TaskCard.tsx` 第 66-71 行區塊，在其後新增：

```tsx
{task.automationStatus === 'running' && (
  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-sky-600">
    <Loader2 size={12} className="animate-spin" />
    Hermes 執行中
  </div>
)}

{task.automationStatus === 'interrupted' && (
  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
    <AlertTriangle size={12} />
    執行中斷
  </div>
)}
```

- [x] **Step 3: 寫渲染測試**

建立 `src/components/TaskCard.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import TaskCard from './TaskCard'
import type { Task } from '../types/task'

const baseTask: Task = {
  id: 'task-1',
  title: '測試任務',
  priority: 'medium',
  tags: [],
  assignees: [],
  commentCount: 0,
  columnId: 'in_progress',
  targetPath: '/tmp/repo',
  automationStatus: 'interrupted',
  createdAt: '2026-09-16T00:00:00.000Z',
}

describe('TaskCard', () => {
  it('shows interrupted badge when automationStatus is interrupted', () => {
    render(<TaskCard task={baseTask} />)
    expect(screen.getByText('執行中斷')).toBeInTheDocument()
  })

  it('does not show interrupted badge for idle tasks', () => {
    render(<TaskCard task={{ ...baseTask, automationStatus: 'idle' }} />)
    expect(screen.queryByText('執行中斷')).not.toBeInTheDocument()
  })
})
```

- [x] **Step 4: 執行測試確認通過**

Run: `npm test -- TaskCard`
Expected: PASS，兩個測試都綠燈

- [x] **Step 5: Commit**

```bash
git add src/components/TaskCard.tsx src/components/TaskCard.test.tsx
git commit -m "feat: TaskCard shows interrupted badge for interrupted automation status"
```

---

### Task 7: 前端 — `src/lib/api.ts` 新增 `retryAutomationApi`

**Files:**
- Modify: `src/lib/api.ts`

**Interfaces:**
- Produces: `export async function retryAutomationApi(id: string): Promise<Task>`
  ——供 Task 8 的 `TaskDrawer.tsx` 呼叫

- [x] **Step 1: 在 `src/lib/api.ts` 新增函式**

在既有 `deleteTaskApi` 之後新增：

```ts
export async function retryAutomationApi(id: string): Promise<Task> {
  const res = await fetch(`${BASE}/${id}/retry-automation`, { method: 'POST' })
  const data = await handle<{ task: Task }>(res)
  return data.task
}
```

- [x] **Step 2: 執行 typecheck**

Run: `npx tsc -b`
Expected: 成功（無錯誤輸出）

- [x] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add retryAutomationApi client function"
```

---

### Task 8: 前端 — `TaskDrawer.tsx` 顯示中斷狀態文字 + 重新執行/放棄按鈕

**Files:**
- Modify: `src/components/TaskDrawer.tsx`

**Interfaces:**
- Consumes: `retryAutomationApi`（Task 7 產出）、`updateTaskApi`（既有）

- [x] **Step 1: 修改 import（第 7 行）**

```ts
import { createTaskApi, updateTaskApi, deleteTaskApi, retryAutomationApi } from '../lib/api'
```

- [x] **Step 2: 狀態文字新增 interrupted 分支（第 276-283 行）**

```tsx
{mode === 'edit' && initialTask?.automationStatus && initialTask.automationStatus !== 'idle' && (
  <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
    目前自動執行狀態：
    {initialTask.automationStatus === 'running' && '執行中'}
    {initialTask.automationStatus === 'done' && '已完成'}
    {initialTask.automationStatus === 'failed' && '失敗'}
    {initialTask.automationStatus === 'interrupted' && '執行中斷'}
  </span>
)}
```

- [x] **Step 3: 執行紀錄分頁小圓點涵蓋 interrupted（第 373-375 行）**

```tsx
{(initialTask.automationStatus === 'running' || initialTask.automationStatus === 'interrupted') && (
  <span className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400" />
)}
```

- [x] **Step 4: 新增「重新執行」「放棄」按鈕與對應 handler**

在 `handleDelete` 函式（第 133-147 行）之後新增兩個 handler：

```tsx
async function handleRetryAutomation() {
  if (!initialTask) return
  setIsSubmitting(true)
  setError(null)
  try {
    await retryAutomationApi(initialTask.id)
    onSaved()
  } catch (err) {
    setError(err instanceof Error ? err.message : '重新執行失敗')
  } finally {
    setIsSubmitting(false)
  }
}

async function handleAbandonAutomation() {
  if (!initialTask) return
  setIsSubmitting(true)
  setError(null)
  try {
    await updateTaskApi(initialTask.id, { automationStatus: 'failed' })
    onSaved()
  } catch (err) {
    setError(err instanceof Error ? err.message : '操作失敗')
  } finally {
    setIsSubmitting(false)
  }
}
```

在自動執行目錄欄位的 `<label>` 區塊內（第 284 行 `</label>` 之前），
緊接在狀態文字 `<span>` 之後新增：

```tsx
{mode === 'edit' && initialTask?.automationStatus === 'interrupted' && (
  <div className="mt-2 flex gap-2">
    <button
      type="button"
      onClick={handleRetryAutomation}
      disabled={isSubmitting}
      className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
    >
      重新執行
    </button>
    <button
      type="button"
      onClick={handleAbandonAutomation}
      disabled={isSubmitting}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      放棄
    </button>
  </div>
)}
```

- [x] **Step 5: 執行 typecheck**

Run: `npx tsc -b`
Expected: 成功（無錯誤輸出）

- [x] **Step 6: 手動驗證（vitest 對這個大型 form component 只做輕量煙霧測試）**

建立 `src/components/TaskDrawer.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TaskDrawer from './TaskDrawer'
import * as skillsApi from '../lib/skillsApi'
import type { Task } from '../types/task'

vi.mock('../lib/skillsApi')
vi.mock('./CommentList', () => ({ default: () => null }))
vi.mock('./AutomationRunList', () => ({ default: () => null }))

const interruptedTask: Task = {
  id: 'task-1',
  title: '測試任務',
  priority: 'medium',
  tags: [],
  assignees: [],
  commentCount: 0,
  columnId: 'in_progress',
  targetPath: '/tmp/repo',
  automationStatus: 'interrupted',
  createdAt: '2026-09-16T00:00:00.000Z',
}

describe('TaskDrawer interrupted state', () => {
  beforeEach(() => {
    vi.mocked(skillsApi.fetchAvailableSkills).mockResolvedValue([])
  })

  it('shows retry and abandon buttons when automation is interrupted', async () => {
    render(
      <TaskDrawer
        isOpen={true}
        mode="edit"
        initialTask={interruptedTask}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(await screen.findByText('執行中斷')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新執行' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放棄' })).toBeInTheDocument()
  })

  it('does not show retry/abandon buttons for idle tasks', async () => {
    render(
      <TaskDrawer
        isOpen={true}
        mode="edit"
        initialTask={{ ...interruptedTask, automationStatus: 'idle' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '重新執行' })).not.toBeInTheDocument()
  })
})
```

Run: `npm test -- TaskDrawer`
Expected: PASS，兩個測試都綠燈

- [x] **Step 7: Commit**

```bash
git add src/components/TaskDrawer.tsx src/components/TaskDrawer.test.tsx
git commit -m "feat: TaskDrawer shows interrupted status with retry/abandon actions"
```

---

### Task 9: 全專案驗證 + Plan checkbox 打勾 commit

**Files:**
- Modify: 本 plan 檔案本身（`docs/superpowers/plans/2026-09-16-automation-crash-recovery.md`）

- [x] **Step 1: 執行完整後端測試**

Run: `node --test test/`
Expected: 全部 PASS（Task 1、Task 3 新增的測試檔都涵蓋在內）

- [x] **Step 2: 執行完整前端測試**

Run: `npm test`
Expected: 全部 PASS（Task 5、Task 6、Task 8 新增的測試檔都涵蓋在內）

- [x] **Step 3: 執行 typecheck**

Run: `npx tsc -b`
Expected: 成功（無錯誤輸出）

- [x] **Step 4: 執行 lint**

Run: `npx oxlint`
Expected: 無新增錯誤（若既有程式碼本來就有 warning，確認本次新增的檔案
沒有引入新的 error/warning）

- [x] **Step 5: 手動端到端驗證恢復流程**

```bash
# 1. 啟動 server（背景）
node server/index.mjs &
SERVER_PID=$!
sleep 1

# 2. 建一筆假裝正在跑的 automation 任務
curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"手動驗證用任務","priority":"low","columnId":"in_progress"}' | tee /tmp/task.json

TASK_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/task.json')).task.id)")

# 3. 直接把它 PATCH 成 running（模擬「automation 正在跑」的狀態，
#    不透過 targetPath 觸發真正的 hermes spawn）
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"automationStatus":"running"}'

# 4. 關掉 server（模擬崩潰/重啟）
kill $SERVER_PID

# 5. 重新啟動，觀察是否印出 [startup] 恢復訊息
node server/index.mjs &
SERVER_PID=$!
sleep 1

# 6. 確認該任務的狀態變成 interrupted
curl -s http://localhost:3001/api/tasks/$TASK_ID 2>&1 || curl -s http://localhost:3001/api/tasks | grep -A2 "$TASK_ID"

# 7. 清理
kill $SERVER_PID
```

Expected: 第 5 步的啟動 log 印出
`[startup] 偵測到 1 筆任務、0 筆執行紀錄處於中斷的 running 狀態，已標記為 interrupted`
（因為驗證流程沒有建立 automation_runs 紀錄，只手動 PATCH 了 task 本身，
`runsRecovered` 預期為 0，`tasksRecovered` 預期為 1）；第 6 步確認
`automationStatus` 欄位值為 `"interrupted"`

- [x] **Step 6: 手動驗證 retry-automation API**

延續上一步（若已清理，重跑第 1-3 步重建一個 interrupted 任務，把
`automationStatus` PATCH 為 `interrupted` 而非 `running`），然後：

```bash
curl -s -X POST http://localhost:3001/api/tasks/$TASK_ID/retry-automation
```

Expected: 回應 202，因為這筆測試任務沒有設定真實存在的 `targetPath`，
`triggerAutomation` 內部的 `fs.existsSync` 檢查會失敗，該任務的
`automationStatus` 最終會變成 `failed`（這是既有 `triggerAutomation` 邏輯、
非本次改動範圍），確認這個既有錯誤處理路徑沒有被破壞即可

- [x] **Step 7: 清理手動驗證留下的測試資料**

```bash
curl -s -X DELETE http://localhost:3001/api/tasks/$TASK_ID
rm -f /tmp/task.json
```

- [x] **Step 8: Plan checkbox 全部打勾後單獨 commit**

把本 plan 檔案裡所有 `- [ ]` 改成 `- [x]`，然後：

```bash
git add docs/superpowers/plans/2026-09-16-automation-crash-recovery.md
git commit -m "docs: mark all tasks complete in automation-crash-recovery plan"
```

- [x] **Step 9: Push 分支（不開 PR，由使用者自行在 GitHub 網頁手動開）**

```bash
git push -u origin feature/automation-crash-recovery
```
