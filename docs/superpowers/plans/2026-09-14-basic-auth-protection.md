# Plan: HTTP Basic Auth 保護整個服務

## 背景 / 動機
目前 `server/index.mjs` 沒有任何身份驗證，`docker-compose.yml` 直接把
`8088:8088` 對外開放。任何能連到這個 port 的人都能讀寫所有任務資料，
甚至觸發 automation（在 host 上 spawn `hermes` CLI 執行任意 prompt）。
這是單人使用專案，絕不能讓其他人存取，需要在應用層加一道簡單、可靠的
存取控制。

## 方案
採用 HTTP Basic Auth，在 Express app 最前面掛一個 middleware，攔截
所有請求（API + 靜態檔案 + SPA fallback），未通過驗證一律回 401。
帳號密碼透過環境變數 `AUTH_USER` / `AUTH_PASS` 注入，不寫死在程式碼、
不進 git。

- 若未設定 `AUTH_USER`/`AUTH_PASS`（例如本機開發情境），middleware
  直接放行並印一次警告 log，避免忘記設定變數就悄悄關掉保護、也避免
  破壞現有本機開發流程。
- 密碼比對使用 timing-safe 比較（`crypto.timingSafeEqual`），避免
  timing attack。
- `docker-compose.yml` 新增 `env_file: .env`（`.env` 加入
  `.gitignore`，並提供 `.env.example` 範本）。

## Task 清單

- [ ] Task 1：在 `server/index.mjs` 加入 Basic Auth middleware
  - 讀取 `process.env.AUTH_USER` / `process.env.AUTH_PASS`
  - 若兩者皆未設定：放行並印一次警告（僅開機時印一次，不要每個
    request 都印）
  - 若有設定：檢查 `Authorization: Basic ...` header，帳密不符或缺少
    一律回 `401` + `WWW-Authenticate: Basic realm="AI Task Board"`
  - middleware 需掛在 `express.json()` 之後、所有路由（含
    `express.static` 與 SPA fallback）之前，確保全站都受保護
  - 帳密比對使用 `crypto.timingSafeEqual`（注意兩個 Buffer 長度需相同，
    否則要先判斷長度避免丟例外）

- [ ] Task 2：Docker / 環境變數配置
  - `docker-compose.yml` 新增 `env_file: .env`
  - 新增 `.env.example`，內容為 `AUTH_USER=` / `AUTH_PASS=` 附註解說明
  - 確認 `.env` 已在 `.gitignore`（若沒有則加入）

- [ ] Task 3：文件更新
  - README.md / README.en.md 補充「首次部署請設定 `.env` 帳密」的
    安裝步驟
  - 提醒使用者密碼建議用高強度亂數字串

- [ ] Task 4：驗證
  - 本機啟動時不設 `AUTH_USER`/`AUTH_PASS` → 確認可正常存取（開發
    模式不受影響）且有印出警告 log
  - 設定 `AUTH_USER`/`AUTH_PASS` 後：
    - 不帶 Authorization header → 回 401
    - 帳密錯誤 → 回 401
    - 帳密正確 → 正常回應（API 與前端頁面皆可存取）
  - `docker compose build && docker compose up` 起服務後，用 curl 驗證
    上述行為在容器內同樣成立

- [ ] Task 5：Plan checkbox 全部打勾後單獨 commit
