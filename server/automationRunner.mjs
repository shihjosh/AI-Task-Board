import { spawn, spawnSync } from 'node:child_process'
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
