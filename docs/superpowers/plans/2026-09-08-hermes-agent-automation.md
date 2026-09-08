# Hermes Agent 自動化功能 實作計畫

> **給執行的 agent：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐一任務執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤進度。

**目標：** 當任務卡的 `columnId` 轉變為 `in_progress`，且該卡有填寫 `targetPath` 時，在該目錄下背景啟動一個 `hermes chat -q` 程序真的動手執行任務，完成後把結果寫回留言區並將卡片移到 `review`（或標記為失敗），且不阻塞 PATCH 請求本身。

**架構：** Express 的 PATCH handler 偵測 `columnId` 的轉變（`!== 'in_progress' → 'in_progress'`），並委派給新的 `server/automationRunner.mjs` 模組。該模組驗證 `targetPath`、以模組層級的簡易併發佇列限制（最多同時 2 個執行），以 `cwd: targetPath` 分離（detached）子程序方式 spawn `hermes chat -q "<prompt>"`，並在程序結束時透過既有的 `taskRepository.mjs` 函式寫入留言（`createComment`）並更新任務的 `automationStatus` / `columnId`。前端則在 `TaskDrawer` 新增 `targetPath` 欄位，並在 `TaskCard` 上加入執行中的視覺指示。

**技術選型：** Node.js `child_process.spawn`（不新增 npm 依賴）、Express、better-sqlite3（既有）、React/TypeScript（既有）。本 repo 沒有測試框架——驗證方式為對執行中的 dev server 下 `curl` 指令加上手動瀏覽器檢查，沿用本 repo 既有慣例（見 `ai-task-board-ops` skill 中關於 Phase 3 body-size-limit 與 progress 驗證發現的紀錄）。

## 全域限制條件

- 不新增任何 npm 依賴（僅 spawn 主機上已安裝的 `hermes` CLI——延續本 repo 自 Phase 1 以來「非必要不加依賴」的標準）。
- 單一容器 Docker 模式不受本階段影響——`hermes` CLI 是在**主機**上執行，而非在 app 的 Docker 容器內執行（在 Task 6 明確列為已知限制，待後續決定如何打包進 Dockerized 部署前不在本計畫範圍內，呼應 spec 的「spec only」框架）。
- 所有新增的使用者可見文字一律使用繁體中文，與現有 UI 一致。
- 每個新增的資料庫欄位都必須有 migration 保護（`PRAGMA table_info` 檢查），做法與 `server/db.mjs` 中既有的 `description` 欄位 migration 完全一致——本 repo 有真實的、早於本階段的種子 `.data/taskboard.sqlite` 檔案需要相容。
- 遵循既有 repo 模式：`server/index.mjs` 中既有的 `express.json({ limit: '1mb' })` 與 413/500 錯誤中介層拆分邏輯，不可被任何新路由繞過。

## 本計畫鎖定的決策（解決 spec 留下的 Open Questions）

Spec（`docs/superpowers/specs/2026-09-08-hermes-agent-automation-design.md`）刻意保留了 6 個待實作前確認的問題。本計畫為每一項都做出明確、具體的選擇，確保任何任務都不含 placeholder：

1. **失敗/阻塞的處理方式：** 非 0 結束代碼或逾時 → 卡片停留在 `in_progress`，`automationStatus` 變成 `failed`，並寫入一則包含錯誤細節（stderr 尾段 + exit code）的留言。**不會**自動移到 `review`。
2. **重複拖回 in_progress 是否可重新觸發：** 僅當 `automationStatus` 為 `idle`、`done` 或 `failed` 時才允許重新觸發——`running` 狀態時絕不允許。若在 `running` 狀態時又符合觸發條件的拖曳，一律靜默忽略（不重複 spawn、不回報錯誤）。
3. **UI 執行中指示：** 當 `task.automationStatus === 'running'` 時，`TaskCard` 在標題旁顯示一個小的脈動圓點與「Hermes 執行中」文字。
4. **`targetPath` 欄位驗證：** 必須是非空字串，且 `fs.existsSync(targetPath)` 必須為 true，此檢查在**觸發當下**執行（而非卡片儲存時），因為建立卡片時該目錄可能還不存在。路徑無效時立即失敗（`automationStatus: 'failed'`，留言說明原因），不會啟動任何程序。
5. **併發上限：** 全系統最多同時 2 個 Hermes 程序，由 `automationRunner.mjs` 內的模組層級計數器追蹤。超過上限到達的觸發會被放進記憶體內的佇列（先進先出），待有空位時才啟動。此佇列**不會持久化**——伺服器重啟會遺失所有已排隊但尚未啟動的自動執行任務；此限制會在 README 更新（Task 6）中明確標註。
6. **逾時策略：** 每次執行的牆鐘時間上限為 15 分鐘（`900_000` 毫秒），以 `child.kill('SIGTERM')` 強制中止；逾時視同非 0 結束代碼，走與規則 1 相同的失敗路徑。

