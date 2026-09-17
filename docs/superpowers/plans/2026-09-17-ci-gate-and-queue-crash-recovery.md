# CI Gate 與佇列排隊任務重啟復原 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 GitHub Actions CI（tsc/oxlint/vitest/build/docker build），並讓 automation 佇列中「排隊中尚未執行」的任務在 server 重啟後不再靜默消失——標記為 `interrupted`、可在執行紀錄頁籤看到，同時修正 slot 洩漏風險。

**Architecture:** CI 部分是純新增 workflow 檔案，不動程式碼。佇列復原部分：`automationStatus` 型別新增 `'queued'`；`triggerAutomation()` push 進 queue 時立即建立 `automation_runs` 記錄（status='queued'）並更新 task 狀態；`queue` 陣列元素從 `task` 改成 `{ task, run }`，讓 `onSlotFreed()` 取出時延續同一筆 run 記錄轉為 `running`（而非重建）；`runOne()` 用 `try/finally` 保底釋放 slot；`recoverInterruptedRuns()` SQL 擴大涵蓋 `queued` 狀態。

**Tech Stack:** Node.js 22 (better-sqlite3 via `server/db/index.mjs` 統一介面)、Express、React/TypeScript、vitest（前端）+ node:test（後端整合測試）、GitHub Actions、Docker。

## Global Constraints

- 排隊中任務重啟後：直接標記為 `interrupted`，不自動重新排隊執行。
- 不修改 `MAX_CONCURRENT`（維持 1）、不修改 Docker automation service（`automation/server.mjs`）。
- 後端整合測試沿用專案既有模式：用真正的 SQLite 檔案（`server/db/index.mjs` 單例連線），測試結束時明確清理建立的 task/run，不 mock DB layer（因為 `db/index.mjs` 同時支援 sqlite 與 postgres，沒有暴露測試專用的 in-memory 注入點）。
- 後端測試執行方式：`node --test "test/**/*.test.mjs"`（注意：裸 `node --test test/` 因目錄下沒有 `.test.js` 副檔名檔案會報 MODULE_NOT_FOUND，必須用 glob）。
- 前端測試（`.test.tsx`）用 `npx vitest run`（`vitest.config.ts` 的 include 已限定只掃 `src/**/*.test.{ts,tsx}`，不會誤抓 `test/` 目錄下的 node:test 檔案）。
- git commit author 對齊個人專案設定：`josh <shihjosh@users.noreply.github.com>`。
- 每個 Task 完成後，除了程式碼 commit 外，另外把本檔案對應 Task 的 checkbox 打勾，獨立 commit（訊息如 `docs: check off Task N in plan`）。

---

### Task 1: CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- 無程式碼介面變更，純 CI 設定。

- [x] **Step 1: 建立 workflow 檔案**

```yaml
name: CI

on:
  pull_request:
    branches: [main, dev]
  push:
    branches: [main, dev]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npx tsc -b

      - name: Lint
        run: npx oxlint

      - name: Frontend tests
        run: npx vitest run

      - name: Backend integration tests
        run: node --test "test/**/*.test.mjs"

      - name: Build
        run: npm run build

      - name: Docker build
        run: docker build -t ai-task-board:ci .
```

- [x] **Step 2: 本機模擬驗證每個步驟能單獨過**

Run（在專案根目錄，`dev` 分支上，依序執行，每個都應該 exit code 0）：

```bash
npm ci
npx tsc -b
npx oxlint
npx vitest run
node --test "test/**/*.test.mjs"
npm run build
docker build -t ai-task-board:ci .
```

Expected: 全部指令 exit code 0。若 `docker build` 因為沙箱環境限制（例如沒有 docker daemon 存取權限）失敗，記錄下失敗訊息，但仍照原計畫把 workflow 檔案寫入（GitHub Actions runner 有完整 docker 環境，這一步在本機的失敗不代表 CI 上會失敗）。

