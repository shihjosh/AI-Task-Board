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
