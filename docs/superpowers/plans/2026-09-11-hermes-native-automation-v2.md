# Hermes 原生自動化升級 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AI-Task-Board 的 Hermes Agent 自動化執行從「裸 spawn + 黑箱輸出」升級為「worktree 隔離 + 可選 skill 預載 + 即時輸出可視化」，落實 spec
`docs/superpowers/specs/2026-09-11-hermes-native-automation-v2-design.md` 的三項決策。

**Architecture:** 後端 `automationRunner.mjs` 的 spawn 指令加上 Hermes CLI 內建的 `-w`（worktree 隔離）與可選 `-s <skill>`（技能預載）；
`child.stdout`/`stderr` 的每個 `data` 事件即時 append 寫回 SQLite 的 `automation_runs.output` 欄位（取代現有「等 exit 才一次性寫入」的做法）；
新增一個純讀取的 `GET /api/skills` endpoint 掃描 `~/.hermes/skills` 目錄提供技能清單；前端 `TaskDrawer` 新增技能下拉選單，
`AutomationRunList` 對 `running` 狀態的紀錄改為每 2 秒輪詢一次以顯示接近即時的輸出。

**Tech Stack:** Node.js + Express（後端）、better-sqlite3、React + TypeScript（前端）、Hermes CLI（`hermes chat -q ... -w -s ...`）

## Global Constraints

- 不自動開 PR——worktree 分支跑完成功後（`automationStatus: done`）需自動 `git push` 該分支到 origin（若有設定 remote），但不開 PR，由使用者自行決定何時 merge。push 失敗（無 remote/網路/權限問題）視為非致命錯誤，記錄在 `automation_runs.error`，不影響 `automationStatus: done` 的判定。
- `MAX_CONCURRENT` 維持 `1`，本次不提升併發。
- `GET /api/skills` 直接掃描檔案系統（`~/.hermes/skills/<category>/<name>/SKILL.md`），不 parse `hermes skills list` 的 CLI 表格輸出。
- 即時輸出用前端輪詢（比照現有 `fetchTasks`/`fetchAutomationRuns` 模式），不用 SSE/WebSocket。
- TypeScript 驗證用 `npx tsc -b`（裸 `tsc --noEmit` 在此 repo 會靜默通過，不算有效驗證）。lint 用 `npm run lint`（oxlint）。
- 不新增任何 npm 依賴。
- git commit 身份：`git -c user.name="josh" -c user.email="shihjosh@users.noreply.github.com" commit -m "..."`，commit message 用英文簡短祈使句。
- SQLite schema 變更一律用 `PRAGMA table_info` 存在性檢查後 `ALTER TABLE`（比照 `db.mjs` 現有的 `description`/`target_path`/`automation_status`/`due_date` 遷移模式），不可直接改 `CREATE TABLE IF NOT EXISTS` 的欄位定義（對舊資料庫檔案無效）。
- 新增/修改的 API 欄位須加入 `server/index.mjs` 的 `CREATABLE_FIELDS` 白名單（否則 POST/PATCH 靜默丟棄該欄位，不會報錯）。

---

## Task 1：資料庫 schema 擴充 + repository 層擴充 ✅ 完成（commit c02df79..d6c9c8c，review clean）

**Files:**
- Modify: `server/db.mjs`
- Modify: `server/automationRunRepository.mjs`
- Modify: `server/taskRepository.mjs`
- Modify: `src/types/task.ts`

**Interfaces:**
- Produces：
  - `tasks.automation_skill` 資料庫欄位（TEXT，預設 `''`），對應 `Task.automationSkill?: string`
  - `automation_runs.worktree_path` 資料庫欄位（TEXT，預設 `''`），對應 `AutomationRun.worktreePath?: string`
  - `automation_runs.worktree_branch` 資料庫欄位（TEXT，預設 `''`），對應 `AutomationRun.worktreeBranch?: string`
  - `automation_runs.skill` 資料庫欄位（TEXT，預設 `''`），對應 `AutomationRun.skill?: string`
  - `automationRunRepository.mjs` 新增 `appendAutomationRunOutput(id, chunk)`：把 `chunk` 累加到既有 `output` 欄位（不覆蓋），供 Task 3 即時串流使用
  - `createAutomationRun(taskId, { prompt, skill })` 簽名擴充，接受第二個參數的 `skill`（可為 `undefined`）
  - `updateAutomationRun(id, { status, output, error, worktreePath, worktreeBranch })` 簽名擴充，接受 `worktreePath`/`worktreeBranch`
  - `createTask`/`updateTask` 支援讀寫 `automationSkill` 欄位（比照現有 `targetPath` 的處理方式）