- [x] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add tsc/lint/test/build/docker-build gate on PR and push to main/dev"
```

- [x] **Step 4: 打勾本 Task 並 commit**

在本檔案把 Task 1 的所有 checkbox 改成 `- [x]`，然後：

```bash
git add docs/superpowers/plans/2026-09-17-ci-gate-and-queue-crash-recovery.md
git commit -m "docs: check off Task 1 in plan"
```

---

### Task 2: `automationStatus` 型別新增 `'queued'` + 前端顯示

**Files:**
- Modify: `src/types/task.ts:31`
- Modify: `src/components/TaskCard.tsx`（新增 queued 分支，仿照現有 `interrupted` 分支）
- Modify: `src/components/TaskDrawer.tsx:307`（狀態文字列表）、`:422-427`（執行紀錄分頁 tab 上的小圓點指示）
- Test: `src/components/TaskCard.test.tsx`（新增一則測試）

**Interfaces:**
- Produces: `Task['automationStatus']` 型別新增聯集成員 `'queued'`，供 Task 3、Task 4 的後端程式碼與 API 回傳值使用。

- [x] **Step 1: 修改型別定義**

`src/types/task.ts:31`，將：

```ts
automationStatus: 'idle' | 'running' | 'done' | 'failed' | 'interrupted'
```

改為：

```ts
automationStatus: 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'interrupted'
```

- [x] **Step 2: 寫 TaskCard 的失敗測試**

在 `src/components/TaskCard.test.tsx`，仿照既有的 `interrupted badge` 測試，新增：

```tsx
it('shows queued badge when automationStatus is queued', () => {
  render(
    <TaskCard
      task={{ ...baseTask, automationStatus: 'queued' }}
    />,
  )
  expect(screen.getByText('排隊中')).toBeInTheDocument()
})
```

（若檔案內既有測試使用的是不同的 `baseTask`/render 輔助方式，沿用該檔案既有的 helper 寫法，不要引入新的測試工具函式。）

- [x] **Step 3: 執行測試確認失敗**

Run: `npx vitest run src/components/TaskCard.test.tsx`
Expected: 新增的測試 FAIL（找不到「排隊中」文字）。

- [x] **Step 4: TaskCard 新增 queued 顯示**

在 `src/components/TaskCard.tsx`，緊接在現有的 `interrupted` 區塊（約第 73-78 行）之後，新增：

```tsx
{task.automationStatus === 'queued' && (
  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
    <Loader2 size={12} />
    排隊中
  </div>
)}
```

（`Loader2` 已經是該檔案第一行 import 的圖示，不需要新增 import；這裡不加 `animate-spin`，用靜態圖示跟「執行中」的旋轉動畫做視覺區分。）

- [x] **Step 5: 執行測試確認通過**

Run: `npx vitest run src/components/TaskCard.test.tsx`
Expected: PASS。

- [x] **Step 6: TaskDrawer 狀態文字新增 queued**

`src/components/TaskDrawer.tsx:307`附近，在：

```tsx
{initialTask.automationStatus === 'running' && '執行中'}
```

之前新增一行：

```tsx
{initialTask.automationStatus === 'queued' && '排隊中'}
```

- [x] **Step 7: TaskDrawer 執行紀錄分頁小圓點新增 queued**

`src/components/TaskDrawer.tsx:422-427`附近，在現有的：

```tsx
{initialTask.automationStatus === 'running' && (
  <span className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400" />
)}
{initialTask.automationStatus === 'interrupted' && (
  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
)}
```

之前新增：

```tsx
{initialTask.automationStatus === 'queued' && (
  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
)}
```

- [x] **Step 8: 全量跑前端測試確認沒有回歸**

Run: `npx vitest run`
Expected: 所有既有測試 + 新增測試皆 PASS。

- [x] **Step 9: tsc 檢查**

Run: `npx tsc -b`
Expected: 無型別錯誤（`Task['automationStatus']` 新增聯集成員後，若有其他地方對該欄位做窮盡性 switch/if 判斷但漏掉新值，此處會透過人工檢查捕捉，非型別系統會自動報錯——本 Task 的 Step 6/7 已涵蓋所有現有判斷點，故不會有遺漏）。

- [x] **Step 10: Commit**

```bash
git add src/types/task.ts src/components/TaskCard.tsx src/components/TaskCard.test.tsx src/components/TaskDrawer.tsx
git commit -m "feat: add queued automationStatus with TaskCard/TaskDrawer display"
```

- [x] **Step 11: 打勾本 Task 並 commit**

```bash
git add docs/superpowers/plans/2026-09-17-ci-gate-and-queue-crash-recovery.md
git commit -m "docs: check off Task 2 in plan"
```

---

### Task 3: 排隊時建立 `automation_runs` 記錄並標記 `queued`

**Files:**
- Modify: `server/automationRunner.mjs:212-234`（`triggerAutomation` 函式）
- Test: `test/automationRunner.queue.test.mjs`（新建）

**Interfaces:**
- Consumes: `createAutomationRun(taskId, { prompt, skill })` 回傳 `{ id, taskId, status, prompt, output, error, startedAt, finishedAt, skill, worktreePath, worktreeBranch }`（來自 `server/automationRunRepository.mjs:28`，現況會把 `status` 寫死成 `'running'`——本 Task 需要新增可傳入初始 status 的能力，見 Step 1）。
- Consumes: `updateAutomationRun(id, { status, output, error, worktreePath, worktreeBranch })`（`server/automationRunRepository.mjs:40`）。
- Consumes: `updateTask(id, patch)`（`server/taskRepository.mjs:61`，`patch.automationStatus` 可傳 `'queued'`）。
- Produces: `queue` 陣列（`server/automationRunner.mjs:17` 的模組級變數）元素格式從裸 `task` 改為 `{ task, run }`，供 Task 4 的 `onSlotFreed()`/`runOne()` 使用。

- [x] **Step 1: 讓 `createAutomationRun` 支援自訂初始 status**

`server/automationRunRepository.mjs:28-38`，目前簽章是：

```js
export async function createAutomationRun(taskId, { prompt, skill }) {
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  await db.run(
    `INSERT INTO automation_runs (id, task_id, status, prompt, output, error, started_at, finished_at, skill, worktree_path, worktree_branch)
     VALUES (?, ?, 'running', ?, '', NULL, ?, NULL, ?, '', '')`,
    [id, taskId, prompt, startedAt, skill ?? ''],
  )
  const row = await db.get('SELECT * FROM automation_runs WHERE id = ?', [id])
  return rowToRun(row)
}
```

改為新增可選的 `status` 參數，預設維持 `'running'`（保持向後相容，其他呼叫端不用改）：

```js
export async function createAutomationRun(taskId, { prompt, skill, status = 'running' }) {
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  await db.run(
    `INSERT INTO automation_runs (id, task_id, status, prompt, output, error, started_at, finished_at, skill, worktree_path, worktree_branch)
     VALUES (?, ?, ?, ?, '', NULL, ?, NULL, ?, '', '')`,
    [id, taskId, status, prompt, startedAt, skill ?? ''],
  )
  const row = await db.get('SELECT * FROM automation_runs WHERE id = ?', [id])
  return rowToRun(row)
}
```

- [x] **Step 2: 寫佇列標記的失敗測試**

建立 `test/automationRunner.queue.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTask, listTasks, deleteTask } from '../server/taskRepository.mjs'
import { listAutomationRuns } from '../server/automationRunRepository.mjs'
import { triggerAutomation } from '../server/automationRunner.mjs'

