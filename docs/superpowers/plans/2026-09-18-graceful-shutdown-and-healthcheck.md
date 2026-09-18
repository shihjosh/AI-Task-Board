# Graceful Shutdown 與 Docker Healthcheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `server/index.mjs` 接上 SIGTERM/SIGINT graceful shutdown（等待進行中的 HTTP request 完成再關閉），並在 `docker-compose.yml` 的 `taskboard`、`automation` 兩個 service 加上 healthcheck，讓 Docker 能偵測「process 活著但已 hang 住」的情況。

**Architecture:** `server/index.mjs` 監聽 SIGTERM/SIGINT，收到訊號後停止接受新連線（`server.close()`），等現有 request 處理完（有逾時保護，避免卡死不退出），再 `process.exit(0)`。`taskboard` 新增 `GET /health` route（已存在 `automation` 的 `/health` 可參考），`docker-compose.yml` 兩個 service 各自加 `healthcheck:` 區塊，用 `node` 內建 fetch 打自己的 `/health`（image 是 `node:22-alpine`，沒有 `curl`，避免額外安裝依賴；`wget` 存在但用 node 一致性更高，且能設定逾時與正確的 exit code）。

**Tech Stack:** Node.js 22（`node --test` 後端整合測試）、Express 5、Docker Compose、`node:http`/`node:net` 內建模組（無新依賴）。

## Global Constraints

- 不新增任何 npm 依賴（healthcheck 用 node 內建 `fetch`，graceful shutdown 用 `node:http`/`process` 內建 API）。
- 後端測試執行方式：`node --test "test/**/*.test.mjs"`（裸 `node --test test/` 會因目錄下沒有 `.test.js` 副檔名檔案報 MODULE_NOT_FOUND，必須用 glob）。
- `server/app.mjs`（可測試的 Express app，不含 `listen`）與 `server/index.mjs`（啟動 + `listen`）維持既有分離，`/health` route 加在 `app.mjs`（可被整合測試直接 `import app` 打）；graceful shutdown 邏輯（訊號處理、`server.close()`）留在 `index.mjs`（只有它才有 `http.Server` 實例）。
- `docker-compose.yml` 修改須維持既有中文註解風格與段落結構，不要破壞既有的 `automation`/`postgres` service 註解區塊。
- 兩個 service 目前都設定 `restart: unless-stopped`；healthcheck 失敗多次後 Docker 會依此設定自動重啟容器，不需額外設定 `restart` 相關參數。
- `automation` service 用 `network_mode: host`，healthcheck 打 `http://localhost:3100/health`（同一 network namespace，可直接用 localhost）。
- `taskboard` service healthcheck 打 `http://localhost:8088/health`（容器內部 `EXPOSE 8088`，`PORT` 環境變數預設也是 8088，見 `Dockerfile`）。

---

## Task 1: taskboard 新增 `GET /health` route

**Files:**
- Modify: `server/app.mjs`（在既有 `app.get('/api/tasks', ...)` 之前或旁邊加一個新 route，不需要 Basic Auth 保護——healthcheck 探針不會帶認證資訊，且健康狀態本身不是敏感資訊）
- Test: `test/app.health.test.mjs`（新建）

**Interfaces:**
- Consumes: `server/app.mjs` 匯出的 `app`（Express instance，已存在，`export default app` 見檔案結尾）
- Produces: `GET /health` route，回應 `200 { "status": "ok" }`，供 Task 3 的 docker-compose healthcheck 呼叫，也供本任務的測試直接驗證。

- [x] **Step 1: 寫失敗測試**

建立 `test/app.health.test.mjs`：

```javascript
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
```

- [x] **Step 2: 執行測試確認失敗**

Run: `node --test test/app.health.test.mjs`
Expected: FAIL — `/health` 回 404（`not_found`），因為 route 還不存在。

- [x] **Step 3: 在 `server/app.mjs` 加上 `/health` route**

在 `const app = express()` 與 `app.use(createBasicAuthMiddleware())` 之間插入（**必須在 Basic Auth middleware 之前**，讓 healthcheck 探針不需要帶認證資訊）：

```javascript
const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use(createBasicAuthMiddleware())
```

（原本 `app.use(createBasicAuthMiddleware())` 那一行維持在原位置即可，只是在它之前多插入 `/health` route。）

- [x] **Step 4: 執行測試確認通過**

Run: `node --test test/app.health.test.mjs`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/app.mjs test/app.health.test.mjs
git commit -m "feat: add GET /health route to taskboard server for Docker healthcheck"
```

---

## Task 2: `server/index.mjs` 加上 SIGTERM/SIGINT graceful shutdown

**Files:**
- Modify: `server/index.mjs`
- Test: `test/index.gracefulShutdown.test.mjs`（新建）

**Interfaces:**
- Consumes: `app.listen(port, callback)` 回傳的 `http.Server` 實例（目前 `index.mjs` 呼叫 `app.listen` 但沒有保留回傳值，需要先存到變數）
- Produces: 無新的匯出函式（`index.mjs` 是 entrypoint script，不是可 import 的模組）；改為在程序層級註冊訊號處理。測試改用 spawn 真實子程序驗證行為，而非 import。

- [x] **Step 1: 寫失敗測試**

建立 `test/index.gracefulShutdown.test.mjs`。用 `child_process.spawn` 啟動真實的 `node server/index.mjs` 子程序（獨立 process 才能真的送 SIGTERM 並觀察程序退出行為），確認：(a) 收到 SIGTERM 後程序會在時限內正常退出（exit code 0），(b) 收到訊號當下正在處理中的 request 仍能拿到回應（不會被硬切斷）。

```javascript
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
```

- [x] **Step 2: 執行測試確認失敗**

Run: `node --test test/index.gracefulShutdown.test.mjs`
Expected: FAIL — 目前 `index.mjs` 沒有處理 SIGTERM，Node.js 預設行為是立即終止程序（exit code 為 `null` 或非 0，視平台而定，測試會在 `assert.equal(exitCode, 0)` 失敗）。

- [x] **Step 3: 在 `server/index.mjs` 加上 graceful shutdown**

把 `server/index.mjs` 改為：

```javascript
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
```

- [x] **Step 4: 執行測試確認通過**

Run: `node --test test/index.gracefulShutdown.test.mjs`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/index.mjs test/index.gracefulShutdown.test.mjs
git commit -m "feat: add SIGTERM/SIGINT graceful shutdown to server/index.mjs"
```

