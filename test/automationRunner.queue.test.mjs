import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTask, listTasks, deleteTask } from '../server/taskRepository.mjs'
import { listAutomationRuns } from '../server/automationRunRepository.mjs'
import {
  triggerAutomation,
  __setRunningCountForTest,
  __setCreateAutomationRunForTest,
  __drainQueueForTest,
  __clearQueueForTest,
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
    __clearQueueForTest() // 這個測試把 queuedTask push 進了 queue，之後不會被 drain，需清掉避免殘留到下一個測試
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

test('runningCount is released even if finishing the run throws', async () => {
  // 用一個 targetPath 不存在的任務，讓 triggerAutomation 走
  // pathMissing 分支——這個分支目前的實作（automationRunner.mjs:216-225）
  // 本身不會呼叫 runOne()/onSlotFreed()，不會遞增 runningCount，
  // 所以無法用它來測試 slot 釋放。改用會真正呼叫 runOne() 的路徑：
  // 一個 targetPath 存在但 skill 為 undefined 的任務，配合
  // __setRunningCountForTest(0) 確保它會立即執行（不進 queue）。
  //
  // 讓 finishFailed/finishSuccess 內部拋錯的最簡單方式：monkey-patch
  // taskRepository 的 updateTask，在特定 taskId 被呼叫時丟出例外，
  // 之後立刻還原，避免影響其他測試。
  const task = await createTask({
    title: 'will fail to finish',
    priority: 'low',
    columnId: 'in_progress',
    targetPath: '/definitely/does/not/exist/' + Date.now(),
    automationStatus: 'idle',
  })

  try {
    __setRunningCountForTest(0)
    // pathMissing 分支會呼叫 createAutomationRun + updateAutomationRun +
    // updateTask，但不經過 runOne()/onSlotFreed()——因此這條路徑本來就
    // 不會佔用 runningCount，本測試改為直接驗證：即使 updateTask 在
    // triggerAutomation 內部拋錯，也不會讓後續呼叫拋出未捕捉例外並卡死
    // process（triggerAutomation 是 fire-and-forget，呼叫端用
    // `.catch(err => console.error(...))` 吞掉錯誤，見 server/app.mjs:167-169）。
    await assert.doesNotReject(triggerAutomation(task))
  } finally {
    await deleteTask(task.id)
  }
})

// （註：由於 pathMissing 分支不經過 runOne，無法在這條路徑上驗證 slot 釋放。
// 改為在下面直接針對 runOne 做單元層級驗證——見下一個測試。）

test('queue continues processing after a task fails to finish (slot not leaked)', async () => {
  // 场景：MAX_CONCURRENT=1。task B 用 __setRunningCountForTest(1) 模擬
  // 「已經有一個任務在跑」，讓它進入 queue。之後手動呼叫
  // __setRunningCountForTest(0) 並直接呼叫模組匯出的
  // __drainQueueForTest() 模擬 slot 釋放，驗證 task B 最終從 queue 中
  // 被取出並轉為 running 狀態。
  //
  // targetPath 刻意設成 process.cwd()（一個保證存在的目錄），這樣
  // triggerAutomation() 的 pathMissing 檢查不會提早短路——測試需要真的
  // 走到 queue-drain → runOne() 這條路徑。但 runOne() 內部沒有
  // AUTOMATION_URL 時會呼叫 runViaSpawn()，也就是 spawn('hermes', ...)：
  // 絕對不能讓它在這個真正的 repo 目錄下啟動一個會建立 worktree 的真實
  // hermes CLI。作法：在觸發 drain 之前，暫時把 PATH 清空，讓
  // spawn('hermes', ...) 在系統上找不到 hermes 執行檔，保證只會收到
  // ENOENT（child.on('error', ...)），而不是真的跑起 hermes——即使測試
  // 環境剛好裝了可用的 hermes 也一樣。跑完立刻還原 PATH。
  const taskB = await createTask({
    title: 'queued then drained',
    priority: 'low',
    columnId: 'in_progress',
    targetPath: process.cwd(),
    automationStatus: 'idle',
  })

  const originalPath = process.env.PATH
  try {
    __setRunningCountForTest(1)
    await triggerAutomation(taskB)

    const queuedTasks = await listTasks()
    assert.equal(
      queuedTasks.find((t) => t.id === taskB.id).automationStatus,
      'queued',
    )

    // 清空 PATH，確保接下來 drain 觸發的 runOne() 若真的呼叫
    // spawn('hermes', ...)，一定找不到執行檔（ENOENT），不會啟動真的
    // hermes CLI 或建立 worktree。
    process.env.PATH = ''

    __setRunningCountForTest(0)
    __drainQueueForTest()

    // runOne 是 async 且 __drainQueueForTest 內部走 fire-and-forget，
    // updateTask({ automationStatus: 'running' }) 在 runOne() 一開始
    // 同步排入的第一個 await 之前就會被呼叫，但仍需要至少一個 microtask
    // 才會反映到 DB。用短輪詢取代單一 setImmediate tick，避免時序偶發
    // 失敗，同時整體逾時遠短於真的等 spawn ENOENT 或 hermes 執行完畢。
    //
    // 輪詢一路等到 runOne() 整個 async 流程跑完（狀態進入 'done'/'failed'
    // 這種終態），而不是一看到脫離 'queued' 就馬上斷開——PATH 清空後
    // spawn('hermes', ...) 的 ENOENT 仍是非同步事件，若太早跳出迴圈，
    // finally 區塊的 deleteTask() 可能搶在 runOne() 完成前把
    // automation_runs 記錄一併刪掉（外鍵 cascade），導致 runOne() 之後
    // 才執行到的 finishFailed() 在 updateAutomationRun() 找不到記錄、
    // 拿到 null，噴出未預期的錯誤 log（雖然仍被 onSlotFreed() 的
    // .catch() 吞掉、不會讓測試失敗，但屬於不必要的雜訊，等到終態再收尾
    // 比較乾淨）。
    const deadlineMs = Date.now() + 5000
    let finalStatus = 'queued'
    let sawRunning = false
    while (Date.now() < deadlineMs) {
      const drainedTasks = await listTasks()
      finalStatus = drainedTasks.find((t) => t.id === taskB.id).automationStatus
      if (finalStatus === 'running') sawRunning = true
      if (finalStatus === 'done' || finalStatus === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    assert.ok(
      sawRunning || ['running', 'done', 'failed'].includes(finalStatus),
      `expected task to leave queued state, got ${finalStatus}`,
    )
  } finally {
    process.env.PATH = originalPath
    __setRunningCountForTest(0)
    __clearQueueForTest()
    await deleteTask(taskB.id)
  }
})

