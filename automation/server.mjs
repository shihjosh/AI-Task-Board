import http from 'node:http'
import { spawn } from 'node:child_process'

const PORT = process.env.PORT ?? 3100
const TIMEOUT_MS = 15 * 60 * 1000 // 15 分鐘，與 automationRunner.mjs 的逾時策略一致

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function runHermes({ prompt, cwd, skill }) {
  return new Promise((resolve) => {
    const args = ['chat', '-q', prompt, '-w', '--cli']
    if (skill) {
      args.push('-s', skill)
    }

    let child
    try {
      child = spawn('hermes', args, { cwd, detached: true })
    } catch (err) {
      resolve({
        exitCode: null,
        stdout: '',
        stderr: `無法啟動 Hermes 程序：${err.message}`,
        timedOut: false,
      })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        exitCode: null,
        stdout,
        stderr: `${stderr}\n無法啟動 Hermes 程序：${err.message}`,
        timedOut,
      })
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, stdout, stderr, timedOut })
    })
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  if (req.method === 'POST' && req.url === '/run') {
    let body
    try {
      body = await readJsonBody(req)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid_json' }))
      return
    }

    const { prompt, cwd, skill } = body
    if (!prompt || !cwd) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'prompt and cwd are required' }))
      return
    }

    const result = await runHermes({ prompt, cwd, skill })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not_found' }))
})

server.listen(PORT, () => {
  console.log(`Automation trigger server listening on port ${PORT}`)
})
