import app from './app.mjs'
import { recoverInterruptedRuns } from './taskRepository.mjs'

const recovery = await recoverInterruptedRuns()
if (recovery.tasksRecovered > 0 || recovery.runsRecovered > 0) {
  console.log(
    `[startup] 偵測到 ${recovery.tasksRecovered} 筆任務、${recovery.runsRecovered} 筆執行紀錄` +
      `處於中斷的 running 狀態，已標記為 interrupted`,
  )
}

const port = process.env.PORT ?? 3001
const server = app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
})

// Graceful shutdown：Docker `restart: unless-stopped` 重啟或手動 `docker stop`
// 送出 SIGTERM 時，預設行為是立即終止程序，正在處理中的 request（例如
// automation run 的狀態更新）會被硬切斷。改為：停止接受新連線、等現有
// request 處理完再結束程序；設定逾時上限，避免卡住的 request 導致程序
// 永遠無法退出（Docker 逾時後仍會送 SIGKILL 強制終止，但這裡先給正常
// 請求一個乾淨結束的機會）。
const SHUTDOWN_TIMEOUT_MS = 10_000
let shuttingDown = false

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[shutdown] 收到 ${signal}，停止接受新連線，等待現有請求完成...`)

  const forceExitTimer = setTimeout(() => {
    console.warn(`[shutdown] 逾時（${SHUTDOWN_TIMEOUT_MS}ms）仍有未完成請求，強制結束程序`)
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExitTimer.unref()

  server.close((err) => {
    clearTimeout(forceExitTimer)
    if (err) {
      console.error('[shutdown] server.close() 發生錯誤:', err)
      process.exit(1)
      return
    }
    console.log('[shutdown] 已關閉，程序結束')
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