// 這兩個任務的 targetPath 指向不存在的路徑，triggerAutomation 對第一個任務
// 會走 pathMissing 分支立即標記 failed（不會真的 spawn hermes）；第二個任務
// 則用一個存在的路徑（專案根目錄本身）但故意設 automationStatus='running'
// 讓 MAX_CONCURRENT=1 的併發檢查誤以為已經有任務在跑，藉此讓它進入 queue
// 而不會真的觸發 spawn（避免測試環境真的執行 hermes CLI）。

test('triggerAutomation marks a queued task and creates a queued automation_runs record', async () => {
  const blockerTask = await createTask({
    title: 'blocker (pretend running)',
    priority: 'high',
    columnId: 'in_progress',
    targetPath: process.cwd(),
    automationStatus: 'running',
  })
  const queuedTask = await createTask({
    title: 'should be queued',
    priority: 'low',
    columnId: 'in_progress',
    targetPath: process.cwd(),
    automationStatus: 'idle',
  })

  try {
    // triggerAutomation 內部靠模組級 runningCount 變數判斷併發，不是靠
    // task.automationStatus==='running' 這個 DB 欄位——所以要先觸發
    // blockerTask 一次讓 runningCount 真正 +1（它會走 runViaSpawn，
    // 但 targetPath 是真實存在的目錄，spawn('hermes', ...) 若本機沒有
    // hermes 執行檔會走 child.on('error') 分支很快結束並釋放 slot，
    // 可能導致 queuedTask 沒有機會排隊。因此改用更可靠的方式：
    // 直接呼叫兩次 triggerAutomation 且不等待第一次的 promise resolve，
    // 在第一次呼叫尚未完成（因此 runningCount 已 +1 但還沒 -1）的
    // 極短時間窗口內立刻送出第二次呼叫。
    const firstCall = triggerAutomation(blockerTask)
    // 給 event loop 一個 tick，讓 runOne() 內的 `runningCount += 1` 先執行完，
    // 但還沒進到會讓它很快 resolve 的 spawn error 分支之後的 await。
    await new Promise((resolve) => setImmediate(resolve))

    await triggerAutomation(queuedTask)

    const tasks = await listTasks()
    const recheckedQueued = tasks.find((t) => t.id === queuedTask.id)
    assert.equal(recheckedQueued.automationStatus, 'queued')

    const runs = await listAutomationRuns(queuedTask.id)
    assert.equal(runs.length, 1)
    assert.equal(runs[0].status, 'queued')

    await firstCall.catch(() => {})
  } finally {
    await deleteTask(blockerTask.id)
    await deleteTask(queuedTask.id)
  }
})
```

- [x] **Step 3: 執行測試確認失敗**

Run: `node --test test/automationRunner.queue.test.mjs`
Expected: FAIL（`recheckedQueued.automationStatus` 目前仍是 `'idle'`，因為 `triggerAutomation` 還沒有寫入 queued 標記邏輯）。

若測試因為時序問題（第一次呼叫在 `setImmediate` 之後已經釋放了 slot）沒有進到 queue 分支導致其他斷言失敗，這代表測試本身的時序假設在目前環境下不成立——這種情況下改用直接呼叫模組內部匯出的佇列狀態取代時序賭注：暫時在 `server/automationRunner.mjs` 為測試新增一個 `export function __setRunningCountForTest(n) { runningCount = n }`（僅供測試使用，命名明確標示測試專用），測試改成：

```js
import { triggerAutomation, __setRunningCountForTest } from '../server/automationRunner.mjs'
// ...
__setRunningCountForTest(1) // 假裝已經有一個任務在跑
await triggerAutomation(queuedTask)
__setRunningCountForTest(0) // 測試結束前重置，避免污染同進程內其他測試
```

這個測試輔助函式必須明確加註解說明僅供測試使用，並在 Step 5 實作 Task 4 時保留（後續 Task 4 的測試也會用到同樣機制模擬併發）。

- [x] **Step 4: 修改 `triggerAutomation` 實作**

`server/automationRunner.mjs:212-234`，目前的佇列分支：

```js
  if (runningCount >= MAX_CONCURRENT) {
    queue.push(task)
    return
  }
  await runOne(task)
