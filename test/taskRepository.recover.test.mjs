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

// 註：這個測試檔（以及 index.retryAutomation.test.mjs、
// automationRunner.queue.test.mjs）在 `node --test` 底下各自被 spawn 成獨立
// process，但共用同一份真實的 SQLite 檔案（server/db/index.mjs 的單例連線，
// 沒有測試專用的隔離 DB）。因此不能斷言 recoverInterruptedRuns() 回傳的
// tasksRecovered/runsRecovered 全域計數為 0——若這個測試執行的瞬間，另一個
// 測試檔案建立的任務剛好還殘留在 running/queued 狀態（例如清理用的 finally
// 還沒跑到），會撈到別人的殘留資料，讓計數斷言變成天生不穩定的測試（flaky）。
// 改為只檢查這個測試自己建立的 idle 任務沒有被誤動到，跟同檔案另外兩個測試
// 用 .find(id) 只檢查自身建立資料的做法一致。
test('recoverInterruptedRuns does not touch an idle task', async () => {
  const idleTask = await createTask({
    title: 'idle task for no-op check',
    priority: 'low',
    columnId: 'todo',
    automationStatus: 'idle',
  })

  try {
    await recoverInterruptedRuns()

    const tasks = await listTasks()
    const untouchedIdle = tasks.find((t) => t.id === idleTask.id)
    assert.equal(untouchedIdle.automationStatus, 'idle')
  } finally {
    await deleteTask(idleTask.id)
  }
})