- [x] **Step 1: 在 `server/db.mjs` 新增四個欄位的 migration guard**

在既有 `hasDueDate` 判斷區塊之後（第 55 行 `}` 之後），加入：

```js
  const hasAutomationSkill = taskColumns.some((col) => col.name === 'automation_skill')
  if (!hasAutomationSkill) {
    db.exec(`ALTER TABLE tasks ADD COLUMN automation_skill TEXT NOT NULL DEFAULT ''`)
  }
```

並在 `automation_runs` 的 `CREATE TABLE IF NOT EXISTS` 語句（第 68-80 行）之後、`db.pragma('foreign_keys = ON')`（第 83 行）之前，加入：

```js
  const runColumns = db.prepare('PRAGMA table_info(automation_runs)').all()
  const hasWorktreePath = runColumns.some((col) => col.name === 'worktree_path')
  if (!hasWorktreePath) {
    db.exec(`ALTER TABLE automation_runs ADD COLUMN worktree_path TEXT NOT NULL DEFAULT ''`)
  }
  const hasWorktreeBranch = runColumns.some((col) => col.name === 'worktree_branch')
  if (!hasWorktreeBranch) {
    db.exec(`ALTER TABLE automation_runs ADD COLUMN worktree_branch TEXT NOT NULL DEFAULT ''`)
  }
  const hasRunSkill = runColumns.some((col) => col.name === 'skill')
  if (!hasRunSkill) {
    db.exec(`ALTER TABLE automation_runs ADD COLUMN skill TEXT NOT NULL DEFAULT ''`)
  }
```

- [x] **Step 2: 驗證 migration 在新舊兩種資料庫檔案上都正確**

```bash
cp .data/taskboard.sqlite /tmp/taskboard.sqlite.pre-task1.bak 2>/dev/null || echo "no existing db yet, skip backup"
sqlite3 .data/taskboard.sqlite "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
node -e "import('./server/db.mjs').then(m => { m.getDb(); console.log('migration ran OK') })"
sqlite3 .data/taskboard.sqlite "PRAGMA table_info(tasks);" | grep automation_skill
sqlite3 .data/taskboard.sqlite "PRAGMA table_info(automation_runs);" | grep -E "worktree_path|worktree_branch|skill"
```

Expected: 四個欄位皆出現在對應的 `PRAGMA table_info` 輸出中，且若之前有資料，`SELECT COUNT(*) FROM tasks` 前後筆數不變。

- [x] **Step 3: 修改 `server/automationRunRepository.mjs`**

`rowToRun` 函式（第 4-15 行）加入新欄位：

```js
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
    skill: row.skill || undefined,
    worktreePath: row.worktree_path || undefined,
    worktreeBranch: row.worktree_branch || undefined,
  }
}
```

`createAutomationRun` 函式（第 25-34 行）改為：

