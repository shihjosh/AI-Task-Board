import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { createTask, listTasks, deleteTask } from '../server/taskRepository.mjs'
import { listAutomationRuns } from '../server/automationRunRepository.mjs'
import {
  triggerAutomation,
  __setRunningCountForTest,
  __setCreateAutomationRunForTest,
  __setSpawnForTest,
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

// Task 4 修復回合（第二輪）：原本的測試只驗證 triggerAutomation 在
// pathMissing 分支不會 reject——但 pathMissing 分支根本不會呼叫 runOne()，
// 從來沒有遞增過 runningCount，所以那個版本完全沒有測到 runOne() 的
// try/finally slot 釋放保證。這裡改用 __setRunningCountForTest(0) 確保
// 任務會走「立即執行」（runOne()）路徑，並用 __setCreateAutomationRunForTest
// 注入一個會拋錯的替身，讓例外發生在 runOne() 的 try 區塊內部（在
// runningCount 已經 += 1 之後、finally 執行之前），藉此真正驗證
// runOne() 的 finally 區塊會釋放 slot：驗證方式是例外拋出後，
// runningCount 已經歸零，後續任務可以立刻被 triggerAutomation 立即執行
// （不會被誤判成「還有任務在跑」而進了 queue）。
test('runningCount is released even if finishing the run throws', async () => {
  const task = await createTask({
    title: 'will fail inside runOne',
    priority: 'low',
    columnId: 'in_progress',
    targetPath: os.tmpdir(), // 存在於磁碟上，通過 pathMissing 檢查，但不是這個 repo
    automationStatus: 'idle',
  })

  const simulatedError = new Error('simulated DB failure inside runOne')

  try {
    __setRunningCountForTest(0) // 確保這個任務走「立即執行」路徑（runOne()），不進 queue
    __setCreateAutomationRunForTest(async () => {
      throw simulatedError
    })

    // runOne() 在呼叫 createAutomationRun() 之前已經先 runningCount += 1，
    // 所以這裡拋出的例外會發生在 try 區塊「內部」，讓 finally 的
    // onSlotFreed() 有機會被驗證到。triggerAutomation() 本身是立即執行
    // 分支（未排隊），內部呼叫 runOne(task) 沒有 catch，所以例外會往外拋。
    await assert.rejects(() => triggerAutomation(task), simulatedError)

    // 驗證 slot 真的被釋放了：一個全新的任務應該能立刻被視為「可立即執行」
    // （不會因為 runningCount 卡在高位而被誤判進 queue）。用
    // __setSpawnForTest 注入一個立刻模擬 child process 正常結束的假
    // spawn，確保這個驗證用任務不會啟動任何真的子程序。
    __setCreateAutomationRunForTest(null) // 還原成真正的實作，讓驗證任務走正常流程
    __setSpawnForTest((_cmd, _args, _opts) => {
      const fakeChild = {
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event, handler) => {
          if (event === 'exit') {
            setImmediate(() => handler(0))
          }
        },
        kill: () => {},
      }
      return fakeChild
    })

    const followUpTask = await createTask({
      title: 'should run immediately if slot was released',
      priority: 'low',
      columnId: 'in_progress',
      targetPath: os.tmpdir(),
      automationStatus: 'idle',
    })

    try {
      await triggerAutomation(followUpTask)

      const tasksAfter = await listTasks()
      const recheckedFollowUp = tasksAfter.find((t) => t.id === followUpTask.id)
      // 如果 slot 沒有被釋放（runningCount 仍卡在 1），這個任務會被排進
      // queue，狀態會停在 'queued'，而不是走到 runOne() 產生的
      // 'running'/'done'/'failed' 終態。
      assert.notEqual(recheckedFollowUp.automationStatus, 'queued')
    } finally {
      await deleteTask(followUpTask.id)
    }
  } finally {
    __setCreateAutomationRunForTest(null) // 還原成真正的實作
    __setSpawnForTest(null) // 還原成真正的實作
    __setRunningCountForTest(0)
    await deleteTask(task.id)
  }
})

