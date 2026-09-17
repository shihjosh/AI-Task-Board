import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTask, listTasks, deleteTask, recoverInterruptedRuns } from '../server/taskRepository.mjs'
import { createAutomationRun, updateAutomationRun, listAutomationRuns } from '../server/automationRunRepository.mjs'

// 整合測試：直接用真正的 SQLite 檔案（透過 server/db/index.mjs 的單例連線），
// 因為 recoverInterruptedRuns() 不接受注入的 db 參數——它走跟其餘 repository
// 一樣的統一介面（server/db/index.mjs 的 all/get/run），該介面同時支援 sqlite
// 與 postgres 兩種驅動，沒有暴露測試專用的 in-memory db 注入點。測試建立的
// task/run 在結束時明確清理，不污染本機 .data/taskboard.sqlite。

test('recoverInterruptedRuns marks running tasks and runs as interrupted', async () => {
  const stuckTask = await createTask({
    title: 'stuck task',
    priority: 'high',
    columnId: 'in_progress',
    automationStatus: 'running',
  })
  const idleTask = await createTask({
    title: 'idle task',
    priority: 'low',
    columnId: 'todo',
    automationStatus: 'idle',
  })

  const runningRun = await createAutomationRun(stuckTask.id, { prompt: 'do the thing' })
  const doneRun = await createAutomationRun(stuckTask.id, { prompt: 'earlier run' })
  await updateAutomationRun(doneRun.id, { status: 'done', output: 'ok' })

  try {
    const result = await recoverInterruptedRuns()

    assert.equal(result.tasksRecovered >= 1, true)
    assert.equal(result.runsRecovered >= 1, true)

    const tasks = await listTasks()
    const recoveredStuck = tasks.find((t) => t.id === stuckTask.id)
    assert.equal(recoveredStuck.automationStatus, 'interrupted')
    const untouchedIdle = tasks.find((t) => t.id === idleTask.id)
    assert.equal(untouchedIdle.automationStatus, 'idle') // 未受影響

    const runs = await listAutomationRuns(stuckTask.id)
    const recoveredRun = runs.find((r) => r.id === runningRun.id)
    assert.equal(recoveredRun.status, 'interrupted')
    assert.match(recoveredRun.error, /伺服器重啟或程序中斷/)
    assert.ok(recoveredRun.finishedAt)

    const untouchedRun = runs.find((r) => r.id === doneRun.id)
    assert.equal(untouchedRun.status, 'done') // 未受影響
  } finally {
    await deleteTask(stuckTask.id)
    await deleteTask(idleTask.id)
  }
})

test('recoverInterruptedRuns marks queued tasks and runs as interrupted', async () => {
  const queuedTask = await createTask({
    title: 'queued task',
    priority: 'medium',
    columnId: 'in_progress',
    automationStatus: 'queued',
  })

  const queuedRun = await createAutomationRun(queuedTask.id, {
    prompt: 'waiting in line',
    status: 'queued',
  })

  try {
    const result = await recoverInterruptedRuns()

    assert.equal(result.tasksRecovered >= 1, true)
    assert.equal(result.runsRecovered >= 1, true)

    const tasks = await listTasks()
    const recoveredQueued = tasks.find((t) => t.id === queuedTask.id)
    assert.equal(recoveredQueued.automationStatus, 'interrupted')

    const runs = await listAutomationRuns(queuedTask.id)
    const recoveredRun = runs.find((r) => r.id === queuedRun.id)
    assert.equal(recoveredRun.status, 'interrupted')
    assert.match(recoveredRun.error, /伺服器重啟或程序中斷/)
  } finally {
    await deleteTask(queuedTask.id)
  }
})

test('recoverInterruptedRuns is a no-op when nothing is running', async () => {
  const idleTask = await createTask({
    title: 'idle task for no-op check',
    priority: 'low',
    columnId: 'todo',
    automationStatus: 'idle',
  })

  try {
    const result = await recoverInterruptedRuns()
    assert.equal(result.tasksRecovered, 0)
    assert.equal(result.runsRecovered, 0)
  } finally {
    await deleteTask(idleTask.id)
  }
})
