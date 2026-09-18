import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
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