```js
export function createAutomationRun(taskId, { prompt, skill }) {
  const db = getDb()
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO automation_runs (id, task_id, status, prompt, output, error, started_at, finished_at, skill, worktree_path, worktree_branch)
     VALUES (@id, @taskId, 'running', @prompt, '', NULL, @startedAt, NULL, @skill, '', '')`,
  ).run({ id, taskId, prompt, startedAt, skill: skill ?? '' })
  return rowToRun(db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id))
}
```

`updateAutomationRun` 函式（第 36-52 行）改為：

```js
export function updateAutomationRun(id, { status, output, error, worktreePath, worktreeBranch }) {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id)
  if (!existing) return null
  const finishedAt = new Date().toISOString()
  db.prepare(
    `UPDATE automation_runs SET status = @status, output = @output, error = @error, finished_at = @finishedAt,
     worktree_path = @worktreePath, worktree_branch = @worktreeBranch
     WHERE id = @id`,
  ).run({
    id,
    status,
    output: output ?? existing.output,
    error: error ?? null,
    finishedAt,
    worktreePath: worktreePath ?? existing.worktree_path,
    worktreeBranch: worktreeBranch ?? existing.worktree_branch,
  })
  return rowToRun(db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id))
}
```

在檔案末尾新增：

```js
export function appendAutomationRunOutput(id, chunk) {
  const db = getDb()
  const existing = db.prepare('SELECT output FROM automation_runs WHERE id = ?').get(id)
  if (!existing) return
  db.prepare('UPDATE automation_runs SET output = @output WHERE id = @id').run({
    id,
    output: existing.output + chunk,
  })
}
```

- [x] **Step 4: 修改 `server/taskRepository.mjs` 支援 `automationSkill`**

`rowToTask`（第 4-22 行）加入一行：`automationSkill: row.automation_skill || undefined,`

`createTask` 的 INSERT 語句（第 35-37 行）欄位清單加入 `automation_skill`，VALUES 加入 `@automationSkill`；`.run({...})` 物件（第 38-54 行）加入 `automationSkill: input.automationSkill ?? '',`

`updateTask` 的 `merged` 物件（第 64-78 行）加入 `automationSkill: patch.automationSkill ?? existing.automation_skill,`；UPDATE 語句（第 80-84 行）加入 `automation_skill=@automationSkill`

- [x] **Step 5: 修改 `src/types/task.ts`**

`Task` interface（第 19-34 行）加入：

```ts
  automationSkill?: string // 自動執行時要預載的 Hermes skill 名稱，選填
```

`AutomationRun` interface（第 44-53 行）加入：

```ts
  skill?: string
  worktreePath?: string
  worktreeBranch?: string
```

- [x] **Step 6: 手動驗證 repository 層**

```bash
node -e "
import('./server/automationRunRepository.mjs').then(async (m) => {
  const run = m.createAutomationRun('test-task-id', { prompt: 'test prompt', skill: 'test-skill' })
  console.log('created:', JSON.stringify(run))
  m.appendAutomationRunOutput(run.id, 'hello ')
  m.appendAutomationRunOutput(run.id, 'world')
  const updated = m.updateAutomationRun(run.id, { status: 'done', worktreePath: '/tmp/wt', worktreeBranch: 'task/abc' })
  console.log('updated:', JSON.stringify(updated))
})
"
```

Expected: 印出的 `created` 物件含 `skill: 'test-skill'`；`updated` 物件的 `output` 為 `'hello world'`、`worktreePath: '/tmp/wt'`、`worktreeBranch: 'task/abc'`。手動用 `sqlite3 .data/taskboard.sqlite "DELETE FROM automation_runs WHERE task_id = 'test-task-id'"` 清除測試資料。

- [x] **Step 7: 驗證與提交**

```bash
npx tsc -b
npm run lint
git add server/db.mjs server/automationRunRepository.mjs server/taskRepository.mjs src/types/task.ts
git -c user.name="josh" -c user.email="shihjosh@users.noreply.github.com" commit -m "feat: extend schema and repositories for worktree isolation and skill tracking"
```

Expected: `tsc -b` 與 `lint` 皆無新錯誤（既有的 3 個既知 warning 不受影響）。

---

## Task 2：`GET /api/skills` endpoint ✅ 完成（commit d6c9c8c..5e17c98，review clean）

**Files:**
- Create: `server/skillsRepository.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Consumes：無（純讀取檔案系統，不依賴 Task 1）
- Produces：
  - `skillsRepository.mjs` 匯出 `listAvailableSkills()`，回傳 `string[]`（skill 名稱清單，已排序、去重）
  - `GET /api/skills` 回傳 `{ skills: string[] }`

- [x] **Step 1: 建立 `server/skillsRepository.mjs`**

