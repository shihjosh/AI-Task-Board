import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const indexPath = path.join(__dirname, '..', 'server', 'index.mjs')

function waitForListening(child, port) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server 啟動逾時')), 5000)
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes(`listening on port ${port}`)) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.on('error', reject)
  })
}

function requestHealth(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/health', method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('SIGTERM triggers graceful shutdown: in-flight request completes, process exits 0', async () => {
  const port = 39281
  const child = spawn('node', [indexPath], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForListening(child, port)

    // 送出一個 request，同時送 SIGTERM，驗證「正在處理中的 request」不被硬切斷。
    const [healthResult] = await Promise.all([
      requestHealth(port),
      new Promise((resolve) => setTimeout(() => {
        child.kill('SIGTERM')
        resolve()
      }, 50)),
    ])
    assert.equal(healthResult.status, 200)

    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => resolve(code))
    })
    assert.equal(exitCode, 0)
  } finally {
    if (!child.killed) child.kill('SIGKILL')
  }
})

test('double signal (SIGTERM 後緊接著 SIGINT) 不會造成重複觸發，程序仍正常以 exit code 0 結束一次', async () => {
  const port = 39282
  const child = spawn('node', [indexPath], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderrOutput = ''
  child.stderr.on('data', (chunk) => {
    stderrOutput += chunk.toString()
  })

  let shutdownLogCount = 0
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    const matches = text.match(/\[shutdown\] 收到/g)
    if (matches) shutdownLogCount += matches.length
  })

  try {
    await waitForListening(child, port)

    // 短時間內連續送出兩個訊號，驗證 shuttingDown guard 阻止第二次觸發。
    child.kill('SIGTERM')
    child.kill('SIGINT')

    let exitCode
    let exitSignal
    await new Promise((resolve) => {
      child.on('exit', (code, signal) => {
        exitCode = code
        exitSignal = signal
        resolve()
      })
    })

    // 只應該有一次「收到 <signal>」的 log，代表 guard 生效、shutdown() 只跑一次。
    assert.equal(shutdownLogCount, 1)
    assert.equal(exitCode, 0)
    assert.equal(exitSignal, null)
    // 不應該出現 server.close() 被呼叫兩次導致的 Node 錯誤（例如 ERR_SERVER_NOT_RUNNING）。
    assert.doesNotMatch(stderrOutput, /ERR_SERVER_NOT_RUNNING/)
  } finally {
    if (!child.killed) child.kill('SIGKILL')
  }
})

test('shutdown 逾時（卡住的連線遲遲不結束）觸發 forced-exit 分支，程序以 exit code 1 結束', async () => {
  const port = 39283
  const child = spawn('node', [indexPath], {
    env: { ...process.env, PORT: String(port), SHUTDOWN_TIMEOUT_MS: '200' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderrOutput = ''
  child.stderr.on('data', (chunk) => {
    stderrOutput += chunk.toString()
  })

  let stuckSocket

  try {
    await waitForListening(child, port)

    // 開一條原始 TCP 連線，只送出不完整的 request line、故意不結束它，
    // 讓 server.close() 因為還有一個尚未結束的連線而遲遲不呼叫 callback，
    // 藉此讓 shutdown() 真的卡住、逼出 SHUTDOWN_TIMEOUT_MS 逾時後的 force-exit 分支。
    await new Promise((resolve, reject) => {
      stuckSocket = net.connect({ host: '127.0.0.1', port }, () => {
        stuckSocket.write('GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n')
        // 故意不送出結尾的 \r\n，request 永遠不會被 Express 視為完整送達，
        // 連線因此持續保持開啟狀態。
        resolve()
      })
      stuckSocket.unref()
      stuckSocket.on('error', reject)
    })

    child.kill('SIGTERM')

    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => resolve(code))
    })

    assert.equal(exitCode, 1)
    assert.match(stderrOutput, /逾時（200ms）仍有未完成請求，強制結束程序/)
  } finally {
    if (stuckSocket) stuckSocket.destroy()
    if (!child.killed) child.kill('SIGKILL')
  }
})