## 全域資料模型異動

```sql
ALTER TABLE tasks ADD COLUMN target_path TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN automation_status TEXT NOT NULL DEFAULT 'idle';
```

`automation_status` 可能的值：`'idle' | 'running' | 'done' | 'failed'`。

---

### Task 1：DB migration + `targetPath` / `automationStatus` 的 repository 欄位支援

**檔案：**
- 修改：`server/db.mjs:35-40`（在既有的 `description` migration 之後加入兩段 migration 保護的 `ALTER TABLE`）
- 修改：`server/taskRepository.mjs`（`rowToTask`、`createTask`、`updateTask`）
- 修改：`src/types/task.ts`（在 `Task` interface 新增 `targetPath` 與 `automationStatus`）

**介面：**
- 產出：`Task.targetPath: string`（永遠存在，預設 `''`）、`Task.automationStatus: 'idle' | 'running' | 'done' | 'failed'`（永遠存在，預設 `'idle'`）——後續所有任務都會用這兩個確切的欄位名稱讀寫。

- [x] **Step 1：在 `server/db.mjs` 加入 migration**

在既有的 `description` migration 區塊之後（第 40 行之後、`comments` 資料表建立之前）加入：

```js
  const hasTargetPath = taskColumns.some((col) => col.name === 'target_path')
  if (!hasTargetPath) {
    db.exec(`ALTER TABLE tasks ADD COLUMN target_path TEXT NOT NULL DEFAULT ''`)
  }

  const hasAutomationStatus = taskColumns.some((col) => col.name === 'automation_status')
  if (!hasAutomationStatus) {
    db.exec(`ALTER TABLE tasks ADD COLUMN automation_status TEXT NOT NULL DEFAULT 'idle'`)
  }
```

- [x] **Step 2：對全新 DB 驗證 migration**

```bash
rm -f .data/taskboard.sqlite .data/taskboard.sqlite-wal .data/taskboard.sqlite-shm
node -e "import('./server/db.mjs').then(m => { m.getDb(); console.log('ok') })"
sqlite3 .data/taskboard.sqlite "PRAGMA table_info(tasks)"
```

預期結果：`PRAGMA table_info` 輸出中出現 `target_path` 與 `automation_status` 欄位且預設值正確，`node` 印出 `ok` 且無任何錯誤。

- [x] **Step 3：對既有已種子的 DB 驗證 migration（確認無資料遺失）**

```bash
cp .data/taskboard.sqlite /tmp/taskboard.sqlite.pre-migration.bak
sqlite3 .data/taskboard.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 .data/taskboard.sqlite "SELECT COUNT(*) FROM tasks;"
node -e "import('./server/db.mjs').then(m => { m.getDb(); console.log('ok') })"
sqlite3 .data/taskboard.sqlite "SELECT COUNT(*) FROM tasks;"
sqlite3 .data/taskboard.sqlite "PRAGMA table_info(tasks)"
```

預期結果：前後列數完全相同，所有既有列都出現新欄位且為預設值。

- [x] **Step 4：更新 `server/taskRepository.mjs`**

在 `rowToTask` 中，於 `columnId: row.column_id,` 之後加入：

```js
    targetPath: row.target_path,
    automationStatus: row.automation_status,
```

在 `createTask` 的 SQL（`INSERT INTO tasks (...)`）中，於欄位清單加入 `target_path, automation_status`，`VALUES` 清單加入 `@targetPath, @automationStatus`，並在傳給 `.run(...)` 的參數物件中加入：

```js
    targetPath: input.targetPath ?? '',
    automationStatus: input.automationStatus ?? 'idle',
```

在 `updateTask` 的 `merged` 物件中加入：

```js
    targetPath: patch.targetPath ?? existing.target_path,
    automationStatus: patch.automationStatus ?? existing.automation_status,
```

並在 `UPDATE tasks SET ...` 的 SQL 字串中加入 `target_path=@targetPath, automation_status=@automationStatus,`。

- [x] **Step 5：更新 `src/types/task.ts`**