```js
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function resolveSkillsDir() {
  return process.env.HERMES_HOME
    ? path.join(process.env.HERMES_HOME, 'skills')
    : path.join(os.homedir(), '.hermes', 'skills')
}

export function listAvailableSkills() {
  const skillsDir = resolveSkillsDir()
  if (!fs.existsSync(skillsDir)) return []

  const names = new Set()
  const categories = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory())
  for (const category of categories) {
    const categoryPath = path.join(skillsDir, category.name)
    const entries = fs.readdirSync(categoryPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && fs.existsSync(path.join(categoryPath, entry.name, 'SKILL.md'))) {
        names.add(entry.name)
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        // 極少數 skill 直接放在 category 目錄下（無子目錄包裝），以 category 名稱本身當作 skill 名稱
        names.add(category.name)
      }
    }
  }
  return [...names].sort()
}
```

- [x] **Step 2: 手動驗證掃描邏輯**

```bash
node -e "import('./server/skillsRepository.mjs').then(m => console.log(m.listAvailableSkills()))"
```

Expected: 印出一個字串陣列，內含目前環境已安裝的 skill 名稱（例如 `ai-task-board-ops`、`hermes-agent` 等），無重複、已排序。

- [x] **Step 3: 在 `server/index.mjs` 掛上 route**

在檔案頂部 import 區塊（第 8 行 `import { listAutomationRuns } ...` 之後）加入：

```js
import { listAvailableSkills } from './skillsRepository.mjs'
```

在 `app.get('/api/tasks/:taskId/automation-runs', ...)`（第 115-117 行）之後加入：

```js
app.get('/api/skills', (req, res) => {
  res.json({ skills: listAvailableSkills() })
})
```

- [x] **Step 4: 啟動 server 並用 curl 驗證 endpoint**

```bash
node server/index.mjs &
sleep 1
curl -s http://localhost:3001/api/skills
kill %1
```

Expected: 回傳 `{"skills":[...]}`，陣列內容與 Step 2 手動測試結果一致。

- [x] **Step 5: 驗證與提交**

```bash
npx tsc -b
npm run lint
git add server/skillsRepository.mjs server/index.mjs
git -c user.name="josh" -c user.email="shihjosh@users.noreply.github.com" commit -m "feat: add GET /api/skills endpoint scanning ~/.hermes/skills"
```

---

## Task 3：`automationRunner.mjs` 改用 `-w` + `-s` + 即時串流輸出 ✅ 完成（commit 5e17c98..077be8a，review clean）

**Files:**
- Modify: `server/automationRunner.mjs`

**Interfaces:**
- Consumes：Task 1 的 `appendAutomationRunOutput(id, chunk)`、`createAutomationRun(taskId, { prompt, skill })`、`updateAutomationRun(id, { status, output, error, worktreePath, worktreeBranch })`；`task.automationSkill`（Task 1 的 `Task` 欄位）
- Produces：`triggerAutomation(task)` 簽名不變（呼叫端 `server/index.mjs` 不需修改）

- [x] **Step 1: 修改 import 與 `runOne` 函式**

第 1 行的 import 改為（新增 `spawnSync`）：

```js
import { spawn, spawnSync } from 'node:child_process'
```

第 4 行的 import 改為：

```js
import { createAutomationRun, updateAutomationRun, appendAutomationRunOutput } from './automationRunRepository.mjs'
```

`runOne` 函式（第 45-96 行）整段改為：

