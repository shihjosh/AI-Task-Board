# Hermes Agent Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a task card's `columnId` transitions into `in_progress` and the card has a `targetPath`, spawn a background `hermes chat -q` process in that directory to actually execute the task, then report the result as a comment and move the card to `review` (or flag it as failed) — without blocking the PATCH request.

**Architecture:** The Express PATCH handler detects the `columnId` transition (`!== 'in_progress' → 'in_progress'`) and delegates to a new `server/automationRunner.mjs` module. That module validates `targetPath`, enforces a small in-process concurrency queue (max 2 concurrent runs), spawns `hermes chat -q "<prompt>"` as a detached child process with `cwd: targetPath`, and on exit writes a comment (`createComment`) plus updates the task's `automationStatus` / `columnId` via the existing `taskRepository.mjs` functions. The frontend gains a `targetPath` field in `TaskDrawer` and a running-state visual indicator on `TaskCard`.

**Tech Stack:** Node.js `child_process.spawn` (no new npm dependency), Express, better-sqlite3 (existing), React/TypeScript (existing). No test framework exists in this repo — verification is via `curl` against the running dev server and manual browser checks, per this repo's established convention (see `ai-task-board-ops` skill notes on Phase 3's body-size-limit and progress-validation findings).

## Global Constraints

- No new npm dependencies (spawns the `hermes` CLI already installed on the host — same "zero unnecessary dependency" bar this repo has held since Phase 1).
- Single-container Docker model is unaffected by this phase — the `hermes` CLI runs on the **host**, not inside the app's Docker container (documented as an explicit open item to revisit before this ships to the Dockerized deployment; this plan targets local/dev execution only, per spec's "spec only" framing before container packaging is decided).
- All new user-facing strings are Traditional Chinese, matching the rest of the UI.
- Every DB column addition MUST be migration-guarded (`PRAGMA table_info` check) exactly like the existing `description` column migration in `server/db.mjs` — this repo has real seeded `.data/taskboard.sqlite` files that predate this phase.
- Follow the existing repo pattern: `express.json({ limit: '1mb' })` and the 413/500 error-middleware split already in `server/index.mjs` must not be bypassed by any new route.

## Decisions locked in for this plan (resolving the spec's Open Questions)

The spec (`docs/superpowers/specs/2026-09-08-hermes-agent-automation-design.md`) intentionally left 6 questions open for the implementation to resolve. This plan makes explicit, concrete choices for all of them so no task contains a placeholder:

1. **Failure/blocked handling:** non-zero exit code or timeout → task stays in `in_progress`, `automationStatus` becomes `failed`, and a comment is written with the error detail (stderr tail + exit code). It is NOT auto-moved to `review`.
2. **Re-trigger on repeat drag:** allowed only when `automationStatus` is `idle`, `done`, or `failed` — never when it is already `running`. A repeat drag while `running` is silently ignored (no duplicate spawn, no error surfaced).
3. **UI "running" indicator:** `TaskCard` shows a small pulsing dot + "Hermes 執行中" label next to the title when `task.automationStatus === 'running'`.
4. **`targetPath` validation:** must be a non-empty string AND `fs.existsSync(targetPath)` must be true, checked at trigger time (not at card-save time, since the directory may not exist yet when the card is created). An invalid path fails immediately (`automationStatus: 'failed'`, comment explaining why) without spawning a process.
5. **Concurrency limit:** max 2 concurrent Hermes processes system-wide, tracked by a module-level counter in `automationRunner.mjs`. A trigger arriving at capacity is queued in-memory (FIFO) and started when a slot frees. The queue is **not persisted** — a server restart drops any queued (not yet started) automation runs; this is called out explicitly in the README update (Task 6) as a known limitation.
6. **Timeout:** 15 minutes (`900_000` ms) wall-clock per run, enforced with `child.kill('SIGTERM')`; a timed-out run is treated identically to a non-zero exit (failed path, rule 1).

## Global data model addition

```sql
ALTER TABLE tasks ADD COLUMN target_path TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN automation_status TEXT NOT NULL DEFAULT 'idle';
```

`automation_status` values: `'idle' | 'running' | 'done' | 'failed'`.

---