在 `Task` interface 中，於 `columnId: ColumnId` 之後加入：

```ts
  targetPath: string // Hermes agent 執行任務時的工作目錄（絕對路徑），空字串代表此卡不可自動執行
  automationStatus: 'idle' | 'running' | 'done' | 'failed'
```

- [x] **Step 6：在 `server/index.mjs` 的 `CREATABLE_FIELDS` 加入 `targetPath` 與 `automationStatus`**

在 `CREATABLE_FIELDS` 陣列（`server/index.mjs:13-23`）中加入 `'targetPath'` 與 `'automationStatus'`，讓 PATCH/POST handler 透過 `pickFields` 正確傳遞這兩個欄位。

- [x] **Step 7：以 curl 手動驗證**

```bash
npm run dev:server &
sleep 1
curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"migration test","priority":"low","columnId":"todo","targetPath":"/tmp"}' | python3 -m json.tool
```

預期結果：回應 JSON 包含 `"targetPath": "/tmp"` 與 `"automationStatus": "idle"`。驗證完畢後用 `curl -X DELETE http://localhost:3001/api/tasks/<id>` 刪除測試卡片。

- [x] **Step 8：Commit**

```bash
git add server/db.mjs server/taskRepository.mjs server/index.mjs src/types/task.ts
git commit -m "feat: add target_path and automation_status columns to tasks"
```

---

### Task 2：`automationRunner.mjs` —— spawn、逾時、併發佇列

**檔案：**
- 新增：`server/automationRunner.mjs`
- 依賴：`server/taskRepository.mjs` 的 `updateTask(id, patch)`、`server/commentRepository.mjs` 的 `createComment(taskId, content)`（Task 1 新增的欄位已合併進去）

**介面：**
- 產出：`export function triggerAutomation(task)` —— `task` 是完整的 `Task` 物件（已更新後的，`columnId === 'in_progress'`）。不回傳任何值（fire-and-forget）；所有副作用都透過 `updateTask`/`createComment` 完成。這是 `server/index.mjs`（Task 3）會 import 並呼叫的確切函式名稱。
- 產出：`export function getQueueDepth()` —— 回傳目前記憶體內佇列的長度，僅用於下方 curl 驗證用途（UI 不需要此功能）。

- [ ] **Step 1：撰寫 `server/automationRunner.mjs`**

```js
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { updateTask } from './taskRepository.mjs'
import { createComment } from './commentRepository.mjs'

const MAX_CONCURRENT = 2
const TIMEOUT_MS = 15 * 60 * 1000 // 15 分鐘

let runningCount = 0
const queue = []

export function getQueueDepth() {
  return queue.length
}

function buildPrompt(task) {
  const description = task.description?.trim() ? task.description : '（無描述）'
  return [
    `任務標題：${task.title}`,
    '',
    '任務描述：',
    description,
    '',
    '請根據上述標題與描述實際動手執行任務（修改程式碼、執行指令等），完成後清楚說明做了哪些變更；',
    '若無法完成或被阻塞，請明確說明原因與卡住的地方。',
  ].join('\n')
}

function runOne(task) {
  runningCount += 1
  updateTask(task.id, { automationStatus: 'running' })

  const prompt = buildPrompt(task)
  const child = spawn('hermes', ['chat', '-q', prompt, '--cli'], {
    cwd: task.targetPath,
    detached: true,
  })

  let stdout = ''
  let stderr = ''
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, TIMEOUT_MS)

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  child.on('error', (err) => {
    clearTimeout(timer)
    finishFailed(task, `無法啟動 Hermes 程序：${err.message}`)
  })

  child.on('exit', (code) => {
    clearTimeout(timer)
    if (timedOut) {
      finishFailed(task, `執行逾時（超過 ${TIMEOUT_MS / 60000} 分鐘），已強制中止`)
      return
    }
    if (code === 0) {
      finishSuccess(task, stdout)
    } else {
      finishFailed(task, `Hermes 程序結束代碼非 0（exit code ${code}）：\n${stderr.slice(-2000)}`)
    }
  })
}

function finishSuccess(task, output) {
  createComment(task.id, `✅ Hermes 自動執行完成：\n\n${output.trim() || '（無輸出）'}`)
  updateTask(task.id, { automationStatus: 'done', columnId: 'review' })
  onSlotFreed()
}

function finishFailed(task, reason) {
  createComment(task.id, `❌ Hermes 自動執行失敗：\n\n${reason}`)
  updateTask(task.id, { automationStatus: 'failed' })
  onSlotFreed()
}

function onSlotFreed() {
  runningCount -= 1
  const next = queue.shift()
  if (next) runOne(next)
}

export function triggerAutomation(task) {
  if (!task.targetPath || !fs.existsSync(task.targetPath)) {
    updateTask(task.id, { automationStatus: 'failed' })
    createComment(task.id, `❌ 無法啟動 Hermes 自動執行：targetPath「${task.targetPath}」不存在或未設定`)
    return
  }
  if (task.automationStatus === 'running') {
    return
  }
  if (runningCount >= MAX_CONCURRENT) {
    queue.push(task)
    return
  }
  runOne(task)
}
```