```js
function runOne(task) {
  runningCount += 1
  updateTask(task.id, { automationStatus: 'running' })

  const prompt = buildPrompt(task)
  const skill = task.automationSkill?.trim() || undefined
  const run = createAutomationRun(task.id, { prompt, skill })

  const args = ['chat', '-q', prompt, '-w', '--cli']
  if (skill) {
    args.push('-s', skill)
  }

  let child
  try {
    child = spawn('hermes', args, {
      cwd: task.targetPath,
      detached: true,
    })
  } catch (err) {
    finishFailed(task, run, `無法啟動 Hermes 程序：${err.message}`)
    return
  }

  let stdout = ''
  let stderr = ''
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, TIMEOUT_MS)

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    stdout += text
    appendAutomationRunOutput(run.id, text)
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  child.on('error', (err) => {
    clearTimeout(timer)
    finishFailed(task, run, `無法啟動 Hermes 程序：${err.message}`)
  })

  child.on('exit', (code) => {
    clearTimeout(timer)
    const worktreeInfo = extractWorktreeInfo(stdout)
    if (timedOut) {
      finishFailed(task, run, `執行逾時（超過 ${TIMEOUT_MS / 60000} 分鐘），已強制中止`, worktreeInfo)
      return
    }
    if (code === 0) {
      finishSuccess(task, run, stdout, worktreeInfo)
    } else {
      finishFailed(task, run, `Hermes 程序結束代碼非 0（exit code ${code}）：\n${stderr.slice(-2000)}`, worktreeInfo)
    }
  })
}

function extractWorktreeInfo(stdout) {
  // Hermes -w 模式在輸出中會提及所建立的 worktree 路徑與分支名稱；
  // 若未來 Hermes 版本改變輸出格式，此處抓不到時回傳空物件，不影響主流程。
  const pathMatch = stdout.match(/worktree[:\s]+([^\s\n]+)/i)
  const branchMatch = stdout.match(/branch[:\s]+([^\s\n]+)/i)
  return {
    worktreePath: pathMatch?.[1],
    worktreeBranch: branchMatch?.[1],
  }
}

function pushWorktreeBranch(worktreeInfo) {
  if (!worktreeInfo.worktreePath || !worktreeInfo.worktreeBranch) {
    return { pushed: false, reason: '未偵測到 worktree 路徑或分支名稱，略過 push' }
  }
  const result = spawnSync('git', ['push', '-u', 'origin', worktreeInfo.worktreeBranch], {
    cwd: worktreeInfo.worktreePath,
    encoding: 'utf-8',
  })
  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr || `git push 結束代碼 ${result.status}`
    return { pushed: false, reason }
  }
  return { pushed: true }
}
```

- [x] **Step 2: 修改 `finishSuccess`/`finishFailed` 接受 worktree 資訊**

第 98-108 行整段改為：

```js
function finishSuccess(task, run, output, worktreeInfo = {}) {
  let error
  if (worktreeInfo.worktreePath && worktreeInfo.worktreeBranch) {
    const pushResult = pushWorktreeBranch(worktreeInfo)
    if (!pushResult.pushed) {
      error = `Hermes 執行成功，但 worktree 分支 push 失敗：${pushResult.reason}`
    }
  }
  updateAutomationRun(run.id, { status: 'done', output, error, ...worktreeInfo })
  updateTask(task.id, { automationStatus: 'done', columnId: 'review' })
  onSlotFreed()
}

function finishFailed(task, run, reason, worktreeInfo = {}) {
  updateAutomationRun(run.id, { status: 'failed', error: reason, ...worktreeInfo })
  updateTask(task.id, { automationStatus: 'failed' })
  onSlotFreed()
}
```

注意：`triggerAutomation` 函式內（第 124-142 行）呼叫 `finishFailed(task, run, ...)` 的兩處（`targetPath` 不存在的分支，第 126-131 行的 `updateAutomationRun` 是直接呼叫，非透過 `finishFailed`）維持原樣不用改，因為那個分支從未 spawn 過程序，沒有 worktree 資訊可言。

- [x] **Step 3: 驗證 `extractWorktreeInfo` 與 `pushWorktreeBranch` 的邏輯（無需真的 spawn hermes）**

```bash
node -e "
const stdout = 'Some output\nworktree: /tmp/foo-worktree\nbranch: task/abc123\nmore text'
const pathMatch = stdout.match(/worktree[:\s]+([^\s\n]+)/i)
const branchMatch = stdout.match(/branch[:\s]+([^\s\n]+)/i)
console.log({ path: pathMatch?.[1], branch: branchMatch?.[1] })
"
```

Expected: `{ path: '/tmp/foo-worktree', branch: 'task/abc123' }`。這只驗證正規表達式邏輯本身；真實 `hermes -w` 的輸出格式需在 Task 6 的端對端驗證階段用實際 spawn 結果核對，若格式不符，屆時調整此正規表達式（不阻塞本 Task 的其餘部分）。

再驗證 `pushWorktreeBranch` 在「無 remote」情境下確實回傳 `pushed: false` 而不拋出例外：

