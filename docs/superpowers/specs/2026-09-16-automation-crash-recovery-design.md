# Spec: Automation 崩潰後孤兒狀態偵測與恢復

> 狀態：已與使用者確認，待寫 plan

## 背景 / 動機

`server/automationRunner.mjs` 的併發控制（`runningCount`、`queue`）只存在單一
Node process 的記憶體中，`automation_runs.status` 與 `tasks.automation_status`
才是持久化的真相來源。

`npm run dev` 用 `node --watch` 啟動 server：只要檔案變動觸發自動重啟（或任何
原因的 process 重啟/崩潰），任何當下正在執行的 automation run 都會變成孤兒：
- process 記憶體裡的 `runningCount`/`queue` 直接歸零重來，追蹤資訊全部遺失
- 但資料庫裡對應的 `tasks.automation_status` 與 `automation_runs.status`
  仍然停留在 `'running'`，永遠不會被更新
- 使用者在 UI 上會一直看到「Hermes 執行中」的動畫轉圈圈，但背後其實已經
  沒有任何程序在跑，造成誤導

## 核心假設（已與使用者確認）

Server 是單一 instance 部署（無水平擴展、無多副本）。因此：只要 server
啟動時，資料庫裡撈到 `automation_status = 'running'` 或
`automation_runs.status = 'running'` 的紀錄，就一定是舊 process 遺留下來的
孤兒——新 process 的 `runningCount` 必定從 0 開始，不可能還在追蹤它。不需要
額外的「確認該 process 是否還活著」偵測（例如 PID 檔、心跳機制）。

## 決策：新增 `interrupted` 狀態，交由使用者手動處理

偵測到孤兒後，**不自動標記為 failed、也不自動重跑**，而是引入一個新狀態
`interrupted`，讓使用者在 UI 上自行決定「重新執行」或「放棄」。理由：
- 自動標記 failed 會抹除「這其實是被中斷、不是真的執行失敗」的資訊
- 自動重跑有風險：若崩潰原因跟該任務本身相關（例如某個 prompt 導致
  server crash），自動重跑可能造成無限重啟循環

## 資料層設計

- 不需要 schema migration：`automation_status`／`status` 欄位本來就是自由
  TEXT，不受 DB 層 enum 約束，新增合法值只需前後端程式碼認得即可。
- Server 啟動時（監聽 port 之前）執行一次性掃描與批次更新：
  1. `tasks` 表：`automation_status = 'running'` → 批次更新為 `'interrupted'`
  2. `automation_runs` 表：`status = 'running'` → 批次更新為 `'interrupted'`，
     並將 `error` 欄位寫入固定文字：
     `伺服器重啟或程序中斷，執行狀態不明（原本狀態：running）`
     、`finished_at` 設為掃描當下的時間戳
- 兩個更新各自獨立進行（不要求同一筆 task 與其對應的 run 用同一個
  transaction，因為兩張表用的是各自獨立的 status 欄位，資料庫驅動
  `server/db/index.mjs` 目前也沒有暴露 transaction API）

## 型別變更

- `src/types/task.ts`：
  - `Task.automationStatus`: `'idle' | 'running' | 'done' | 'failed'` →
    `'idle' | 'running' | 'done' | 'failed' | 'interrupted'`
  - `AutomationRun.status`: `'running' | 'done' | 'failed'` →
    `'running' | 'done' | 'failed' | 'interrupted'`

## 後端 API 變更

新增一支 endpoint：`POST /api/tasks/:id/retry-automation`
- 讀取 task，若不存在回 404
- 直接呼叫既有 `triggerAutomation(task)`（沿用現有併發佇列、targetPath
  存在性檢查等邏輯，不重複實作）
- 回應 202（非同步觸發，不等待執行完成，與現有「拖到 in_progress 觸發」的
  行為一致）

「放棄」不需要新 endpoint：沿用既有 `PATCH /api/tasks/:id`，前端直接送
`{ automationStatus: 'failed' }`。

## 前端變更（3 個檔案都要動——這是使用者在討論中特別點出的重點）

### 1. `src/components/TaskCard.tsx`
現況：只有 `automationStatus === 'running'` 時顯示藍色「Hermes 執行中」
+ 轉圈圈圖示。新增一個並列分支：`automationStatus === 'interrupted'` 時
顯示橘色警示樣式「執行中斷」標籤（使用 `AlertTriangle` icon，
不需要動畫），讓使用者不用點進卡片就能在看板上看到哪些任務被中斷了。

### 2. `src/components/TaskDrawer.tsx`
- 狀態文字區塊（目前只列 running/done/failed 三種文字）新增
  `automationStatus === 'interrupted' && '執行中斷'`
- 「執行紀錄」分頁的小圓點指示（目前只在 `=== 'running'` 顯示）改成
  `=== 'running' || === 'interrupted'` 都顯示，提醒使用者這個分頁有
  需要處理的項目
- 當 `mode === 'edit' && initialTask?.automationStatus === 'interrupted'`
  時，在自動執行目錄欄位下方新增兩顆按鈕：
  - 「重新執行」：呼叫新的 `retryAutomationApi(taskId)`（新增到
    `src/lib/api.ts`），成功後呼叫 `onSaved()` 觸發父層 reload
  - 「放棄」：呼叫既有 `updateTaskApi(taskId, { automationStatus: 'failed' })`，
    成功後呼叫 `onSaved()`

### 3. `src/components/AutomationRunList.tsx`
**必須修正的既有 bug 觸發點**：`statusConfig` 是用物件查表
`statusConfig[run.status]` 取得 icon/label/className，目前只定義了
`running`/`done`/`failed` 三個 key。一旦資料庫真的出現 `interrupted`
但這裡沒有對應項目，`config` 會是 `undefined`，緊接著
`const Icon = config.icon` 會直接拋出 TypeError，整個 TaskDrawer 白屏。
因此本次變更**必須**在 `statusConfig` 加入：
```ts
interrupted: { icon: AlertTriangle, label: '已中斷', className: 'text-amber-600 dark:text-amber-400', spin: false },
```
（`AlertTriangle` 從 `lucide-react` import，與 TaskCard 使用同一個 icon
維持視覺一致）

## 測試涵蓋

- 後端：新增針對「啟動時掃描恢復」邏輯的單元測試（純函式，不依賴真正的
  process 重啟，直接測試「給定一個有 running 紀錄的 DB state，跑完恢復
  函式後，所有相關欄位變成 interrupted」）
- 後端：`POST /api/tasks/:id/retry-automation` 的 API 測試（存在的 task
  觸發成功回 202；不存在的 task 回 404）
- 前端：`AutomationRunList` 針對 `status: 'interrupted'` 的 run 渲染測試，
  確保不會拋出例外、正確顯示「已中斷」文字

## Out of Scope

- 不處理「原程序其實還活著只是連線斷了」（single-instance 假設下不存在）
- 不做自動重跑、不做失敗次數上限/退避策略
- 不做即時通知（例如 WebSocket 推播「你的任務被中斷了」），使用者仍需要
  重新整理頁面或原生的 automation run 2 秒 polling（`AutomationRunList`
  現有邏輯：只有存在 `running` 的 run 才會啟動 2 秒輪詢；`interrupted`
  不需要輪詢，因為它不會再自己變化狀態）