### Task 1: DB migration + repository fields for `targetPath` / `automationStatus`

**Files:**
- Modify: `server/db.mjs:35-40` (add two migration-guarded `ALTER TABLE` blocks after the existing `description` migration)
- Modify: `server/taskRepository.mjs` (`rowToTask`, `createTask`, `updateTask`)
- Modify: `src/types/task.ts` (add `targetPath` and `automationStatus` to the `Task` interface)

**Interfaces:**
- Produces: `Task.targetPath: string` (always present, default `''`), `Task.automationStatus: 'idle' | 'running' | 'done' | 'failed'` (always present, default `'idle'`) — every later task reads/writes these exact field names.

- [ ] **Step 1: Add the migration to `server/db.mjs`**

Add immediately after the existing `description` migration block (after line 40, before the `comments` table creation):

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

- [ ] **Step 2: Verify migration against a fresh DB**

```bash
rm -f .data/taskboard.sqlite .data/taskboard.sqlite-wal .data/taskboard.sqlite-shm
node -e "import('./server/db.mjs').then(m => { m.getDb(); console.log('ok') })"
sqlite3 .data/taskboard.sqlite "PRAGMA table_info(tasks)"
```

Expected: `target_path` and `automation_status` columns appear in the `PRAGMA table_info` output with the correct defaults, and `node` prints `ok` with no errors.

- [ ] **Step 3: Verify migration against the existing seeded DB (no data loss)**

```bash
cp .data/taskboard.sqlite /tmp/taskboard.sqlite.pre-migration.bak
sqlite3 .data/taskboard.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 .data/taskboard.sqlite "SELECT COUNT(*) FROM tasks;"
node -e "import('./server/db.mjs').then(m => { m.getDb(); console.log('ok') })"
sqlite3 .data/taskboard.sqlite "SELECT COUNT(*) FROM tasks;"
sqlite3 .data/taskboard.sqlite "PRAGMA table_info(tasks)"
```

Expected: row count identical before/after, new columns present with default values on all pre-existing rows.

- [ ] **Step 4: Update `server/taskRepository.mjs`**

In `rowToTask`, add after `columnId: row.column_id,`:

```js
    targetPath: row.target_path,
    automationStatus: row.automation_status,
```

In `createTask`'s SQL (`INSERT INTO tasks (...)`), add `target_path, automation_status` to the column list and `@targetPath, @automationStatus` to the `VALUES` list, and in the params object passed to `.run(...)` add:

```js
    targetPath: input.targetPath ?? '',
    automationStatus: input.automationStatus ?? 'idle',
```

In `updateTask`'s `merged` object, add:

```js
    targetPath: patch.targetPath ?? existing.target_path,
    automationStatus: patch.automationStatus ?? existing.automation_status,
```

and add `target_path=@targetPath, automation_status=@automationStatus,` to the `UPDATE tasks SET ...` SQL string.

- [ ] **Step 5: Update `src/types/task.ts`**

In the `Task` interface, add after `columnId: ColumnId`:

```ts
  targetPath: string // Hermes agent 執行任務時的工作目錄（絕對路徑），空字串代表此卡不可自動執行
  automationStatus: 'idle' | 'running' | 'done' | 'failed'
```

- [ ] **Step 6: Add `targetPath` and `automationStatus` to `CREATABLE_FIELDS` in `server/index.mjs`**

In the `CREATABLE_FIELDS` array (`server/index.mjs:13-23`), add `'targetPath'` and `'automationStatus'` so the PATCH/POST handlers pass them through via `pickFields`.

- [ ] **Step 7: Manual verification via curl**

```bash
npm run dev:server &
sleep 1
curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"migration test","priority":"low","columnId":"todo","targetPath":"/tmp"}' | python3 -m json.tool
```

Expected: response JSON includes `"targetPath": "/tmp"` and `"automationStatus": "idle"`. Delete the test task afterward with `curl -X DELETE http://localhost:3001/api/tasks/<id>`.

- [ ] **Step 8: Commit**

```bash
git add server/db.mjs server/taskRepository.mjs server/index.mjs src/types/task.ts
git commit -m "feat: add target_path and automation_status columns to tasks"
```

---