test('queue continues processing after a task fails to finish (slot not leaked)', async () => {
  // 场景：MAX_CONCURRENT=1。task B 用 __setRunningCountForTest(1) 模擬
  // 「已經有一個任務在跑」，讓它進入 queue。之後手動呼叫
  // __setRunningCountForTest(0) 並直接呼叫模組匯出的
  // __drainQueueForTest() 模擬 slot 釋放，驗證 task B 最終從 queue 中
  // 被取出並轉為 running 狀態。
  //
  // targetPath 用 os.tmpdir()（一個保證存在、但不是這個 repo 目錄的
  // 路徑），這樣 triggerAutomation() 的 pathMissing 檢查不會提早短路
  // ——測試需要真的走到 queue-drain → runOne() 這條路徑。runOne()
  // 內部沒有 AUTOMATION_URL 時會呼叫 runViaSpawn()，也就是
  // spawn('hermes', ...)：絕對不能讓它在真的檔案系統上啟動一個會建立
  // worktree 的真實 hermes CLI。作法：用 __setSpawnForTest() 注入一個
  // 假的 spawn 實作，這個假實作只會透過 setImmediate 模擬 child process
  // 正常 exit(0)，永遠不會呼叫 node:child_process 的真正 spawn——不論
  // 測試環境的 PATH 上有沒有 hermes 執行檔、也不論 cwd 是哪裡，都保證
  // 不會有真實子程序被啟動。
  const taskB = await createTask({
    title: 'queued then drained',
    priority: 'low',
    columnId: 'in_progress',
    targetPath: os.tmpdir(),
    automationStatus: 'idle',
  })

  try {
    __setRunningCountForTest(1)
    await triggerAutomation(taskB)

    const queuedTasks = await listTasks()
    assert.equal(
      queuedTasks.find((t) => t.id === taskB.id).automationStatus,
      'queued',
    )

    // 注入假 spawn：保證接下來 drain 觸發的 runOne() 呼叫的
    // runViaSpawn() 不會啟動真的子程序，只會透過 setImmediate 模擬一個
    // exit code 0 的 child process。
    __setSpawnForTest((_cmd, _args, _opts) => {
      const fakeChild = {
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event, handler) => {
          if (event === 'exit') {
            setImmediate(() => handler(0))
          }
        },
        kill: () => {},
      }
      return fakeChild
    })

    __setRunningCountForTest(0)
    __drainQueueForTest()

    // runOne 是 async 且 __drainQueueForTest 內部走 fire-and-forget，
    // updateTask({ automationStatus: 'running' }) 在 runOne() 一開始
    // 同步排入的第一個 await 之前就會被呼叫，但仍需要至少一個 microtask
    // 才會反映到 DB。用短輪詢取代單一 setImmediate tick，避免時序偶發
    // 失敗，同時整體逾時遠短於真的等 spawn 完成。
    //
    // 輪詢一路等到 runOne() 整個 async 流程跑完（狀態進入 'done'/'failed'
    // 這種終態），而不是一看到脫離 'queued' 就馬上斷開——太早跳出迴圈，
    // finally 區塊的 deleteTask() 可能搶在 runOne() 完成前把
    // automation_runs 記錄一併刪掉（外鍵 cascade），導致 runOne() 之後
    // 才執行到的 finishSuccess()/finishFailed() 在 updateAutomationRun()
    // 找不到記錄、拿到 null，噴出未預期的錯誤 log（雖然仍被
    // onSlotFreed() 的 .catch() 吞掉、不會讓測試失敗，但屬於不必要的
    // 雜訊，等到終態再收尾比較乾淨）。
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

    // 進一步驗證：drain 走的是 existingRun 續用路徑（updateAutomationRun），
    // 而不是又呼叫了一次 createAutomationRun 建立第二筆記錄——task B 從
    // 頭到尾應該只對應「恰好 1 筆」automation_runs 記錄（觸發排隊時建立
    // 的那筆 'queued' 記錄，drain 後被原地更新成 'running' 再到終態）。
    const runsAfterDrain = await listAutomationRuns(taskB.id)
    assert.equal(runsAfterDrain.length, 1)
  } finally {
    __setSpawnForTest(null) // 還原成真正的實作
    __setRunningCountForTest(0)
    __clearQueueForTest()
    await deleteTask(taskB.id)
  }
})
