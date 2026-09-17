import fs from 'node:fs'
import { spawn as _spawn } from 'node:child_process'
import { updateTask } from './taskRepository.mjs'
import {
  createAutomationRun as _createAutomationRun,
  updateAutomationRun,
  appendAutomationRunOutput,
} from './automationRunRepository.mjs'

// 測試專用：讓測試能注入一個會拋錯的 createAutomationRun 替身，以確定性地模擬
// DB 寫入失敗（例如驗證 triggerAutomation 佇列分支的 try/catch 復原邏輯），
// 不需要依賴真實的 DB 層錯誤注入點（server/db/index.mjs 未暴露測試專用的失敗
// 模擬介面）。傳入 null/undefined 會還原成真正的實作。
let createAutomationRun = _createAutomationRun

export function __setCreateAutomationRunForTest(fn) {
  createAutomationRun = fn ?? _createAutomationRun
}

// 測試專用：讓測試能注入一個假的 spawn 實作，取代 node:child_process 的真實
// spawn，確定性地模擬 child process 的 exit/error 事件，不需要依賴真的
// hermes CLI 是否存在於 PATH 上，也不會有任何機會啟動真實的子程序、建立
// worktree。傳入 null/undefined 會還原成真正的實作。
let spawn = _spawn

export function __setSpawnForTest(fn) {
  spawn = fn ?? _spawn
}

const MAX_CONCURRENT = 1
const TIMEOUT_MS = 15 * 60 * 1000 // 15 分鐘

// 本機開發模式（npm run dev / npm start）：不設定 AUTOMATION_URL，
// automationRunner 自己 spawn('hermes', ...)，行為與 docker 化之前完全相同。
// Docker compose 模式：docker-compose.yml 的 taskboard service 會設定
// AUTOMATION_URL（指向 automation service），改成打 HTTP 給它，由它負責
// spawn hermes（詳見 automation/server.mjs）。
const AUTOMATION_URL = process.env.AUTOMATION_URL

let runningCount = 0
const queue = []

export function getQueueDepth() {
  return queue.length
}

// 測試專用：直接覆寫模組級 runningCount，讓測試能確定性地模擬「已有任務在跑」
// 的併發狀態，不需要依賴真實 async 時序（setImmediate race）。Task 4 的測試
// 也會用到同樣機制模擬併發，請勿改名或移除。
export function __setRunningCountForTest(n) {
  runningCount = n
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

function priorityRank(task) {
  return PRIORITY_ORDER[task.priority] ?? PRIORITY_ORDER.low
}

function buildPrompt(task) {
  const description = task.description?.trim() ? task.description : '（無描述）'
  const port = process.env.PORT ?? 3001
  const taskboardUrl = process.env.TASKBOARD_URL ?? `http://localhost:${port}`
  return [
    `任務標題：${task.title}`,
    '',
    '任務描述：',
    description,
    '',
    '請根據上述標題與描述實際動手執行任務（修改程式碼、執行指令等），完成後清楚說明做了哪些變更；',
    '若無法完成或被阻塞，請明確說明原因與卡住的地方。',
    '',
    '你目前在一個由 --worktree 建立的隔離 git worktree 中工作，此 worktree 會在你的 session 結束時被自動清除。',
    '因此，在你完成任務並 commit 變更之後、結束整個對話之前，請務必執行以下指令把你所在的分支推送到 origin',
    '（若該 repo 沒有設定 origin remote 或 push 失敗，請在最終回覆中明確說明失敗原因，不需要因此視為任務失敗）：',
    '',
    '  git push -u origin $(git branch --show-current)',
    '',
    '若上述任務描述包含明確的執行步驟（例如「Step 1」「Step 2」等清單），請在完成每一個步驟後，',
    '立即執行以下指令回報進度（將 <百分比整數> 換成實際數字，例如完成 2 個 step、共 5 個 step，則填 40）：',
    '',
    `curl -s -X PATCH ${taskboardUrl}/api/tasks/${task.id} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"progress": <百分比整數>}'`,
    '',
    '若描述中沒有明確的步驟清單，則不需要回報進度。',
  ].join('\n')
}

// 本機開發模式：直接 spawn('hermes', ...)，回傳格式與 HTTP 模式的
// automation/server.mjs 回應一致（{ exitCode, stdout, stderr, timedOut }），
// 讓下方 runOne() 的後續處理邏輯不需要區分兩種模式。
function runViaSpawn({ prompt, cwd, skill }) {
  return new Promise((resolve) => {
    const args = ['chat', '-q', prompt, '-w', '--cli']
    if (skill) {
      args.push('-s', skill)
    }

    let child
    try {
      child = spawn('hermes', args, { cwd, detached: true })
    } catch (err) {
      resolve({ exitCode: null, stdout: '', stderr: `無法啟動 Hermes 程序：${err.message}`, timedOut: false })
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
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n無法啟動 Hermes 程序：${err.message}`, timedOut })
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, stdout, stderr, timedOut })
    })
  })
}

// Docker compose 模式：打 HTTP 給 automation service，由它負責 spawn hermes。
async function runViaHttp({ prompt, cwd, skill }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS + 5000)
  try {
    const response = await fetch(`${AUTOMATION_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, cwd, skill }),
      signal: controller.signal,
    })
    if (!response.ok) {
      return { exitCode: null, stdout: '', stderr: `automation service 回應非 2xx（HTTP ${response.status}）`, timedOut: false }
    }
    return await response.json()
  } catch (err) {
    return { exitCode: null, stdout: '', stderr: `無法連線 automation service：${err.message}`, timedOut: false }
  } finally {
    clearTimeout(timer)
  }
}