### Task 2: `automationRunner.mjs` — spawn, timeout, concurrency queue

**Files:**
- Create: `server/automationRunner.mjs`
- Consumes: `updateTask(id, patch)` and `createComment(taskId, content)` from `server/taskRepository.mjs` / `server/commentRepository.mjs` (Task 1's fields already merged)

**Interfaces:**
- Produces: `export function triggerAutomation(task)` — `task` is a full `Task` object (post-update, already has `columnId === 'in_progress'`). Returns nothing (fire-and-forget); all side effects happen via `updateTask`/`createComment`. This is the exact function name `server/index.mjs` (Task 3) imports and calls.
- Produces: `export function getQueueDepth()` — returns the current in-memory queue length, used only for the curl-based verification below (not required by the UI).

- [ ] **Step 1: Write `server/automationRunner.mjs`**

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

- [ ] **Step 2: Manual verification — success path**

Create a `/tmp/automation-test` directory with a trivial file, then trigger via a temporary Node script (this module has no HTTP route yet, so it's called directly for isolated verification):

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

Expected: no thrown errors; a `hermes` child process starts (visible in `ps aux | grep hermes` during the 5s window).

- [ ] **Step 3: Manual verification — invalid targetPath fails immediately**

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

Expected: printed comment array contains one comment starting with `❌ 無法啟動 Hermes 自動執行`, and no `hermes` child process was spawned.

- [ ] **Step 4: Commit**

```bash
git add server/automationRunner.mjs
git commit -m "feat: add automationRunner with spawn, timeout, and concurrency queue"
```

---

### Task 3: Wire the trigger into `PATCH /api/tasks/:id`

**Files:**
- Modify: `server/index.mjs:83-91` (the existing `app.patch('/api/tasks/:id', ...)` handler)

**Interfaces:**
- Consumes: `triggerAutomation(task)` from Task 2's `server/automationRunner.mjs`.

- [ ] **Step 1: Capture the pre-update `columnId` and call `triggerAutomation` after the update**

Replace the existing handler body:

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

Add the import at the top of the file (with the other repository imports):

```js
import { triggerAutomation } from './automationRunner.mjs'
```

Note: `res.json({ task })` is sent **before** calling `triggerAutomation` — this is what satisfies the spec's "觸發後應立即回應 PATCH 請求" requirement; `triggerAutomation` itself is synchronous-looking but only spawns and returns, it does not await process completion.

- [ ] **Step 2: Manual verification — dragging into in_progress triggers automation**

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

Expected: the PATCH response returns immediately with the task showing `columnId: in_progress` (not yet `review`); a follow-up GET a moment later shows `automationStatus: running` (or already `done`/`failed` if the Hermes call finished fast). Clean up with `curl -X DELETE http://localhost:3001/api/tasks/$TASK_ID`.

- [ ] **Step 3: Manual verification — re-trigger guard**

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

Expected: `automationStatus` stays `running` and no second `hermes` process is spawned (only one entry in `ps aux | grep 'hermes chat'` for this task) — because `triggerAutomation` checks `task.automationStatus === 'running'` and returns early on the second PATCH. Clean up the test task afterward.

- [ ] **Step 4: Commit**

```bash
git add server/index.mjs
git commit -m "feat: trigger Hermes automation on columnId transition to in_progress"
```

---

### Task 4: `targetPath` field in `TaskDrawer`

**Files:**
- Modify: `src/components/TaskDrawer.tsx`

**Interfaces:**
- Consumes: `Task.targetPath` (Task 1), `Task.automationStatus` (Task 1, read-only display).

- [ ] **Step 1: Add `targetPath` to the form state**

In `emptyFormState` (`src/components/TaskDrawer.tsx:18-26`), add:

```ts
  targetPath: '',
```

In the `useEffect` that loads `initialTask` into `form` (around line 36-44), add:

```ts
        targetPath: initialTask.targetPath ?? '',
```

In `buildPayload()` (around line 71-87), add to the returned object:

```ts
      targetPath: form.targetPath.trim(),
```

- [ ] **Step 2: Add the input field to the form JSX**

Insert this block right after the "進度" `<label>` (after line 230, before the description `<div>`):

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

- [ ] **Step 3: Manual verification via browser**

Start `npm run dev`, open the app, click "新增任務", fill in title + a `targetPath` value, save, then reopen the created card and confirm the `targetPath` value round-trips (persisted and pre-filled on edit).

- [ ] **Step 4: Commit**

```bash
git add src/components/TaskDrawer.tsx
git commit -m "feat: add targetPath field to TaskDrawer"
```

---

### Task 5: "Hermes 執行中" indicator on `TaskCard`

**Files:**
- Modify: `src/components/TaskCard.tsx`

**Interfaces:**
- Consumes: `Task.automationStatus` (Task 1).

- [ ] **Step 1: Add the running indicator**

Import `Loader2` from `lucide-react` alongside the existing icon imports (`src/components/TaskCard.tsx:1`):

```tsx
import { MessageSquare, AlertTriangle, GitPullRequest, Code2, CircleDot, Loader2 } from 'lucide-react'
```

Insert this block right after the title `<div>` (after line 54, before the tags `<div>`):

```tsx
      {task.automationStatus === 'running' && (
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-sky-600">
          <Loader2 size={12} className="animate-spin" />
          Hermes 執行中
        </div>
      )}
```

- [ ] **Step 2: Manual verification via browser**

Using the curl commands from Task 3 Step 2, set a task's `automationStatus` to `running` (via `PATCH /api/tasks/:id` with `{"automationStatus":"running"}`), reload the board in the browser, and confirm the card shows the spinning "Hermes 執行中" label. Reset it back afterward (`{"automationStatus":"idle"}`) or delete the test task.

- [ ] **Step 3: Commit**

```bash
git add src/components/TaskCard.tsx
git commit -m "feat: show Hermes 執行中 indicator on TaskCard"
```

---

### Task 6: README sync + final whole-branch review

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-08-hermes-agent-automation.md` (this file — tick all boxes as work completes)

**Interfaces:** None (documentation-only task).

- [ ] **Step 1: Add a section to `README.md` documenting the automation feature**

Add a new section (after the existing feature list) covering: what `targetPath` does, the `automationStatus` state machine (`idle → running → done|failed`), the 15-minute timeout, the 2-process concurrency cap with in-memory (non-persisted) queueing, and the explicit limitation that `hermes` runs on the host, not inside the app's Docker container — so this feature is only usable when running the API server directly on a host that has the `hermes` CLI installed (`npm run dev:server` / `npm start`), not yet wired for the Dockerized deployment path.

- [ ] **Step 2: Final whole-branch review**

Following this repo's established review process (`ai-task-board-ops` skill), perform one whole-branch review before declaring the phase done:
- Boundary-value probe: PATCH a task with `targetPath` pointing at a file (not a directory) — confirm `fs.existsSync` still returns true and document whether `spawn(..., { cwd: <file> })` fails gracefully (it should hit the `child.on('error', ...)` path in `automationRunner.mjs` and produce a failed-comment, not crash the server).
- Confirm the `enteringInProgress` check in Task 3 does NOT fire when a task is *created* directly with `columnId: 'in_progress'` (only PATCH transitions trigger it, per the spec's explicit "非建立時" requirement) — verify via `POST /api/tasks` with `columnId: 'in_progress'` and confirm no `hermes` process spawns and `automationStatus` stays `idle`.
- Grep `src/` for any new `dangerouslySetInnerHTML`/`innerHTML`/`eval` introduced by this phase (should be zero, per the existing XSS-check convention).
- Run `npx tsc -b` (not bare `npx tsc --noEmit` — this repo's solution-style tsconfig silently checks nothing under the bare form) and `npm run lint` (oxlint) and confirm both are clean.
- Clean up every test task/comment created during Tasks 1-6's manual verification steps so the seed data count is unchanged.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-08-hermes-agent-automation.md
git commit -m "docs: sync README with Hermes automation feature, mark plan complete"
```

---

## Not in scope for this plan (per spec's 範圍外 section)

- Slack integration as a trigger source.
- Direct 9Router LLM API calls (this plan spawns the `hermes` CLI, which handles its own model routing).
- Packaging this feature for the Dockerized production deployment (the `hermes` CLI dependency on the host is called out as a known limitation in Task 6, not solved here).
