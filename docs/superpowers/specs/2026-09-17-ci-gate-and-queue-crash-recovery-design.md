# AI Task Board — CI Gate 與佇列排隊任務重啟復原 設計文件

> 討論日期：2026-09-17
> 狀態：**Spec only — 本文件僅記錄設計決策，尚未動工實作**

## 背景

專案目前在穩定性上有兩類已知缺口：

1. **CI 完全沒有品質檢查**：`.github/workflows/` 只有一個自動填 PR 說明的
   workflow，沒有任何 CI 檢查 `tsc -b`、`oxlint`、`vitest run`、`vite build`
   或 Dockerfile 是否能建置。壞掉的 PR 可以直接合併進 `dev`/`main`。
2. **automation 佇列排隊中的任務沒有崩潰恢復**：`server/automationRunner.mjs`
   的 `runningCount`/`queue` 只存在 Node process 記憶體。目前已有
   `recoverInterruptedRuns()` 處理 `automationStatus === 'running'` 的孤兒任務
   （server 啟動時標記為 `interrupted`），但**排隊中尚未真正開始執行**的任務
   完全沒有涵蓋：`triggerAutomation()` 把任務 push 進 `queue` 時不會改動
   `task.automationStatus`，也不會建立 `automation_runs` 記錄，一旦 server
   重啟，這些排隊中的任務會直接「靜默消失」——卡片停留在原欄位、使用者完全
   不會知道它其實從未真正執行過。

另外，`finishSuccess`/`finishFailed` 若在寫 DB 時拋出例外，`onSlotFreed()`
不會被呼叫，`runningCount` 永遠不會遞減；由於 `MAX_CONCURRENT = 1`，這會讓
整個佇列永久卡死。這次一併修正。

## 範圍確認（已與使用者對齊）

- CI 要跑：`tsc -b` + `oxlint` + `vitest run` + `npm run build` + `docker build`
  （驗證 Dockerfile 能建置，不 push image）。
- CI 觸發：`pull_request` 與 `push` 到 `main`/`dev` 都要跑。
- Branch protection（要求 CI 通過才能 merge）由使用者自行在 GitHub 網頁設定，
  完成後附上操作步驟。
- 排隊中任務重啟後：**直接標記為 `interrupted`**（跟現有 `running` 任務行為
  一致），不做自動重新排隊。
- 排隊中任務要建立 `automation_runs` 記錄（status 直接寫 `'queued'`），方便
  在執行紀錄頁籤看到「這筆任務曾被排隊過」。
- 新增 `task.automationStatus = 'queued'` 狀態，任務進 queue 時立即標記，
  讓使用者在看板上就能看出卡片正在排隊。
- 順便修正 DB 寫入失敗導致 slot 洩漏的問題（`try/finally` 保底釋放）。

## 設計

### 1. CI Workflow

新增 `.github/workflows/ci.yml`：

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
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsc -b
      - run: npx oxlint
      - run: npx vitest run
      - run: npm run build
      - run: docker build -t ai-task-board:ci .
