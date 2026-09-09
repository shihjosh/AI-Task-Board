# Hermes 自動化執行——優先級佇列 + 即時進度回報 實作計畫

> **給執行的 agent：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐一任務執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤進度。

**目標：** ① 把等待中的 Hermes 自動化任務改為依優先級（high > medium > low）排序取用，而非單純 FIFO；② 把併發上限從 2 降為 1，同一時間只執行一個任務；③ 在 prompt 中教 Hermes 子代理主動呼叫 `PATCH /api/tasks/:id` 即時回報進度。

**架構：** 修改 `server/automationRunner.mjs` 的佇列選取邏輯（`onSlotFreed`）與 `buildPrompt()` 內容，其餘既有機制（`automationStatus` 狀態機、`automation_runs` 執行紀錄、`triggerAutomation` 的重複觸發防護）不變。

**技術選型：** 不新增 npm 依賴，沿用既有 Node.js 內建模組。驗證方式為建立多張不同優先級任務、curl 觀察佇列選取順序 + 手動模擬子代理呼叫 PATCH 驗證進度更新。

## 全域限制條件

- 不新增任何 npm 依賴。
- 佇列排序邏輯只影響「等待中」的任務，不影響「已在執行中」的任務（`MAX_CONCURRENT = 1` 下同一時間僅一個在跑）。
- 進度回報屬於 prompt 層級的軟性指示，不在程式碼層級強制驗證子代理是否真的呼叫（若未呼叫，`progress` 維持原值，不視為錯誤）。
- 所有新增/修改的 prompt 文字內容維持繁體中文（比照既有 `buildPrompt()` 風格）。

---

### Task 1：佇列改為依優先級排序 + 併發上限降為 1

**檔案：**
- 修改：`server/automationRunner.mjs`

**介面：**
- 產出：佇列內部行為變更，不新增任何對外 export（`triggerAutomation`、`getQueueDepth` 簽章不變）。

- [x] **Step 1：把 `MAX_CONCURRENT` 從 2 改為 1**

```js
const MAX_CONCURRENT = 1
```

- [x] **Step 2：新增優先級數值化的 helper function**

在 `buildPrompt` 之前加入：

```js
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

function priorityRank(task) {
  return PRIORITY_ORDER[task.priority] ?? PRIORITY_ORDER.low
}
```

- [x] **Step 3：修改 `onSlotFreed()`，從佇列中依優先級取出下一個**

將現有的：

```js
function onSlotFreed() {
  runningCount -= 1
  const next = queue.shift()
  if (next) runOne(next)
}
```

替換為：

```js
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
  runOne(next)
}
```

（`splice` 取出優先級數值最小者；當多筆同優先級時，迴圈用嚴格 `<` 比較，遇到相同優先級不會覆蓋 `bestIndex`，因此保留陣列中最早出現的那筆——等同穩定排序。）

- [x] **Step 4：手動驗證——多張不同優先級任務依序執行（跳過，改用 Step 4b 驗證，避免遞迴呼叫 Hermes CLI）**

```bash
mkdir -p /tmp/priority-queue-test
node --input-type=module -e "
import { createTask, deleteTask } from './server/taskRepository.mjs'
import { triggerAutomation } from './server/automationRunner.mjs'

const low = createTask({ title: 'low task', priority: 'low', columnId: 'in_progress', targetPath: '/tmp/priority-queue-test' })
const high = createTask({ title: 'high task', priority: 'high', columnId: 'in_progress', targetPath: '/tmp/priority-queue-test' })
const medium = createTask({ title: 'medium task', priority: 'medium', columnId: 'in_progress', targetPath: '/tmp/priority-queue-test' })

// 模擬三張卡片幾乎同時被拖到 in_progress：先觸發 low（會立刻開始跑，因為此時併發數為 0），
// 緊接著觸發 high、medium（此時 MAX_CONCURRENT=1 已滿，兩者都進佇列）
triggerAutomation(low)
triggerAutomation(high)
triggerAutomation(medium)

console.log('low, high, medium 三個 task id：', low.id, high.id, medium.id)
setTimeout(() => {
  deleteTask(low.id)
  deleteTask(high.id)
  deleteTask(medium.id)
  process.exit(0)
}, 2000)
"
```

預期結果：因為 `targetPath` 指向一個存在的目錄，三個 `triggerAutomation` 呼叫會實際 spawn `hermes` 子程序（此步驟涉及遞迴呼叫 Hermes CLI，若環境阻擋此操作，改用下一步的「無效 targetPath」版本驗證佇列排序邏輯本身，不驗證 spawn 行為）。

- [x] **Step 4b（若 Step 4 因遞迴呼叫被阻擋，改用此驗證）：手動驗證——用無效 targetPath 驗證佇列排序邏輯（不觸發真實 spawn）**

```bash
node --input-type=module -e "
import { createTask, deleteTask } from './server/taskRepository.mjs'
import { getQueueDepth } from './server/automationRunner.mjs'

// 直接測試 onSlotFreed 的選取邏輯：由於 triggerAutomation 對 targetPath 無效的任務會走
// 提前失敗分支（不進佇列），此驗證改為直接測試佇列陣列本身的優先級選取演算法
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }
function priorityRank(task) { return PRIORITY_ORDER[task.priority] ?? PRIORITY_ORDER.low }

const queue = [
  { id: 'a', priority: 'low' },
  { id: 'b', priority: 'high' },
  { id: 'c', priority: 'medium' },
  { id: 'd', priority: 'high' },
]

function pickNext(q) {
  let bestIndex = 0
  for (let i = 1; i < q.length; i += 1) {
    if (priorityRank(q[i]) < priorityRank(q[bestIndex])) bestIndex = i
  }
  return q.splice(bestIndex, 1)[0]
}

console.log(pickNext(queue).id) // 預期 'b'（第一個 high）
console.log(pickNext(queue).id) // 預期 'd'（第二個 high）
console.log(pickNext(queue).id) // 預期 'c'（medium）
console.log(pickNext(queue).id) // 預期 'a'（low）
process.exit(0)
"
```

