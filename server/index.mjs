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
app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
})