---

## Task 3: `docker-compose.yml` 加上 `taskboard`、`automation` 兩個 service 的 healthcheck

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: Task 1 完成後 `taskboard` 的 `GET /health`（port 8088）、既有 `automation` 的 `GET /health`（port 3100，`automation/server.mjs` 已存在，見該檔案第 83-87 行）。
- Produces: 無程式介面（純 compose 設定變更），驗證方式為手動跑 `docker compose config` 確認語法正確 + `docker compose up` 後 `docker inspect` 確認健康狀態。

- [x] **Step 1: 在 `taskboard` service 加上 healthcheck**

在 `docker-compose.yml` 的 `taskboard` service 區塊、`restart: unless-stopped` 之前插入：

```yaml
    healthcheck:
      # node:22-alpine 沒有 curl，用 node 內建 fetch 打自己的 /health，
      # 避免為了 healthcheck 額外安裝套件。exit code 非 0 視為 unhealthy。
      test: [\"CMD\", \"node\", \"-e\", \"fetch('http://localhost:8088/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

完整的 `taskboard` service 區塊變成：

```yaml
services:
  taskboard:
    build:
      context: .
      dockerfile: Dockerfile
    image: ai-task-board:latest
    container_name: ai-task-board
    env_file:
      - path: .env
        required: false
    environment:
      AUTOMATION_URL: http://host.docker.internal:3100
      TASKBOARD_URL: http://taskboard:8088
    extra_hosts:
      - \"host.docker.internal:host-gateway\"
    ports:
      - \"8088:8088\"
    volumes:
      - taskboard-data:/app/.data
    healthcheck:
      # node:22-alpine 沒有 curl，用 node 內建 fetch 打自己的 /health，
      # 避免為了 healthcheck 額外安裝套件。exit code 非 0 視為 unhealthy。
      test: [\"CMD\", \"node\", \"-e\", \"fetch('http://localhost:8088/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped
```

（`environment:` 底下原有中文註解區塊維持不動，此處為節省篇幅省略顯示，實際編輯時保留。）

- [x] **Step 2: 在 `automation` service 加上 healthcheck**

在 `automation` service 區塊、`restart: unless-stopped` 之前插入：

```yaml
    healthcheck:
      # automation/server.mjs 已內建 /health route（見該檔案）。
      # network_mode: host，可直接用 localhost 存取。
      test: [\"CMD\", \"node\", \"-e\", \"fetch('http://localhost:3100/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

- [x] **Step 3: 驗證 compose 語法正確**

Run: `docker compose config`
Expected: 無錯誤訊息，輸出完整的合併後設定，且能看到兩個 service 的 `healthcheck` 區塊。

- [x] **Step 4: 手動驗證 healthcheck 實際運作（可選但建議）**

Run: `docker compose build taskboard && docker compose up -d taskboard`
等待 `start_period`（10s）後執行：
Run: `docker inspect --format='{{json .State.Health}}' ai-task-board`
Expected: `"Status":"healthy"`（而非 `starting` 或 `unhealthy`）。

清理：`docker compose down`

> **執行備註**：taskboard 已實機驗證 `"Status":"healthy"`。automation service 因需要完整 host `~/.hermes`/9Router 環境才能實機啟動，本次執行環境無法驗證，僅完成 Step 3 的語法驗證（見 ledger Task 3 parked 記錄）。

- [x] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add healthcheck to taskboard and automation compose services"
```

---

## Task 4: 完整回歸測試 + README 更新

**Files:**
- Modify: `README.md`（若專案有記錄「已知限制」或「TODO」段落，把 graceful shutdown / healthcheck 從待辦移除或標記完成；若無對應段落則跳過此檔案修改）

**Interfaces:**
- Consumes: Task 1-3 的所有變更。
- Produces: 無新程式介面，此任務是驗證與收尾。

- [ ] **Step 1: 跑完整後端測試**

Run: `node --test "test/**/*.test.mjs"`
Expected: 全部 PASS，包含 Task 1、2 新增的測試與既有測試。

- [ ] **Step 2: 跑 lint**

Run: `npx oxlint server/ test/`
Expected: 無新增的 lint 錯誤。

- [ ] **Step 3: 檢查 README 是否需要更新**

搜尋 README 是否有提到「graceful shutdown」「healthcheck」相關的已知限制敘述，若有則更新為已解決；若無相關段落則跳過，不需要新增。

- [ ] **Step 4: Commit（若有 README 變更）**

```bash
git add README.md
git commit -m "docs: note graceful shutdown and healthcheck support in README"
```

（若 Step 3 判斷無需修改 README，跳過本步驟。）