預期輸出依序為 `b`、`d`、`c`、`a`——驗證同優先級（兩個 `high`）時取先加入者、且整體依優先級排序正確。

- [x] **Step 5：Commit**

```bash
git add server/automationRunner.mjs
git commit -m "feat: sort automation queue by priority, reduce concurrency to 1"
```

---

### Task 2：Prompt 新增即時進度回報指示

**檔案：**
- 修改：`server/automationRunner.mjs`

**介面：**
- 消耗：`process.env.PORT`（沿用 `server/index.mjs` 既有的 `?? 3001` 預設值邏輯）
- 產出：`buildPrompt(task)` 回傳內容新增進度回報段落，簽章不變。

- [ ] **Step 1：修改 `buildPrompt(task)`，加入進度回報指示**

將現有的：

```js
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
```

替換為：

```js
function buildPrompt(task) {
  const description = task.description?.trim() ? task.description : '（無描述）'
  const port = process.env.PORT ?? 3001
  return [
    `任務標題：${task.title}`,
    '',
    '任務描述：',
    description,
    '',
    '請根據上述標題與描述實際動手執行任務（修改程式碼、執行指令等），完成後清楚說明做了哪些變更；',
    '若無法完成或被阻塞，請明確說明原因與卡住的地方。',
    '',
    '若上述任務描述包含明確的執行步驟（例如「Step 1」「Step 2」等清單），請在完成每一個步驟後，',
    '立即執行以下指令回報進度（將 <百分比整數> 換成實際數字，例如完成 2 個 step、共 5 個 step，則填 40）：',
    '',
    `curl -s -X PATCH http://localhost:${port}/api/tasks/${task.id} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"progress": <百分比整數>}'`,
    '',
    '若描述中沒有明確的步驟清單，則不需要回報進度。',
  ].join('\n')
}
```

- [ ] **Step 2：手動驗證——確認 prompt 內容包含正確的 URL 與 task id**

```bash
node --input-type=module -e "
import { createTask, deleteTask } from './server/taskRepository.mjs'

// 直接複製 buildPrompt 的邏輯做隔離驗證（因為 buildPrompt 未 export，改用建立任務後
// 檢查 automation_runs 表寫入的 prompt 內容來間接驗證，見 Step 3）
console.log('見 Step 3 的端對端驗證')
process.exit(0)
"
```

- [ ] **Step 3：手動驗證——端對端確認 prompt 寫入 automation_runs 且含正確 curl 指令**

```bash
node server/index.mjs &
```

（實際執行時用 `terminal(background=true)` 啟動）

```bash
TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"prompt content test","priority":"low","columnId":"todo","targetPath":"/does/not/exist"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['task']['id'])")
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK_ID -H 'Content-Type: application/json' -d '{"columnId":"in_progress"}' > /dev/null
sleep 1
curl -s http://localhost:3001/api/tasks/$TASK_ID/automation-runs | python3 -c "
import json,sys
runs = json.load(sys.stdin)['runs']
print(runs[0]['prompt'])
"
curl -s -X DELETE http://localhost:3001/api/tasks/$TASK_ID
```

預期結果：印出的 `prompt` 內容包含 `curl -s -X PATCH http://localhost:3001/api/tasks/<TASK_ID>` 字串，且 URL 中的 task id 與實際建立的 `$TASK_ID` 一致。

- [ ] **Step 4：Commit**

```bash
git add server/automationRunner.mjs
git commit -m "feat: add real-time progress reporting instruction to automation prompt"
```

---

### Task 3：README + Plan 文件同步 + 最終整分支 review

**檔案：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-09-09-priority-queue-progress-reporting.md`（本檔案）

**介面：** 無（純文件任務）。

- [ ] **Step 1：更新 `README.md`**

在「Hermes Agent 自動化執行（Phase 4）」章節，補充說明：
- 佇列現在依優先級（high > medium > low）排序，同優先級依加入順序執行。
- 併發上限已從 2 降為 1，同一時間只執行一個自動化任務。
- 若任務描述包含明確的 Step 清單，Hermes 子代理執行過程中會主動呼叫 `PATCH /api/tasks/:id` 即時更新 `progress`（軟性指示，不保證一定執行）。

- [ ] **Step 2：最終整分支 review**

- 確認 `src/` 沒有新增 `dangerouslySetInnerHTML`/`innerHTML`/`eval`。
- 執行 `npx tsc -b` 與 `npm run lint`，確認皆乾淨（無新增錯誤/警告；既有的 2 個 pre-existing warning 不算新增）。
- 確認佇列排序邏輯的邊界案例：佇列只有 1 筆時 `onSlotFreed()` 不會出錯（`queue.length === 0` 提前 return 的情況也要測試——即佇列全空時呼叫 `onSlotFreed()` 不應拋出例外）。
- 清理所有手動驗證過程中建立的測試卡片，確保種子資料筆數不變。

- [ ] **Step 3：Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-09-priority-queue-progress-reporting.md
git commit -m "docs: sync README with priority queue and progress reporting, mark plan complete"
```

---

## 本計畫範圍外（依 spec 的「範圍外」章節）

- 不涉及讓使用者手動調整佇列順序。
- 不涉及進度回報失敗時的重試機制。
- 不涉及把 `MAX_CONCURRENT` 改成可設定值。
- 不涉及優先級以外的其他佇列排序因子。