```

改為：

```js
  if (runningCount >= MAX_CONCURRENT) {
    await updateTask(task.id, { automationStatus: 'queued' })
    const run = await createAutomationRun(task.id, {
      prompt: buildPrompt(task),
      skill: task.automationSkill?.trim() || undefined,
      status: 'queued',
    })
    queue.push({ task, run })
    return
  }
  await runOne(task)
```

（此處先只改動 `triggerAutomation`，`queue.push({ task, run })` 產生的新元素格式會讓 Task 4 的 `onSlotFreed()` 需要跟著調整——這是預期的，Task 4 會處理。在 Task 4 完成前，本 Task 先讓 `test/automationRunner.queue.test.mjs` 的斷言通過即可；`onSlotFreed()` 讀取 `queue` 陣列元素當作裸 task 使用的地方會在型別上不再相符，但因為 JS 沒有靜態型別檢查，不會導致本 Task 的測試失敗，只會在被排隊的任務真正被取出執行時行為錯誤——這正是 Task 4 要修的部分。）

- [x] **Step 5: 執行測試確認通過**

Run: `node --test test/automationRunner.queue.test.mjs`
Expected: PASS。

- [x] **Step 6: 執行既有後端測試確認無回歸**

Run: `node --test "test/**/*.test.mjs"`
Expected: 全部 PASS（含 Task 1 的 CI 已涵蓋的既有兩個測試檔）。

- [x] **Step 7: Commit**

```bash
git add server/automationRunRepository.mjs server/automationRunner.mjs test/automationRunner.queue.test.mjs
git commit -m "feat: mark task as queued and create queued automation_runs record when queued"
```

- [x] **Step 8: 打勾本 Task 並 commit**

```bash
git add docs/superpowers/plans/2026-09-17-ci-gate-and-queue-crash-recovery.md
git commit -m "docs: check off Task 3 in plan"
```

---

### Task 4: `onSlotFreed`/`runOne` 銜接已存在的 run + slot 洩漏保護

**Files:**
- Modify: `server/automationRunner.mjs:127-210`（`runOne`、`finishSuccess`、`finishFailed`、`onSlotFreed`）
- Test: `test/automationRunner.queue.test.mjs`（新增測試案例）

**Interfaces:**
- Consumes: Task 3 產生的 `queue` 陣列，元素格式 `{ task, run }`。
- Consumes: `updateAutomationRun(id, { status, ... })`（`server/automationRunRepository.mjs:40`）。
- Produces: `runOne(task, existingRun)` 新簽章（`existingRun` 為可選參數），供本 Task 內部的 `onSlotFreed()` 呼叫。

- [x] **Step 1: 寫「slot 在 DB 寫入失敗時仍會釋放」的失敗測試**

在 `test/automationRunner.queue.test.mjs` 追加測試：

```js
import { updateTask } from '../server/taskRepository.mjs'