```bash
mkdir -p /tmp/push-test-repo && cd /tmp/push-test-repo && git init -q && git checkout -q -b test-branch
node -e "
import('/home/ubuntu/AI-Task-Board/server/automationRunner.mjs').then(async () => {
  // 直接用 child_process 驗證邏輯本身（不 import 內部未導出函式，改用等價指令模擬）
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync('git', ['push', '-u', 'origin', 'test-branch'], { cwd: '/tmp/push-test-repo', encoding: 'utf-8' })
  console.log('status:', result.status, 'stderr:', result.stderr?.slice(0, 100))
})
"
rm -rf /tmp/push-test-repo
```

Expected: `status` 非 `0`（因為沒有設定 `origin` remote），`stderr` 含類似 `'origin' does not appear to be a git repository` 的訊息，證實失敗會被 `pushWorktreeBranch` 正確捕捉為 `pushed: false` 而不是讓整個 `finishSuccess` 拋出例外。

- [x] **Step 4: 驗證失敗路徑（不會真的 spawn hermes，安全）**

```bash
node -e "
import('./server/automationRunner.mjs').then(m => {
  m.triggerAutomation({ id: 'test-1', targetPath: '/nonexistent/path', automationStatus: 'idle', title: 'x', priority: 'low', description: '' })
  console.log('triggered invalid targetPath, check automation_runs table for the failure record')
})
"
sqlite3 .data/taskboard.sqlite "SELECT status, error FROM automation_runs WHERE task_id = 'test-1'"
sqlite3 .data/taskboard.sqlite "DELETE FROM automation_runs WHERE task_id = 'test-1'"
```

Expected: `status = 'failed'`，`error` 含 `targetPath「/nonexistent/path」不存在或未設定`。清除測試資料。

- [x] **Step 5: 驗證與提交**

```bash
npx tsc -b
npm run lint
git add server/automationRunner.mjs
git -c user.name="josh" -c user.email="shihjosh@users.noreply.github.com" commit -m "feat: spawn Hermes with -w worktree isolation, optional -s skill, and live output streaming"
```

---

## Task 4：`server/index.mjs` 白名單更新 + `CREATABLE_FIELDS` ✅ 完成（commit 757b93c，controller-verified，review clean）

**Files:**
- Modify: `server/index.mjs`

**Interfaces:**
- Consumes：Task 1 的 `Task.automationSkill`
- Produces：POST/PATCH `/api/tasks` 現在會接受並持久化 `automationSkill` 欄位

- [x] **Step 1: 在 `CREATABLE_FIELDS` 加入 `automationSkill`**

第 15-28 行的 `CREATABLE_FIELDS` 陣列，在 `'automationStatus',` 之後加入一行：

```js
  'automationSkill',
```

- [x] **Step 2: curl 驗證欄位可寫入並回傳**

```bash
node server/index.mjs &
sleep 1
curl -s -X POST http://localhost:3001/api/tasks -H 'Content-Type: application/json' -d '{"title":"skill-field-test","priority":"low","columnId":"todo","automationSkill":"ai-task-board-ops"}'
kill %1
```

Expected: 回傳的 `task` 物件中 `automationSkill` 為 `"ai-task-board-ops"`。手動用 `curl -X DELETE http://localhost:3001/api/tasks/<回傳的id>` 清除測試資料（需先重新啟動 server 才能再次呼叫 API）。

- [x] **Step 3: 驗證與提交**

```bash
npx tsc -b
npm run lint
git add server/index.mjs
git -c user.name="josh" -c user.email="shihjosh@users.noreply.github.com" commit -m "feat: whitelist automationSkill field in task create/update API"
```

---

## Task 5：前端 —— Skill 選單 API client + TaskDrawer 整合 + AutomationRunList 輪詢 ✅ 完成（commit 757b93c..266a122，review clean）

**Files:**
- Create: `src/lib/skillsApi.ts`
- Modify: `src/components/TaskDrawer.tsx`
- Modify: `src/components/AutomationRunList.tsx`

