import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

// 使用真正的 server（含真正的 SQLite 檔案），透過隨機 port 啟動。
// /health 是不需要資料庫的純狀態檢查，不會寫入任何資料，不需清理。
process.env.PORT = '0'
const { default: app } = await import('../server/app.mjs')

function request(server, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path, method },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

test('GET /health returns 200 { status: "ok" } without auth', async () => {
  const server = app.listen(0)
  try {
    const res = await request(server, 'GET', '/health')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { status: 'ok' })
  } finally {
    server.close()
  }
})
