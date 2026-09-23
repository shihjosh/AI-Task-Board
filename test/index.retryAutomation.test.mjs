import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createTask, deleteTask } from '../server/taskRepository.mjs'

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

// 使用者需求：勾選「不讓 AI 執行任務」（automationDisabled）的卡片，
// 就算使用者手動點「重新執行」，API 也要拒絕，不能只靠前端隱藏按鈕。
test('POST /api/tasks/:id/retry-automation returns 409 when task.automationDisabled is true', async () => {
  const server = app.listen(0)
  const task = await createTask({
    title: 'automation disabled, retry should be rejected',
    priority: 'low',
    columnId: 'in_progress',
    automationStatus: 'interrupted',
    automationDisabled: true,
  })
  try {
    const res = await request(server, 'POST', `/api/tasks/${task.id}/retry-automation`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'automation_disabled')
  } finally {
    server.close()
    await deleteTask(task.id)
  }
})
