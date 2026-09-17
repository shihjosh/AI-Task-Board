import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTask, listTasks, deleteTask } from '../server/taskRepository.mjs'
import { listAutomationRuns } from '../server/automationRunRepository.mjs'
import { triggerAutomation, __setRunningCountForTest } from '../server/automationRunner.mjs'

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