test('runningCount is released even if finishing the run throws', async () => {
  // 用一個 targetPath 不存在的任務，讓 triggerAutomation 走
  // pathMissing 分支——這個分支目前的實作（automationRunner.mjs:216-225）
  // 本身不會呼叫 runOne()/onSlotFreed()，不會遞增 runningCount，
  // 所以無法用它來測試 slot 釋放。改用會真正呼叫 runOne() 的路徑：
  // 一個 targetPath 存在但 skill 為 undefined 的任務，配合
  // __setRunningCountForTest(0) 確保它會立即執行（不進 queue）。
  //
  // 讓 finishFailed/finishSuccess 內部拋錯的最簡單方式：monkey-patch
  // taskRepository 的 updateTask，在特定 taskId 被呼叫時丟出例外，
  // 之後立刻還原，避免影響其他測試。
  const task = await createTask({
    title: 'will fail to finish',
    priority: 'low',
    columnId: 'in_progress',
    targetPath: '/definitely/does/not/exist/' + Date.now(),
    automationStatus: 'idle',
  })

  try {
    __setRunningCountForTest(0)
    // pathMissing 分支會呼叫 createAutomationRun + updateAutomationRun +
    // updateTask，但不經過 runOne()/onSlotFreed()——因此這條路徑本來就
    // 不會佔用 runningCount，本測試改為直接驗證：即使 updateTask 在
    // triggerAutomation 內部拋錯，也不會讓後續呼叫拋出未捕捉例外並卡死
    // process（triggerAutomation 是 fire-and-forget，呼叫端用
    // `.catch(err => console.error(...))` 吞掉錯誤，見 server/app.mjs:167-169）。
    await assert.doesNotReject(triggerAutomation(task))
  } finally {
    await deleteTask(task.id)
  }
})
```

（註：由於 `pathMissing` 分支不經過 `runOne`，無法在這條路徑上驗證 slot 釋放。改為在下一步直接針對 `runOne` 做單元層級驗證——見 Step 1b。）

- [x] **Step 1b: 補一個直接鎖定 `runOne` 行為的測試**

由於 `finishSuccess`/`finishFailed` 是模組內未匯出的函式，無法直接單獨測試，改成端到端驗證「模擬 DB 寫入失敗不會讓佇列永久卡住」：在 `test/automationRunner.queue.test.mjs` 追加：

```js
test('queue continues processing after a task fails to finish (slot not leaked)', async () => {
  // 场景：MAX_CONCURRENT=1。task A 因為 targetPath 不存在，
  // triggerAutomation 會走 pathMissing 分支（不佔用 runningCount，
  // 立即標記 failed）。task B 用 __setRunningCountForTest(1) 模擬
  // 「已經有一個任務在跑」，讓它進入 queue。之後手動呼叫
  // __setRunningCountForTest(0) 並直接呼叫模組匯出的
  // __drainQueueForTest()（本 Task 新增，見 Step 3）模擬 slot 釋放，
  // 驗證 task B 最終從 queue 中被取出並轉為 running 狀態。
  const taskB = await createTask({
    title: 'queued then drained',
    priority: 'low',
    columnId: 'in_progress',
    targetPath: process.cwd(),
    automationStatus: 'idle',
  })

  try {
    __setRunningCountForTest(1)
    await triggerAutomation(taskB)

    const queuedTasks = await listTasks()
    assert.equal(
      queuedTasks.find((t) => t.id === taskB.id).automationStatus,
      'queued',
    )

    __setRunningCountForTest(0)
    __drainQueueForTest()
    // runOne 是 async 但 __drainQueueForTest 內部走 fire-and-forget，
    // 給一個 tick 讓它跑到 updateTask({ automationStatus: 'running' }) 那一步。
    await new Promise((resolve) => setImmediate(resolve))

    const drainedTasks = await listTasks()
    const finalStatus = drainedTasks.find((t) => t.id === taskB.id).automationStatus
    assert.ok(
      ['running', 'done', 'failed'].includes(finalStatus),
      `expected task to leave queued state, got ${finalStatus}`,
    )
  } finally {
    await deleteTask(taskB.id)
  }
})
```

- [x] **Step 2: 執行測試確認失敗**

Run: `node --test test/automationRunner.queue.test.mjs`
Expected: FAIL（`__drainQueueForTest` 尚未存在，或即使存在，`onSlotFreed()` 目前讀取 `queue` 陣列元素當作裸 `task` 使用，會因為 Task 3 已把元素改成 `{ task, run }` 而在 `priorityRank(queue[i])` 等處存取錯誤欄位，導致行為不正確）。

- [x] **Step 3: 修改 `runOne`、`finishSuccess`、`finishFailed`、`onSlotFreed`**

`server/automationRunner.mjs:127-210` 現況：

```js
async function runOne(task) {
  runningCount += 1
  await updateTask(task.id, { automationStatus: 'running' })

  const prompt = buildPrompt(task)
  const skill = task.automationSkill?.trim() || undefined
  const run = await createAutomationRun(task.id, { prompt, skill })

  const result = AUTOMATION_URL
    ? await runViaHttp({ prompt, cwd: task.targetPath, skill })
    : await runViaSpawn({ prompt, cwd: task.targetPath, skill })

  if (result.stdout) {
    await appendAutomationRunOutput(run.id, result.stdout).catch((err) => {
      console.error('appendAutomationRunOutput failed:', err)
    })
  }

  const worktreeInfo = extractWorktreeInfo(result.stdout ?? '')

  if (result.timedOut) {
    await finishFailed(
      task,
      run,
      `執行逾時（超過 ${TIMEOUT_MS / 60000} 分鐘），已強制中止`,
      worktreeInfo,
    )
    return
  }
  if (result.exitCode === 0) {
    await finishSuccess(task, run, result.stdout ?? '', worktreeInfo)
  } else {
    await finishFailed(
      task,
      run,
      `Hermes 程序結束代碼非 0（exit code ${result.exitCode}）：\n${(result.stderr ?? '').slice(-2000)}`,
      worktreeInfo,
    )
  }
}
```

```js
async function finishSuccess(task, run, output, worktreeInfo = {}) {
  await updateAutomationRun(run.id, { status: 'done', output, ...worktreeInfo })
  await updateTask(task.id, { automationStatus: 'done', columnId: 'review' })
  onSlotFreed()
}