// existingRun：queue-drain 路徑（onSlotFreed()）會傳入 Task 3 在佇列進場時
// 已建立的 'queued' automation_runs 記錄，這裡只需把它轉成 'running'，不用
// 再 createAutomationRun 一次。未排隊、立即執行的路徑不傳這個參數，維持
// 原本的 createAutomationRun 行為。
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
    // 無論上面哪一步拋出例外（updateTask/createAutomationRun/finishSuccess/
    // finishFailed 任一步的 DB 寫入失敗），都保證釋放這個併發 slot，否則
    // runningCount 會永久卡在偏高的值，導致佇列後續任務永遠排不到。
    onSlotFreed()
  }
}

function extractWorktreeInfo(stdout) {
  // Hermes -w 模式在輸出開頭會印出建立的 worktree 路徑與分支名稱，格式例如：
  //   ✓ Worktree created: /path/to/repo/.worktrees/hermes-xxxxx
  //     Branch: hermes/hermes-xxxxx
  // 注意：該 worktree 會在 Hermes session 結束時被自動清除，此處記錄的資訊僅供
  // automation_runs 顯示參考，不代表 worktree 目錄在程序結束後仍然存在——
  // 因此後端不會、也不能對此路徑執行任何 git 操作（例如 push），push 已改為
  // 在 buildPrompt() 裡指示 Hermes agent 自己在 session 結束前於 worktree 內完成。
  const pathMatch = stdout.match(/Worktree created:\s*([^\s\n]+)/i)
  const branchMatch = stdout.match(/Branch:\s*([^\s\n]+)/i)
  return {
    worktreePath: pathMatch?.[1],
    worktreeBranch: branchMatch?.[1],
  }
}

// 注意：不在這裡呼叫 onSlotFreed()——runOne() 的 finally 區塊已經統一負責
// 釋放 slot，這裡再呼叫會造成 runningCount 重複遞減。
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

  // Task 3 起，queue 元素是 { task, run } 而不是裸 task——run 是佇列進場時
  // 就已經建立好的 'queued' automation_runs 記錄，priorityRank 需要讀
  // queue[i].task，runOne() 需要拿到對應的 run 一起傳入。
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

export async function triggerAutomation(task) {
  // 本機開發模式（無 AUTOMATION_URL）：taskboard 自己直接看得到宿主機檔案系統，
  // 可以檢查路徑是否存在。Docker compose 模式：taskboard container 沒有掛載
  // 專案目錄，這個檢查交給看得到的 automation service 在 /run handler 內做。
  const pathMissing = !task.targetPath || (!AUTOMATION_URL && !fs.existsSync(task.targetPath))
  if (pathMissing) {
    const run = await createAutomationRun(task.id, { prompt: buildPrompt(task) })
    await updateAutomationRun(run.id, {
      status: 'failed',
      error: `targetPath「${task.targetPath}」不存在或未設定`,
    })
    await updateTask(task.id, { automationStatus: 'failed' })
    return
  }
  if (task.automationStatus === 'running') {
    return
  }
  if (runningCount >= MAX_CONCURRENT) {
    await updateTask(task.id, { automationStatus: 'queued' })
    try {
      const run = await createAutomationRun(task.id, {
        prompt: buildPrompt(task),
        skill: task.automationSkill?.trim() || undefined,
        status: 'queued',
      })
      queue.push({ task, run })
    } catch (err) {
      // createAutomationRun 失敗（例如 DB 寫入錯誤）時，task 已經被標記為
      // 'queued' 但沒有對應的 automation_runs 紀錄、也沒有被 push 進 queue，
      // 會永遠卡在 'queued' 狀態、UI 無法復原。這裡把它復原成 'idle'（佇列
      // 進場失敗，不是執行失敗，語意上比 'failed' 更貼切：使用者可以重新
      // 觸發自動化），並把錯誤往外拋，讓呼叫端既有的
      // `.catch(err => console.error(...))`（server/app.mjs）繼續記錄。
      await updateTask(task.id, { automationStatus: 'idle' }).catch((recoverErr) => {
        console.error('failed to recover task automationStatus after queue-push failure:', recoverErr)
      })
      throw err
    }
    return
  }
  await runOne(task)
}

// —— 測試專用輔助函式 ——
// 僅供 test/automationRunner.queue.test.mjs 使用，模擬併發狀態與手動觸發
// 佇列處理，避免測試依賴真實的 hermes CLI 執行或不穩定的計時器時序。
export function __drainQueueForTest() {
  onSlotFreed()
}

// 測試專用：直接清空模組級 queue 陣列，不觸發 runOne()。用於測試的 finally
// 區塊收尾，避免某個測試 push 進 queue 的任務（例如被
// triggerAutomation(...) 排入佇列、但測試本身不需要真的把它 drain 完）
// 殘留到下一個測試，被之後某次 __drainQueueForTest() 意外挑中並執行
// runOne()（跑到已經被 deleteTask() 刪除的 task/run，導致誤導性的錯誤
// log，甚至排擠掉當次測試真正要 drain 的任務）。
export function __clearQueueForTest() {
  queue.length = 0
}