**Interfaces:**
- Consumes：`GET /api/skills`（Task 2）、`Task.automationSkill`（Task 1）、`AutomationRun.skill/worktreePath/worktreeBranch`（Task 1）
- Produces：`fetchAvailableSkills(): Promise<string[]>`（供 `TaskDrawer` 使用）

- [x] **Step 1: 建立 `src/lib/skillsApi.ts`**

```ts
async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  return res.json()
}

export async function fetchAvailableSkills(): Promise<string[]> {
  const res = await fetch('/api/skills')
  const data = await handle<{ skills: string[] }>(res)
  return data.skills
}
```

- [x] **Step 2: 修改 `TaskDrawer.tsx` —— 加入 skill 下拉選單**

`emptyFormState`（第 19-29 行）加入一行：`automationSkill: '' as string,`

新增 state（第 32-36 行 state 宣告之後）：

```ts
  const [availableSkills, setAvailableSkills] = useState<string[]>([])
```

在既有的 `useEffect`（第 38-58 行）之後，新增一個獨立的 `useEffect` 只在元件掛載時抓一次技能清單（不依賴 `isOpen`，因為清單不會頻繁變動，避免每次開關 drawer 都重新打 API）：

```ts
  useEffect(() => {
    fetchAvailableSkills().then(setAvailableSkills).catch(() => setAvailableSkills([]))
  }, [])
```

第 38-58 行既有 `useEffect` 內，`setForm({...})` 物件（第 41-51 行）加入一行：`automationSkill: initialTask.automationSkill ?? '',`

`buildPayload`（第 80-99 行）回傳物件加入一行：`automationSkill: form.automationSkill || undefined,`

在「自動執行目錄」欄位的 `<label>` 區塊（第 256-275 行）之後，新增一個新的 `<label>` 區塊：

```tsx
        <label className="mb-6 block text-sm">
          <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">
            自動執行使用的 Skill（選填，未選則由 Hermes 自行判斷）
          </span>
          <select
            value={form.automationSkill}
            onChange={(e) => setForm((p) => ({ ...p, automationSkill: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
          >
            <option value="">（不指定）</option>
            {availableSkills.map((skill) => (
              <option key={skill} value={skill}>
                {skill}
              </option>
            ))}
          </select>
        </label>
```

需要在檔案頂部 import 區塊加入：`import { fetchAvailableSkills } from '../lib/skillsApi'`

- [x] **Step 3: 修改 `AutomationRunList.tsx` —— 對 running 狀態輪詢**

在既有的 `useEffect`（第 26-29 行）之後，新增一個獨立的輪詢 `useEffect`：

```ts
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running')
    if (!hasRunning) return
    const interval = setInterval(load, 2000)
    return () => clearInterval(interval)
  }, [runs])
```

在 `<li>` 區塊（第 57-76 行）的時間戳 `<span>`（第 63-66 行）之後，新增顯示 skill/worktree 資訊：

```tsx
            {(run.skill || run.worktreeBranch) && (
              <p className="mb-1 text-xs text-slate-400 dark:text-slate-500">
                {run.skill && `skill: ${run.skill}`}
                {run.skill && run.worktreeBranch && ' · '}
                {run.worktreeBranch && `worktree branch: ${run.worktreeBranch}`}
              </p>
            )}
```

- [x] **Step 4: 驗證與提交**

```bash
npx tsc -b
npm run lint
git add src/lib/skillsApi.ts src/components/TaskDrawer.tsx src/components/AutomationRunList.tsx
git -c user.name="josh" -c user.email="shihjosh@users.noreply.github.com" commit -m "feat: add skill picker in TaskDrawer and live polling in AutomationRunList"
```

Expected: `tsc -b` 通過（`Task.automationSkill`/`AutomationRun.skill` 等新欄位皆為 optional，不會破壞既有呼叫端的型別檢查）。

---

## Task 6：端對端驗證 + README 更新

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes：Task 1-5 全部（本 Task 純驗證與文件，不新增程式碼介面）

- [ ] **Step 1: 瀏覽器實機驗證 —— skill 下拉選單**