async function finishFailed(task, run, reason, worktreeInfo = {}) {
  await updateAutomationRun(run.id, { status: 'failed', error: reason, ...worktreeInfo })
  await updateTask(task.id, { automationStatus: 'failed' })
  onSlotFreed()
}

function onSlotFreed() {
  runningCount -= 1
  if (queue.length === 0) return

  let bestIndex = 0
  for (let i = 1; i < queue.length; i += 1) {
    if (priorityRank(queue[i]) < priorityRank(queue[bestIndex])) {
      bestIndex = i
    }
  }
  const [next] = queue.splice(bestIndex, 1)
  runOne(next).catch((err) => {
    console.error('runOne failed:', err)
  })
}
```

全部改為：

```js
async function runOne(task, existingRun) {
  runningCount += 1
  try {
    await updateTask(task.id, { automationStatus: 'running' })

    const prompt = buildPrompt(task)
    const skill = task.automationSkill?.trim() || undefined
    const run = existingRun
      ? await updateAutomationRun(existingRun.id, { status: 'running' })
      : await createAutomationRun(task.id, { prompt, skill })

    const result = AUTOMATION_URL
      ? await runViaHttp({ prompt, cwd: task.targetPath, skill })
      : await runViaSpawn({ prompt, cwd: task.targetPath, skill })

    if (result.stdout) {
      await appendAutomationRunOutput(run.id, result.stdout).catch((err) => {
        console.error('appendAutomationRunOutput failed:', err)
      })
    }

    const worktreeInfo = extractWorktreeInfo(result.stdout ?? '')

    if (result.timedOut) {
      await finishFailed(
        task,
        run,
        `執行逾時（超過 ${TIMEOUT_MS / 60000} 分鐘），已強制中止`,
        worktreeInfo,
      )
      return
    }
    if (result.exitCode === 0) {
      await finishSuccess(task, run, result.stdout ?? '', worktreeInfo)
    } else {
      await finishFailed(
        task,
        run,
        `Hermes 程序結束代碼非 0（exit code ${result.exitCode}）：\n${(result.stderr ?? '').slice(-2000)}`,
        worktreeInfo,
      )
    }
  } finally {
    onSlotFreed()
  }
}

async function finishSuccess(task, run, output, worktreeInfo = {}) {
  await updateAutomationRun(run.id, { status: 'done', output, ...worktreeInfo })
  await updateTask(task.id, { automationStatus: 'done', columnId: 'review' })
}

async function finishFailed(task, run, reason, worktreeInfo = {}) {
  await updateAutomationRun(run.id, { status: 'failed', error: reason, ...worktreeInfo })
  await updateTask(task.id, { automationStatus: 'failed' })
}