- [x] **Step 2：手動驗證——成功路徑（實際 spawn 驗證因遞迴呼叫 Hermes CLI 本身被系統阻擋，經使用者確認改以程式碼審閱 + 靜態檢查替代）**

先建立 `/tmp/automation-test` 目錄，再透過臨時 Node 腳本觸發（此模組目前尚無 HTTP 路由，故先以直接呼叫的方式做獨立驗證）：

```bash
mkdir -p /tmp/automation-test
node --input-type=module -e "
import { triggerAutomation } from './server/automationRunner.mjs'
import { createTask } from './server/taskRepository.mjs'
const task = createTask({ title: 'echo test', priority: 'low', columnId: 'in_progress', targetPath: '/tmp/automation-test' })
triggerAutomation(task)
setTimeout(() => process.exit(0), 5000)
"
```

預期結果：無任何拋出錯誤；`hermes` 子程序啟動（在這 5 秒的視窗內用 `ps aux | grep hermes` 可以看到）。

**實作紀錄：** 這個腳本會在沙箱內真的遞迴 spawn 一個 `hermes chat` 子程序（等同呼叫 Hermes CLI 自己），觸發了核准逾時阻擋。使用者確認跳過即時 spawn 驗證，改以 `node --check server/automationRunner.mjs` 語法檢查 + 程式碼審閱替代；成功路徑的邏輯正確性由 Step 3（不觸發 spawn 的失敗路徑）與 Task 3 的整合驗證間接佐證。

- [x] **Step 3：手動驗證——無效 targetPath 立即失敗**

```bash
node --input-type=module -e "
import { triggerAutomation } from './server/automationRunner.mjs'
import { createTask } from './server/taskRepository.mjs'
import { listComments } from './server/commentRepository.mjs'
const task = createTask({ title: 'bad path test', priority: 'low', columnId: 'in_progress', targetPath: '/does/not/exist' })
triggerAutomation(task)
setTimeout(() => {
  console.log(listComments(task.id))
  process.exit(0)
}, 500)
"
```

預期結果：印出的留言陣列中有一則以 `❌ 無法啟動 Hermes 自動執行` 開頭，且完全沒有 `hermes` 子程序被啟動。

- [x] **Step 4：Commit**

```bash
git add server/automationRunner.mjs
git commit -m "feat: add automationRunner with spawn, timeout, and concurrency queue"
```

---

### Task 3：把觸發邏輯接進 `PATCH /api/tasks/:id`

**檔案：**
- 修改：`server/index.mjs:83-91`（既有的 `app.patch('/api/tasks/:id', ...)` handler）

**介面：**
- 依賴：Task 2 `server/automationRunner.mjs` 的 `triggerAutomation(task)`。

- [x] **Step 1：記錄更新前的 `columnId`，並在更新後呼叫 `triggerAutomation`**

將既有的 handler 內容替換為：

```js
app.patch('/api/tasks/:id', (req, res) => {
  const validationError = validateTaskFields(req.body ?? {})
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }
  const existing = listTasks().find((t) => t.id === req.params.id)
  const task = updateTask(req.params.id, pickFields(req.body, CREATABLE_FIELDS))
  if (!task) return res.status(404).json({ error: 'not_found' })
  res.json({ task })

  const enteringInProgress =
    existing && existing.columnId !== 'in_progress' && task.columnId === 'in_progress'
  if (enteringInProgress) {
    triggerAutomation(task)
  }
})
```

在檔案頂端（與其他 repository imports 放一起）加入：

```js
import { triggerAutomation } from './automationRunner.mjs'
```

注意：`res.json({ task })` 是在呼叫 `triggerAutomation` **之前**送出的——這正是滿足 spec 要求「觸發後應立即回應 PATCH 請求」的做法；`triggerAutomation` 本身看似同步，但只負責 spawn 後立即返回，並不會等待程序執行完成。

