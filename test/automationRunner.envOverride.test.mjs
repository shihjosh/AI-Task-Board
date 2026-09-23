import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')

// MAX_CONCURRENT / TIMEOUT_MS 是 server/automationRunner.mjs 模組載入時就從
// process.env 算好的常數，同一個 test process 裡動態改 process.env 再 import
// 不會生效（模組已經被 import cache 過）。改用子程序驗證：跑一段小腳本，
// 在 import 之前設好環境變數，讓子程序自己 import 模組並印出結果，藉此驗證
// AUTOMATION_MAX_CONCURRENT / AUTOMATION_TIMEOUT_MS 環境變數確實會覆寫預設值
// （而非只是被忽略、永遠使用寫死的 1 / 15 分鐘）。
function runInSubprocess(env) {
  return new Promise((resolve, reject) => {
    const script = `
      import('${path.join(repoRoot, 'server', 'automationRunner.mjs').replace(/\\/g, '\\\\')}').then(async (mod) => {
        // 併發限制無法直接讀取（模組沒有 export MAX_CONCURRENT），
        // 改用行為驗證：__setRunningCountForTest(N) 模擬已有 N 個任務在跑，
        // 觸發第 N+1 個任務時，若被判定超過併發上限就會進 queue（queue depth +1）。
        const { createTask, deleteTask } = await import('${path.join(repoRoot, 'server', 'taskRepository.mjs').replace(/\\/g, '\\\\')}')
        const runningCountToSimulate = Number(process.env.__TEST_RUNNING_COUNT)
        mod.__setRunningCountForTest(runningCountToSimulate)
        const task = await createTask({
          title: 'env-override-probe',
          priority: 'low',
          columnId: 'in_progress',
          targetPath: process.cwd(),
          automationStatus: 'idle',
        })
        try {
          await mod.triggerAutomation(task)
          console.log(JSON.stringify({ queueDepth: mod.getQueueDepth() }))
        } finally {
          await deleteTask(task.id)
        }
      })
    `
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
        // 清空 PATH：確保若這個測試案例走到「立即執行」分支（未進 queue），
        // spawn('hermes', ...) 一定找不到執行檔、快速失敗，不會真的觸發
        // 一次 hermes chat 執行。這裡只驗證 queue/排隊判斷邏輯，不需要
        // （也不應該）真的執行 hermes。用 process.execPath（絕對路徑）啟動
        // 子程序本身，所以清空 PATH 不影響子程序 node 執行檔的解析。
        PATH: '',
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`subprocess exited with code ${code}\nstderr: ${stderr}`))
        return
      }
      const lastLine = stdout.trim().split('\n').pop()
      try {
        resolve(JSON.parse(lastLine))
      } catch (err) {
        reject(new Error(`failed to parse subprocess stdout: ${stdout}\n${err.message}`))
      }
    })
  })
}

test('AUTOMATION_MAX_CONCURRENT=1 (default): a second task with 1 already running goes to queue', async () => {
  const { queueDepth } = await runInSubprocess({ __TEST_RUNNING_COUNT: '1' })
  assert.equal(queueDepth, 1)
})

test('AUTOMATION_MAX_CONCURRENT=5: a task with only 1 already running does NOT queue (runs immediately)', async () => {
  const { queueDepth } = await runInSubprocess({
    AUTOMATION_MAX_CONCURRENT: '5',
    __TEST_RUNNING_COUNT: '1',
  })
  assert.equal(queueDepth, 0)
})
