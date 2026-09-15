# Plan: 新增 PostgreSQL 資料庫選項

## 背景 / 動機
目前唯一的資料儲存是 `better-sqlite3`（同步 API），資料庫檔案存在容器內
named volume（`.data/taskboard.sqlite`）。使用者希望多一個可以使用
PostgreSQL 的選擇，方便未來接外部/現有的 Postgres 服務，而不強迫換掉
現有 SQLite 預設路徑（單人使用、輕量部署仍是合理預設）。

## 方案

- 用環境變數 `DB_DRIVER=sqlite|postgres` 切換驅動，預設 `sqlite`（向下
  相容，不設定就跟現在行為完全一致）。
- 用 `DATABASE_URL`（連線字串，如
  `postgres://user:pass@host:5432/dbname`）提供 Postgres 連線資訊，
  當 `DB_DRIVER=postgres` 時必填，缺少則啟動時直接丟錯終止（避免悄悄
  fallback 到錯的資料庫）。
- Postgres client 是非同步 API，因此需要把資料層介面統一改成
  `async/await`：
  - `server/db.mjs` 拆成 `server/db/sqlite.mjs`（把現有同步邏輯包一層
    async 介面）與 `server/db/postgres.mjs`（新實作），對外仍匯出同一組
    函式名稱，由 `server/db/index.mjs` 依 `DB_DRIVER` 選擇並匯出。
  - 4 個 repository（`taskRepository.mjs`、`commentRepository.mjs`、
    `automationRunRepository.mjs`，`skillsRepository.mjs` 不碰資料庫可
    略過）所有函式改成 `async function`，內部改用 `await`。
  - `server/index.mjs` 所有呼叫 repository 的路由 handler 改成
    `async (req, res) => { ... }` 並 `await`。
- Postgres schema 對應現有 SQLite table 結構（tasks / comments /
  automation_runs），欄位型別調整為 Postgres 慣用型態（如
  `TEXT PRIMARY KEY`、`INTEGER`、`TIMESTAMPTZ` 或沿用 `TEXT` 存 ISO
  字串以最小化差異，欄位語意不變）。啟動時用 `CREATE TABLE IF NOT
  EXISTS` + 逐欄位檢查（比照 SQLite 版 migration 手法，用
  `information_schema.columns` 查詢取代 `PRAGMA table_info`）確保舊
  Postgres 資料庫可平順升級。
- `docker-compose.yml` 新增一個**可選**的 `postgres` service（預設不影響
  現有 sqlite-only 使用者，`taskboard` service 不強制依賴它）：
  - image: `postgres:16-alpine`
  - 環境變數走 `.env`（`POSTGRES_USER` / `POSTGRES_PASSWORD` /
    `POSTGRES_DB`）
  - volume 持久化資料
  - `taskboard` service 若要用它，使用者自行在 `.env` 設定
    `DB_DRIVER=postgres` 與對應的 `DATABASE_URL=postgres://...@postgres:5432/...`
- `.env.example` 補上 `DB_DRIVER`、`DATABASE_URL` 與新 postgres service
  對應的 `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` 範例值與
  註解。
- `package.json` 新增 `pg` 依賴。
- README.md / README.en.md 補充「如何切換到 Postgres」的簡短安裝步驟。

## 不做的事
- 不做資料庫間的資料搬遷工具（SQLite → Postgres 匯入腳本），只保證
  兩種驅動各自從空庫或既有庫都能正常啟動與運作。
- 不改變預設行為：不設定 `DB_DRIVER` 時，行為與現在完全相同。

## Task 清單

- [x] Task 1：新增 `pg` 依賴
  - `npm install pg`，確認 `package.json` / `package-lock.json` 更新

- [x] Task 2：抽出 async db 介面
  - 新增 `server/db/sqlite.mjs`：搬移現有 `db.mjs` 的 SQLite 邏輯，
    對外函式改成 `async`（內部仍同步呼叫 better-sqlite3，用
    `async function getDb() { ... return db }` 包裝即可，不需要真的
    非同步化 SQLite 本身）
  - 新增 `server/db/postgres.mjs`：用 `pg.Pool`，啟動時建立 table（若
    不存在）與必要欄位的 migration 檢查
  - 新增 `server/db/index.mjs`：依 `process.env.DB_DRIVER`（預設
    `sqlite`）匯出對應實作的 `getDb`；`DB_DRIVER=postgres` 但缺少
    `DATABASE_URL` 時，啟動時立即拋錯並印清楚錯誤訊息
  - 舊的 `server/db.mjs` 改為重新匯出 `server/db/index.mjs`（或直接
    刪除並更新所有 import 路徑，二擇一，以編譯結果為準）

- [x] Task 3：Repository 改為 async
  - `taskRepository.mjs`：`listTasks` / `createTask` / `updateTask` /
    `deleteTask` 全部改 `async function`，內部 `await getDb()` 後執行
    query（SQLite 版仍同步查詢，只是外層包在 async 函式中；Postgres
    版用 `pool.query()` 真正 await）
  - `commentRepository.mjs`：同上改 4 個函式
  - `automationRunRepository.mjs`：同上改 4 個函式
  - 確認兩種驅動下 SQL 語法相容（`?` placeholder for SQLite vs `$1,
    $2...` for Postgres，需在各自實作內處理，不能共用同一句 SQL 字串）

- [x] Task 4：`server/index.mjs` 路由改為 async
  - 所有呼叫上述 repository 函式的地方補 `await`，route handler 簽章
    改 `async (req, res) => {...}`
  - confirm Express 5（package.json 已是 `^5.2.1`）原生支援 async
    handler 拋出的 rejection 會被錯誤處理 middleware 接住（Express 5
    行為，不需額外套件）

- [x] Task 5：`docker-compose.yml` 加可選 postgres service
  - 新增 `postgres` service（image `postgres:16-alpine`，named volume
    `postgres-data:/var/lib/postgresql/data`，環境變數走 `.env`）
  - `taskboard` service 不強制 `depends_on: postgres`（維持 sqlite-only
    使用者不受影響），但補註解說明如何啟用 postgres 模式

- [x] Task 6：`.env.example` / README 補文件
  - `.env.example` 新增 `DB_DRIVER`、`DATABASE_URL` 與
    `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` 並附中文註解
  - README.md / README.en.md 各補一小段「切換到 PostgreSQL」的安裝
    步驟（含 `docker compose up postgres` 範例與 `DATABASE_URL` 格式
    範例）

- [x] Task 7：驗證
  - 不設定 `DB_DRIVER`（或設為 `sqlite`）：`npm run dev:server` 正常
    啟動，`.data/taskboard.sqlite` 照常建立，CRUD API（tasks /
    comments）皆正常
  - 設定 `DB_DRIVER=postgres` 但缺 `DATABASE_URL`：啟動立即報錯並結束
    process（不是悄悄退回 sqlite）
  - 本機啟動 `docker compose up postgres` 起一個 Postgres 容器，設定
    `DB_DRIVER=postgres` + 正確 `DATABASE_URL` 啟動 `node
    server/index.mjs`：
    - table 自動建立成功
    - 建立任務、留言、觸發 automation run 記錄皆可正常寫入/讀出
    - 重啟 process 後資料仍在（migration 邏輯不會重複報錯或清空資料）
  - `docker compose build && docker compose up`（taskboard + postgres
    兩個 service 一起跑）用 curl 驗證整個流程

- [x] Task 8：Plan checkbox 全部打勾後單獨 commit