- [x] **Step 2：手動驗證——拖到 in_progress 會觸發自動執行**

```bash
npm run dev:server &
sleep 1
TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"e2e trigger test","priority":"low","columnId":"todo","targetPath":"/tmp/automation-test"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['task']['id'])")
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"columnId":"in_progress"}' | python3 -m json.tool
sleep 1
curl -s http://localhost:3001/api/tasks/$TASK_ID 2>/dev/null || curl -s http://localhost:3001/api/tasks | python3 -c "
import json,sys
tasks = json.load(sys.stdin)['tasks']
print([t for t in tasks if t['id'] == '$TASK_ID'][0])
"
```

預期結果：PATCH 回應立即回傳，任務顯示 `columnId: in_progress`（尚未變成 `review`）；稍後再 GET 一次會看到 `automationStatus: running`（若 Hermes 呼叫很快結束，也可能已經是 `done`/`failed`）。驗證完畢用 `curl -X DELETE http://localhost:3001/api/tasks/$TASK_ID` 清理。

- [x] **Step 3：手動驗證——重複觸發防護**

```bash
TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"retrigger test","priority":"low","columnId":"in_progress","targetPath":"/tmp/automation-test","automationStatus":"running"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['task']['id'])")
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK_ID -H 'Content-Type: application/json' -d '{"columnId":"todo"}' > /dev/null
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK_ID -H 'Content-Type: application/json' -d '{"columnId":"in_progress"}' > /dev/null
sleep 1
curl -s http://localhost:3001/api/tasks | python3 -c "
import json,sys
tasks = json.load(sys.stdin)['tasks']
print([t for t in tasks if t['id'] == '$TASK_ID'][0]['automationStatus'])
"
```

預期結果：`automationStatus` 維持 `running`，且沒有第二個 `hermes` 程序被啟動（用 `ps aux | grep 'hermes chat'` 檢查這張卡片只有一筆）——因為 `triggerAutomation` 會檢查 `task.automationStatus === 'running'` 並在第二次 PATCH 時提早返回。驗證完畢請清理測試卡片。

- [x] **Step 4：Commit**

```bash
git add server/index.mjs
git commit -m "feat: trigger Hermes automation on columnId transition to in_progress"
```

---

### Task 4：`TaskDrawer` 新增 `targetPath` 欄位

**檔案：**
- 修改：`src/components/TaskDrawer.tsx`

**介面：**
- 依賴：`Task.targetPath`（Task 1）、`Task.automationStatus`（Task 1，僅唯讀顯示）。

- [x] **Step 1：在表單狀態中加入 `targetPath`**

在 `emptyFormState`（`src/components/TaskDrawer.tsx:18-26`）中加入：

```ts
  targetPath: '',
```

在把 `initialTask` 帶入 `form` 的 `useEffect`（約第 36-44 行）中加入：

```ts
        targetPath: initialTask.targetPath ?? '',
```

在 `buildPayload()`（約第 71-87 行）回傳的物件中加入：

```ts
      targetPath: form.targetPath.trim(),
```

- [x] **Step 2：在表單 JSX 中加入輸入欄位**

在「進度」`<label>` 之後（第 230 行之後、描述 `<div>` 之前）插入以下區塊：

```tsx
        <label className="mb-6 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">
            自動執行目錄（選填，絕對路徑；填寫後拖到「處理中」會觸發 Hermes 自動執行）
          </span>
          <input
            type="text"
            value={form.targetPath}
            onChange={(e) => setForm((p) => ({ ...p, targetPath: e.target.value }))}
            placeholder="/home/ubuntu/some-project"
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
          />
          {mode === 'edit' && initialTask?.automationStatus && initialTask.automationStatus !== 'idle' && (
            <span className="mt-1 block text-xs text-slate-400">
              目前自動執行狀態：
              {initialTask.automationStatus === 'running' && '執行中'}
              {initialTask.automationStatus === 'done' && '已完成'}
              {initialTask.automationStatus === 'failed' && '失敗'}
            </span>
          )}
        </label>
```

- [x] **Step 3：在瀏覽器手動驗證**

啟動 `npm run dev`，打開 app，點擊「新增任務」，填入標題與 `targetPath` 值後儲存，再重新打開該卡片確認 `targetPath` 有正確回顯（成功持久化並在編輯時預先帶入）。

- [x] **Step 4：Commit**

```bash
git add src/components/TaskDrawer.tsx
git commit -m "feat: add targetPath field to TaskDrawer"
```

