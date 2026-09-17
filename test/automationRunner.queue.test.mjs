import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTask, listTasks, deleteTask } from '../server/taskRepository.mjs'
import { listAutomationRuns } from '../server/automationRunRepository.mjs'
import {
  triggerAutomation,
  __setRunningCountForTest,
  __setCreateAutomationRunForTest,
} from '../server/automationRunner.mjs'

// 用 __setRunningCountForTest 直接模擬「已有一個任務在跑」的併發狀態，
// 避免依賴真實 async 時序（setImmediate race）——確定性優先於巧妙。

test('triggerAutomation marks a queued task and creates a queued automation_runs record', async () => {
  const queuedTask = await createTask({
    title: 'should be queued',
    priority: 'low',
    columnId: 'in_progress',
    targetPath: process.cwd(),
    automationStatus: 'idle',
  })

  try {
    __setRunningCountForTest(1) // 假裝已經有一個任務在跑，讓 MAX_CONCURRENT=1 擋住

    await triggerAutomation(queuedTask)

    const tasks = await listTasks()
    const recheckedQueued = tasks.find((t) => t.id === queuedTask.id)
    assert.equal(recheckedQueued.automationStatus, 'queued')

    const runs = await listAutomationRuns(queuedTask.id)
    assert.equal(runs.length, 1)
    assert.equal(runs[0].status, 'queued')
  } finally {
    __setRunningCountForTest(0) // 測試結束前重置，避免污染同進程內其他測試
    await deleteTask(queuedTask.id)
  }
})

// Task 3 修復回合：驗證佇列分支的 try/catch 復原邏輯。
// createAutomationRun 沒有測試專用的 DB 失敗注入點（db/index.mjs 的統一介面
// 未暴露），所以用 __setCreateAutomationRunForTest 暫時替換掉
// automationRunner.mjs 內部持有的 createAutomationRun 參照，讓它確定性地拋錯，
// 並在 finally 內還原，避免污染其他測試。
test('triggerAutomation recovers task status when createAutomationRun throws in the queue-push branch', async () => {
  const queuedTask = await createTask({
    title: 'should recover from queue-push DB failure',
    priority: 'low',
    columnId: 'in_progress',
    targetPath: process.cwd(),
    automationStatus: 'idle',
  })

  const simulatedError = new Error('simulated DB failure during queue-push')

  try {
    __setRunningCountForTest(1) // 假裝已有任務在跑，強制走佇列分支
    __setCreateAutomationRunForTest(async () => {
      throw simulatedError
    })

    await assert.rejects(() => triggerAutomation(queuedTask), simulatedError)

    const tasks = await listTasks()
    const recheckedTask = tasks.find((t) => t.id === queuedTask.id)
    assert.notEqual(recheckedTask.automationStatus, 'queued')

    const runs = await listAutomationRuns(queuedTask.id)
    assert.equal(runs.length, 0) // createAutomationRun 失敗，不應該留下 run 紀錄
  } finally {
    __setCreateAutomationRunForTest(null) // 還原成真正的實作
    __setRunningCountForTest(0)
    await deleteTask(queuedTask.id)
  }
})

