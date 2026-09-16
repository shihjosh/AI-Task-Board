import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

// 使用真正的 server（含真正的 SQLite 檔案），透過隨機 port 啟動，
// 測試完清除建立的任務，避免污染本機 .data/taskboard.sqlite。
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

test('POST /api/tasks/:id/retry-automation returns 404 for missing task', async () => {
  const server = app.listen(0)
  try {
    const res = await request(server, 'POST', '/api/tasks/does-not-exist/retry-automation')
    assert.equal(res.status, 404)
    assert.equal(res.body.error, 'not_found')
  } finally {
    server.close()
  }
})