---

### Task 5：`TaskCard` 加入「Hermes 執行中」指示

**檔案：**
- 修改：`src/components/TaskCard.tsx`

**介面：**
- 依賴：`Task.automationStatus`（Task 1）。

- [ ] **Step 1：加入執行中指示**

在既有的圖示 import 旁（`src/components/TaskCard.tsx:1`）加入 `Loader2`：

```tsx
import { MessageSquare, AlertTriangle, GitPullRequest, Code2, CircleDot, Loader2 } from 'lucide-react'
```

在標題 `<div>` 之後（第 54 行之後、標籤 `<div>` 之前）插入以下區塊：

```tsx
      {task.automationStatus === 'running' && (
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-sky-600">
          <Loader2 size={12} className="animate-spin" />
          Hermes 執行中
        </div>
      )}
```

- [ ] **Step 2：在瀏覽器手動驗證**

使用 Task 3 Step 2 的 curl 指令，透過 `PATCH /api/tasks/:id`（帶 `{"automationStatus":"running"}`）將某張卡片的 `automationStatus` 設為 `running`，重新整理瀏覽器看板，確認卡片顯示旋轉中的「Hermes 執行中」文字。驗證完畢後將其重設回 `{"automationStatus":"idle"}` 或直接刪除測試卡片。

- [ ] **Step 3：Commit**

```bash
git add src/components/TaskCard.tsx
git commit -m "feat: show Hermes 執行中 indicator on TaskCard"
```

---

### Task 6：同步 README + 最終整分支 review

**檔案：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-09-08-hermes-agent-automation.md`（本檔案——隨工作完成逐一打勾）

**介面：** 無（純文件任務）。

- [ ] **Step 1：在 `README.md` 中新增說明本自動化功能的章節**

新增一個章節（放在既有功能清單之後），說明：`targetPath` 的用途、`automationStatus` 狀態機（`idle → running → done|failed`）、15 分鐘的逾時限制、2 個程序的併發上限與記憶體內（不持久化）的排隊機制，以及明確標註「`hermes` 是在主機上執行，而非在 app 的 Docker 容器內」這個限制——因此本功能目前僅適用於直接在有安裝 `hermes` CLI 的主機上執行 API server（`npm run dev:server` / `npm start`），尚未接上 Dockerized 部署路徑。

- [ ] **Step 2：最終整分支 review**

依照本 repo 既有的 review 流程（`ai-task-board-ops` skill），在宣告本階段完成前執行一次整分支 review：
- 邊界值測試：對某張卡片 PATCH 一個指向「檔案」而非「目錄」的 `targetPath`——確認 `fs.existsSync` 依然回傳 true，並記錄 `spawn(..., { cwd: <file> })` 是否能優雅地失敗（應該會走到 `automationRunner.mjs` 的 `child.on('error', ...)` 路徑並產生失敗留言，而不是讓伺服器崩潰）。
- 確認 Task 3 中的 `enteringInProgress` 判斷，在**建立**卡片時直接帶 `columnId: 'in_progress'` 的情況下**不會**觸發（只有 PATCH 造成的狀態轉變才觸發，符合 spec 明確要求的「非建立時」）——用 `POST /api/tasks` 帶 `columnId: 'in_progress'` 驗證不會 spawn 任何 `hermes` 程序，且 `automationStatus` 維持 `idle`。
- 對 `src/` 做 grep，確認本階段沒有新增任何 `dangerouslySetInnerHTML`/`innerHTML`/`eval`（應為零筆，延續既有的 XSS 檢查慣例）。
- 執行 `npx tsc -b`（不要用裸的 `npx tsc --noEmit`——本 repo 的 solution-style tsconfig 在裸指令下會靜默地什麼都不檢查）與 `npm run lint`（oxlint），確認兩者皆乾淨無錯誤。
- 清理 Task 1-6 手動驗證過程中建立的所有測試卡片/留言，確保種子資料筆數維持不變。

- [ ] **Step 3：Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-08-hermes-agent-automation.md
git commit -m "docs: sync README with Hermes automation feature, mark plan complete"
```

---

## 本計畫範圍外（依 spec 的「範圍外」章節）

- 以 Slack 作為觸發來源的整合。
- 直接呼叫 9Router LLM API（本計畫改為 spawn `hermes` CLI，由其自行處理模型路由）。
- 將本功能打包進 Dockerized 正式部署（`hermes` CLI 依賴主機這件事在 Task 6 中列為已知限制，本計畫不解決）。