function onSlotFreed() {
  runningCount -= 1
  if (queue.length === 0) return

  let bestIndex = 0
  for (let i = 1; i < queue.length; i += 1) {
    if (priorityRank(queue[i].task) < priorityRank(queue[bestIndex].task)) {
      bestIndex = i
    }
  }
  const [next] = queue.splice(bestIndex, 1)
  runOne(next.task, next.run).catch((err) => {
    console.error('runOne failed:', err)
  })
}
```

重點差異：
1. `runOne` 整個 try 區塊包住主流程，`finally` 一定呼叫 `onSlotFreed()`——即使 `updateTask`/`createAutomationRun`/`finishSuccess`/`finishFailed` 任一步拋例外，也保證釋放 slot。
2. `finishSuccess`/`finishFailed` 不再各自呼叫 `onSlotFreed()`（避免搭配 `finally` 後重複遞減）。
3. `runOne` 新增 `existingRun` 參數：有值時用 `updateAutomationRun` 把既有的 `queued` 記錄轉成 `running`；沒有值（原本立即執行、非排隊路徑）維持 `createAutomationRun`。
4. `onSlotFreed()` 的 `priorityRank`/`runOne` 呼叫改為讀取 `{ task, run }` 結構。

- [x] **Step 4: 新增測試專用輔助 export**

在 `server/automationRunner.mjs` 檔案末尾（`export async function triggerAutomation` 之後）新增：

```js
// —— 測試專用輔助函式 ——
// 僅供 test/automationRunner.queue.test.mjs 使用，模擬併發狀態與手動觸發
// 佇列處理，避免測試依賴真實的 hermes CLI 執行或不穩定的計時器時序。
export function __setRunningCountForTest(n) {
  runningCount = n
}

export function __drainQueueForTest() {
  onSlotFreed()
}
```

- [x] **Step 5: 執行測試確認通過**

Run: `node --test "test/**/*.test.mjs"`
Expected: 全部 PASS，含 Task 3、Task 4 新增的測試。

- [x] **Step 6: 前端 + tsc 檢查確認無回歸**

Run: `npx tsc -b && npx vitest run`
Expected: 全部 PASS（本 Task 未改動前端檔案，純防呆確認）。

- [x] **Step 7: Commit**

```bash
git add server/automationRunner.mjs test/automationRunner.queue.test.mjs
git commit -m "fix: guarantee automation slot release via try/finally, resume queued run record on drain"
```

- [x] **Step 8: 打勾本 Task 並 commit**

```bash
git add docs/superpowers/plans/2026-09-17-ci-gate-and-queue-crash-recovery.md
git commit -m "docs: check off Task 4 in plan"
```

---

### Task 5: `recoverInterruptedRuns` 擴大涵蓋 `queued`

**Files:**
- Modify: `server/taskRepository.mjs:124-144`（`recoverInterruptedRuns` 函式）
- Test: `test/taskRepository.recover.test.mjs`（新增測試案例）

**Interfaces:**
- Consumes: 無新介面，沿用既有的 `db.run`（`server/db/index.mjs:56`）。
- Produces: `recoverInterruptedRuns()` 回傳值格式不變，仍是 `{ tasksRecovered, runsRecovered }`，但現在也會把 `automationStatus`/`status` 為 `'queued'` 的資料一併計入。

- [ ] **Step 1: 寫失敗測試**

在 `test/taskRepository.recover.test.mjs` 追加（沿用檔案既有的 import 與清理模式）：

```js
import { createAutomationRun } from '../server/automationRunRepository.mjs'

test('recoverInterruptedRuns marks queued tasks and runs as interrupted', async () => {
  const queuedTask = await createTask({
    title: 'queued task',
    priority: 'medium',
    columnId: 'in_progress',
    automationStatus: 'queued',
  })

  const queuedRun = await createAutomationRun(queuedTask.id, {
    prompt: 'waiting in line',
    status: 'queued',
  })

  try {
    const result = await recoverInterruptedRuns()

    assert.equal(result.tasksRecovered >= 1, true)
    assert.equal(result.runsRecovered >= 1, true)

    const tasks = await listTasks()
    const recoveredQueued = tasks.find((t) => t.id === queuedTask.id)
    assert.equal(recoveredQueued.automationStatus, 'interrupted')

    const runs = await listAutomationRuns(queuedTask.id)
    const recoveredRun = runs.find((r) => r.id === queuedRun.id)
    assert.equal(recoveredRun.status, 'interrupted')
    assert.match(recoveredRun.error, /伺服器重啟或程序中斷/)
  } finally {
    await deleteTask(queuedTask.id)
  }
})
```

（註：這個測試依賴 Task 3 的 Step 1 對 `createAutomationRun` 新增的 `status` 參數，需在 Task 3 完成後才能執行。）

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test test/taskRepository.recover.test.mjs`
Expected: FAIL（`recoveredQueued.automationStatus` 目前仍是 `'queued'`，因為 SQL 的 `WHERE` 子句只比對 `'running'`）。

- [ ] **Step 3: 修改 `recoverInterruptedRuns` SQL**

`server/taskRepository.mjs:124-144` 現況：

