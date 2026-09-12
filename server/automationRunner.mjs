import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { updateTask } from './taskRepository.mjs'
import { createAutomationRun, updateAutomationRun, appendAutomationRunOutput } from './automationRunRepository.mjs'

const MAX_CONCURRENT = 1
const TIMEOUT_MS = 15 * 60 * 1000 // 15 分鐘

let runningCount = 0
const queue = []

export function getQueueDepth() {
  return queue.length
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

function priorityRank(task) {
  return PRIORITY_ORDER[task.priority] ?? PRIORITY_ORDER.low
}

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
    '你目前在一個由 --worktree 建立的隔離 git worktree 中工作，此 worktree 會在你的 session 結束時被自動清除。',
    '因此，在你完成任務並 commit 變更之後、結束整個對話之前，請務必執行以下指令把你所在的分支推送到 origin',
    '（若該 repo 沒有設定 origin remote 或 push 失敗，請在最終回覆中明確說明失敗原因，不需要因此視為任務失敗）：',
    '',
    '  git push -u origin $(git branch --show-current)',
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

function finishSuccess(task, run, output, worktreeInfo = {}) {
  updateAutomationRun(run.id, { status: 'done', output, ...worktreeInfo })
  updateTask(task.id, { automationStatus: 'done', columnId: 'review' })
  onSlotFreed()
}

function finishFailed(task, run, reason, worktreeInfo = {}) {
  updateAutomationRun(run.id, { status: 'failed', error: reason, ...worktreeInfo })
  updateTask(task.id, { automationStatus: 'failed' })
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
  runOne(next)
}

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
  if (task.automationStatus === 'running') {
    return
  }
  if (runningCount >= MAX_CONCURRENT) {
    queue.push(task)
    return
  }
  runOne(task)
}