啟動 `npm run dev`，`browser_navigate` 開啟看板，開啟任一任務的 `TaskDrawer`，確認：
1. 「自動執行使用的 Skill」下拉選單有選項（至少包含 `ai-task-board-ops`）
2. 選一個 skill、填入合法的 `targetPath`、儲存後重新打開該任務，確認選單記住剛剛選的 skill

- [ ] **Step 2: 端對端驗證 —— 真實 spawn（需要使用者明確同意，比照既有 Testing code that spawns the Hermes CLI 慣例）**

用 `clarify` 詢問使用者是否同意讓這次驗證真的 spawn 一個 `hermes chat -q ... -w --cli` 子程序（會在指定的 `targetPath` 建立一個真實的 git worktree）。取得同意後：

1. 建立一個測試任務，`targetPath` 指向一個乾淨的小型 git repo（例如 `/tmp/e2e-test-repo`，先 `git init` 一個空 repo，並用 `git remote add origin <一個你有寫入權限的測試用 GitHub repo URL>` 設定好 remote，才能驗證 push 這一步；若手邊沒有可用的測試 remote，可以額外驗證「無 remote」情境，確認流程不會因 push 失敗而卡住或誤標記 `automationStatus: failed`）
2. 描述填入簡單指令，例如「在這個 repo 建立一個 README.md 檔案，內容是 'hello from automation test'」
3. 把該任務拖到「處理中」欄位（觸發 `triggerAutomation`）
4. 每幾秒 `GET /api/tasks` 輪詢 `automationStatus`，直到離開 `running`
5. 確認 `GET /api/tasks/:taskId/automation-runs` 回傳的紀錄裡 `output` 欄位在執行過程中有隨時間增長（可在執行中途多次呼叫確認非空且逐次變長，驗證即時串流真的有效，而非等到結束才一次性寫入）
6. 執行完成後，確認 `/tmp/e2e-test-repo` 底下多出一個 git worktree 目錄，且該目錄有獨立分支、包含新建立的 `README.md`
7. 用 `git worktree list`（於 `/tmp/e2e-test-repo` 內執行）確認 worktree 確實被登記
8. 若設定了可寫入的測試 remote：確認該分支已出現在 remote 上（`git ls-remote origin <分支名稱>` 有輸出），且 `automationStatus` 為 `done`、`automation_runs.error` 為空。若刻意用「無 remote」情境測試：確認 `automationStatus` 仍為 `done`，但 `automation_runs.error` 含「push 失敗」相關訊息
9. 清理：`git worktree remove <路徑> --force` 移除測試 worktree，若有推送到測試 remote 也記得刪除該分支，刪除 `/tmp/e2e-test-repo`，並用 `DELETE /api/tasks/:id` 刪除測試任務與其自動化紀錄

- [ ] **Step 3: 更新 README**

在「Hermes Agent 自動化執行（Phase 4）」章節（約第 76-90 行）中：
1. 在「每次自動執行的完整過程...」那一行之後補充：即時輸出現在會邊執行邊寫入，TaskDrawer 執行紀錄頁籤對執行中的紀錄每 2 秒自動刷新一次
2. 在「已知限制」那一行之前新增一段，說明現在改用 `hermes chat -q ... -w --cli [-s <skill>]`：`-w` 讓每次執行在該 repo 下建立獨立 git worktree + 分支，不會污染原始工作目錄；執行成功後會自動 `git push` 該分支到 origin（**不會自動開 PR**），由使用者自行決定何時在 GitHub 網頁開 PR、merge；若目標 repo 沒有設定 remote 或 push 失敗，`automationStatus` 仍為 `done`（agent 執行本身成功），但執行紀錄的 `error` 欄位會記錄 push 失敗原因，需要使用者自行手動 push
3. 補充：每張任務卡可選填「自動執行使用的 Skill」，對應 `-s` 參數；下拉選單選項來自後端掃描 `~/.hermes/skills` 目錄，未選則由 Hermes agent 自行判斷要用哪個 skill（與 Phase 4 原始行為一致）

- [ ] **Step 4: 最終提交**

```bash
npx tsc -b
npm run lint
git add README.md
git -c user.name="josh" -c user.email="shihjosh@users.noreply.github.com" commit -m "docs: update README for worktree isolation, skill picker, and live output streaming"
```