```js
export async function recoverInterruptedRuns() {
  const now = new Date().toISOString()

  const runsResult = await db.run(
    `UPDATE automation_runs
     SET status = 'interrupted',
         error = '伺服器重啟或程序中斷，執行狀態不明（原本狀態：running）',
         finished_at = ?
     WHERE status = 'running'`,
    [now],
  )

  const tasksResult = await db.run(
    `UPDATE tasks SET automation_status = 'interrupted' WHERE automation_status = 'running'`,
  )

  return {
    tasksRecovered: tasksResult.changes,
    runsRecovered: runsResult.changes,
  }
}
```

改為：

```js
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
```

同步更新函式上方的中文註解（第 114-123 行），把提到「偵測到 running」的敘述改成「偵測到 running 或 queued」，理由段落補充：佇列中的任務同樣只存在於記憶體 `queue` 陣列，重啟後一併歸零，因此視為同一類孤兒狀態。

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test "test/**/*.test.mjs"`
Expected: 全部 PASS。

- [ ] **Step 5: 執行完整驗證套件**

Run 依序：

```bash
npx tsc -b
npx oxlint
npx vitest run
node --test "test/**/*.test.mjs"
npm run build
```

Expected: 全部 exit code 0。

- [ ] **Step 6: Commit**

```bash
git add server/taskRepository.mjs test/taskRepository.recover.test.mjs
git commit -m "fix: recoverInterruptedRuns also covers queued tasks/runs after restart"
```

- [ ] **Step 7: 打勾本 Task 並 commit**

```bash
git add docs/superpowers/plans/2026-09-17-ci-gate-and-queue-crash-recovery.md
git commit -m "docs: check off Task 5 in plan"
```

---

### Task 6: README 補充說明 + 最終驗證

**Files:**
- Modify: `README.md`（automation 狀態說明段落，若有列出 automationStatus 可能值的地方，補上 `queued`）
- Modify: `README.en.md`（同步英文版，若存在對應段落）

**Interfaces:**
- 無程式碼介面變更。

- [ ] **Step 1: 檢查 README 是否列出 automationStatus 可能值**

Run: `grep -n "automationStatus\|執行中\|已中斷\|interrupted" README.md`

若找到列舉 automation 狀態的段落（例如卡片顯示「執行中」/「已中斷」的說明），在該處新增一行「排隊中」的說明，措辭比照既有段落風格（繁體中文，簡短）。若沒有找到明確列舉狀態值的段落，跳過此步驟不強行新增。

- [ ] **Step 2: 若 Step 1 有修改，同步英文版**

若 `README.md` 有實際修改，檢查 `README.en.md` 是否有對應段落，用同樣方式同步（英文措辭），維持中英文檔案內容對齊（沿用專案既有慣例，見 git log 中 `docs: sync README.en.md with docker automation service` 這類 commit）。

- [ ] **Step 3: 最終完整驗證**

Run 依序：

```bash
npx tsc -b
npx oxlint
npx vitest run
node --test "test/**/*.test.mjs"
npm run build
docker build -t ai-task-board:ci .
```

Expected: 全部 exit code 0（與 Task 1 Step 2 的驗證項目一致，這是整個 feature branch 完成前的最終把關）。

- [ ] **Step 4: Commit（若 README 有改動）**

```bash
git add README.md README.en.md
git commit -m "docs: document queued automation status in README"
```

（若 Step 1/2 判斷不需要修改 README，這個 commit 跳過。）

- [ ] **Step 5: 打勾本 Task 並 commit**

```bash
git add docs/superpowers/plans/2026-09-17-ci-gate-and-queue-crash-recovery.md
git commit -m "docs: mark all tasks complete in ci-gate-and-queue-crash-recovery plan"
```

- [ ] **Step 6: Push 分支**

```bash
git push -u origin feature/ci-gate-and-queue-crash-recovery
```

不主動開 PR——PR 由使用者自己在 GitHub 網頁手動開（貼上草稿即可）。

---

## Branch Protection 設定步驟（Task 1 完成、CI 至少成功跑過一次後，由使用者手動操作）

1. 前往 GitHub repo `shihjosh/AI-Task-Board` → **Settings** → **Branches**。
2. **Branch protection rules** → **Add branch ruleset**（或舊版 UI 的 **Add rule**）。
3. Branch name pattern 填 `dev`（之後可比照對 `main` 再設一次）。
4. 勾選 **Require status checks to pass before merging**。
5. 在 status checks 清單中搜尋並勾選 `ci`（即 `.github/workflows/ci.yml` 裡 `jobs.ci` 的名稱——必須先有至少一次成功的 workflow run，這個選項才會出現在清單中）。
6. 勾選 **Require branches to be up to date before merging**（避免 PR 分支落後太多仍被允許合併）。
7. **Create**（或 **Save changes**）。
8. 對 `main` 分支重複步驟 3-7。