```

不需要 secrets、不需要 push image，純本地建置驗證。

### 2. `automationStatus` 新增 `'queued'`

`src/types/task.ts` 的 `AutomationStatus` 聯合型別新增 `'queued'`：

```
'idle' | 'queued' | 'running' | 'done' | 'failed' | 'interrupted'
```

前端顯示（`TaskCard.tsx` badge、`TaskDrawer.tsx` 狀態文字）比照現有
`interrupted` 的呈現方式新增一個 `queued` 分支（文字：「排隊中」）。

### 3. `triggerAutomation()` 排隊時的行為

現況：`runningCount >= MAX_CONCURRENT` 時，只是 `queue.push(task)`，不做
任何狀態記錄。

改為：

```js
if (runningCount >= MAX_CONCURRENT) {
  await updateTask(task.id, { automationStatus: 'queued' })
  const run = await createAutomationRun(task.id, { prompt: buildPrompt(task), skill })
  await updateAutomationRun(run.id, { status: 'queued' })
  queue.push({ task, run })
  return
}
```

`queue` 陣列元素從單純的 `task` 改成 `{ task, run }`，讓 `onSlotFreed()`
取出時能延續同一筆 `automation_runs` 記錄，而不是重新建一筆。

### 4. `onSlotFreed()` / `runOne()` 銜接已存在的 run

`runOne(task, existingRun)` 簽章新增可選的 `existingRun` 參數：

- 若有 `existingRun`（從佇列取出）：直接沿用該筆記錄，呼叫
  `updateAutomationRun(existingRun.id, { status: 'running' })`，不再
  `createAutomationRun`。
- 若沒有（首次觸發、立即執行）：行為不變，維持現有的
  `createAutomationRun`。

這樣一筆任務的 `automation_runs` 記錄狀態演進會是
`queued → running → done/failed`，同一筆記錄橫跨排隊與執行兩個階段，
執行紀錄頁籤上看起來連貫，不會有「排隊」與「執行」變成兩筆不相關記錄
的情況。

`onSlotFreed()` 取出佇列項目時改為：

```js
const [next] = queue.splice(bestIndex, 1)
runOne(next.task, next.run).catch(...)
```

### 5. Slot 洩漏保護

`runOne()` 目前的結構是 `finishSuccess`/`finishFailed` 各自在內部呼叫
`onSlotFreed()`。若這兩個函式內的 `updateAutomationRun`/`updateTask` 拋出
例外，`onSlotFreed()` 不會被執行。

改為：`onSlotFreed()` 移出 `finishSuccess`/`finishFailed`，改由 `runOne()`
統一用 `try/finally` 保底呼叫一次：

```js
async function runOne(task, existingRun) {
  runningCount += 1
  try {
    // ... 現有邏輯，finishSuccess/finishFailed 不再自己呼叫 onSlotFreed
  } finally {
    onSlotFreed()
  }
}
```

即使 DB 寫入拋錯，`runningCount` 依然會正確遞減，佇列不會卡死。

### 6. `recoverInterruptedRuns()` 涵蓋 `queued`

`server/taskRepository.mjs` 的 `recoverInterruptedRuns()` 現有 SQL 只比對
`status = 'running'`，擴大成 `status IN ('running', 'queued')`：

```sql
UPDATE automation_runs
SET status = 'interrupted',
    error = '伺服器重啟或程序中斷，執行狀態不明（原本狀態：running/queued）',
    finished_at = ?
WHERE status IN ('running', 'queued')
```

```sql
UPDATE tasks SET automation_status = 'interrupted'
WHERE automation_status IN ('running', 'queued')
```

理由：無論任務是「正在執行」還是「排隊中尚未執行」，重啟後記憶體裡的
`runningCount`/`queue` 都會歸零，兩者都是孤兒狀態，統一交給使用者手動
按重試，不做自動恢復排隊（避免重啟後突然又冒出一堆任務搶著跑）。

### 7. 測試

- `automationRunner` 佇列邏輯（新增 `test/automationRunner.queue.test.mjs`）：
  - `MAX_CONCURRENT = 1` 時，第二個任務進佇列且被標記為 `queued`，並產生一筆
    `automation_runs` 記錄（status='queued'）
  - slot 釋放後，佇列任務依 priority 被取出，沿用同一筆 run 記錄轉為 `running`
  - `updateAutomationRun`/`updateTask` 在 finish 階段拋錯時，`runningCount`
    仍會正確釋放（下一個排隊任務依然會被執行）——用 mock/monkeypatch 模擬
    DB 寫入失敗
- `recoverInterruptedRuns` 測試（擴充現有
  `test/taskRepository.recover.test.mjs`）：新增涵蓋 `automationStatus='queued'`
  的任務/記錄，驗證重啟後同樣被標記為 `interrupted`

## 不在範圍內

- 排隊中任務重啟後自動重新排隊執行（已確認：一律交給使用者手動重試）
- Docker compose healthcheck、graceful shutdown（SIGTERM handler）——這些是
  另外討論過的穩定性項目，不在本次範圍
- output 欄位截斷、DB index、前端看板卡片狀態 polling——優化類項目，另外處理
