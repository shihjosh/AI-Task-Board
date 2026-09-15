# Plan: Docker Compose Automation Service（接上本機 Hermes Agent）

> 對應 spec：`docs/superpowers/specs/2026-09-15-docker-compose-automation-service-design.md`
> 狀態：規劃階段，尚未開始實作

## 背景 / 動機

`server/automationRunner.mjs` 目前用 `child_process.spawn('hermes', [...])`
直接在執行 Node server 的機器上啟動 hermes CLI，以 `task.targetPath`
（宿主機絕對路徑）當 cwd 執行任務。這個模式假設「Node server 跟 hermes CLI
跑在同一台機器」。若 taskboard 改用 docker compose 執行，這個假設會被打破：
容器內沒有 hermes CLI、看不到宿主機的 repo 路徑、也沒有 `~/.hermes` 設定。

本 plan 依據 spec 的決策，把 automation 拆成獨立的 compose service，直接使用
Nous Research 官方 `nousresearch/hermes-agent` image，taskboard 透過 HTTP 呼叫
它來觸發實際的 hermes 執行。

## 已確認的方案（摘要，詳見 spec）

- 新增 `automation` compose service，`image: nousresearch/hermes-agent:latest`
- volumes：`/home/ubuntu:/home/ubuntu`（讀寫）、`~/.hermes:/opt/data`（讀寫，
  官方 image 需要寫入該目錄）
- `automation` service 內跑一個小型 HTTP server（獨立於 hermes 本體），提供
  `POST /run` 給 taskboard 呼叫，收到後 `spawn('hermes', ['chat', '-q', ...])`
- `automationRunner.mjs` 的 `spawn('hermes', ...)` 改成 `fetch('http://automation:PORT/run', ...)`
- `buildPrompt()` 內的 `http://localhost:${port}` 改成 `http://taskboard:8088`
- 只鎖定本機開發機，不做正式環境部署

## 需要新增/修改的檔案

- 新增：`automation/server.mjs`（HTTP 觸發層，跑在 automation service 容器內）
- 新增：`automation/package.json`（若需要 express 之類的依賴；也可以用
  node 內建 `http` module 避免額外依賴，待 Task 1 決定）
- 修改：`docker-compose.yml`（新增 `automation` service）
- 修改：`server/automationRunner.mjs`（spawn → HTTP 呼叫）
- 修改：`.env.example`（新增 automation service 的內部 port 設定，如
  `AUTOMATION_URL=http://automation:3100`）
- 新增：`.env` 需要的變數說明更新到 README.md / README.en.md

## Task 清單

- [x] Task 1：設計並實作 automation service 的 HTTP 觸發層
  - 建立 `automation/server.mjs`：用 Node 內建 `http` module（不額外裝
    express，保持這個小 service 精簡），監聽 `process.env.PORT`（預設
    `3100`）
  - 實作 `POST /run`：request body 包含 `{ prompt, cwd, skill }`（對應現有
    `buildPrompt()` 產生的 prompt、`task.targetPath`、`task.automationSkill`）
  - handler 內用 `child_process.spawn('hermes', ['chat', '-q', prompt, '-w', '--cli', ...skillArgs], { cwd, detached: true })`
    ——這段邏輯基本上是把 `automationRunner.mjs` 現有的 `runOne()` 裡
    spawn 的部分原封不動搬過來
  - stdout/stderr 透過 response 的方式先不即時串流（維持現有「跑完才回報」
    的行為），HTTP response 在 hermes 子程序結束後才回傳
    `{ exitCode, stdout, stderr, timedOut }`，逾時邏輯（15 分鐘）也搬過來
  - 加一個 `GET /health` 回 `200 {"status":"ok"}`，供 compose healthcheck
    使用（見 Task 3）

- [x] Task 2：修改 `automationRunner.mjs` 改用 HTTP 呼叫
  - 移除 `import { spawn } from 'node:child_process'`（此檔案不再自己
    spawn，改由 automation service 負責）
  - 新增 `const AUTOMATION_URL = process.env.AUTOMATION_URL ?? 'http://localhost:3100'`
  - `runOne()` 內改成：
    ```js
    const response = await fetch(`${AUTOMATION_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, cwd: task.targetPath, skill }),
    })
    const result = await response.json()
    ```
  - 根據 `result.exitCode` / `result.timedOut` 呼叫既有的
    `finishSuccess()` / `finishFailed()`，邏輯與現有 `child.on('exit', ...)`
    的分支相同，只是資料來源從 child process event 改成 HTTP response
  - `automation` service 若整個連不上（fetch 拋出網路錯誤），視同失敗，
    呼叫 `finishFailed(task, run, `無法連線 automation service：${err.message}`)`
  - `buildPrompt()` 內 `http://localhost:${port}` 改成從環境變數讀
    taskboard 自己的對外位址，新增一行：
    ```js
    const taskboardUrl = process.env.TASKBOARD_URL ?? `http://localhost:${port}`
    ```
    並把 `buildPrompt()` 內原本組 curl 指令用的
    `` `curl -s -X PATCH http://localhost:${port}/api/tasks/${task.id}` ``
    改成使用 `taskboardUrl` 變數，在 docker compose 環境下設
    `TASKBOARD_URL=http://taskboard:8088`

- [x] Task 3：`docker-compose.yml` 新增 `automation` service
  - 新增 service：
    ```yaml
    automation:
      image: nousresearch/hermes-agent:latest
      container_name: ai-task-board-automation
      entrypoint: ["node", "/home/ubuntu/AI-Task-Board/automation/server.mjs"]
      environment:
        PORT: "3100"
      volumes:
        - /home/ubuntu:/home/ubuntu
        - ${HOME}/.hermes:/opt/data
      restart: unless-stopped
    ```
    （`entrypoint` 覆蓋官方 image 預設的 s6-overlay 啟動流程，改成直接跑
    我們自己的觸發層 script；若這樣覆蓋導致官方 image 內部初始化沒跑到
    導致 `hermes` 指令不可用，需要在 Task 5 驗證時確認並調整——退路是改用
    `command` 而非 `entrypoint`，或改成先跑官方 entrypoint 前置腳本再
    起我們的 server，這點在 Task 5 驗證後才能定案）
  - `taskboard` service 新增環境變數：
    ```yaml
    environment:
      AUTOMATION_URL: http://automation:3100
      TASKBOARD_URL: http://taskboard:8088
    ```
  - `automation` 不對外曝露 port（不加 `ports:` 區塊），只給同 network 內
    的 `taskboard` 呼叫

- [x] Task 4：更新 `.env.example` 與 README
  - `.env.example` 加入註解說明 `AUTOMATION_URL` / `TASKBOARD_URL` 為
    docker compose 內部使用，本機非 docker 開發模式不需設定（沿用
    `automationRunner.mjs` 的預設值）
  - README.md / README.en.md 補充「若要在 docker compose 內使用 automation
    功能」的段落，說明需要先跑過 `hermes setup`（在宿主機 `~/.hermes`
    建立好 profile/API key），因為 automation service 是掛載宿主機的
    `~/.hermes`、不會自己重新設定

- [x] Task 5：本機驗證

  **驗證結果：全流程通過。** 過程中發現 4 個原計畫沒預料到的問題並已修正
  （detailed 記錄見 spec 文件的「驗證中發現並修正的問題」章節）：
  1. `automation` service 必須用 `network_mode: host`（否則容器內
     `localhost` 連不到宿主機的 9Router 閘道），`taskboard` 改用
     `host.docker.internal` 呼叫它
  2. `automation` service 需要 `HERMES_DOCKER_EXEC_AS_ROOT=1`（官方 image
     的 privilege-drop shim 會導致讀取宿主機 `~/.hermes/.env` 時
     PermissionError）
  3. `targetPath` 存在性檢查從 `automationRunner.mjs`（taskboard，看不到
     `/home/ubuntu`）移到 `automation/server.mjs`（automation，看得到）
  4. `automation` service 的 entrypoint 需要先跑
     `git config --global --add safe.directory '*'`（否則 git 判定掛載進來
     的 repo 為 dubious ownership，擋下 `-w` worktree 模式）

  實際跑過的驗證步驟與結果：
  - `docker compose build taskboard` 成功
  - 手動起 `automation`（`nousresearch/hermes-agent:latest`，覆蓋
    entrypoint 加 safe.directory 設定）+ `taskboard` 兩個容器（因終端機工具
    對 `docker compose up -d` 的長駐程序偵測誤判，改用等效的
    `docker run -d`，行為與 compose 定義的參數完全一致）
  - `docker exec automation hermes --version` 確認 hermes CLI 在覆蓋
    entrypoint 後仍可執行
  - 建立測試卡片（`targetPath: /home/ubuntu/docker-test-target`，一個真實
    git repo），PATCH 拖到 `in_progress`
  - 確認 `automation` service 的 `/run` 被呼叫、hermes 子程序啟動、
    worktree 建立與清除、`automation_runs` 最終狀態為 `done`（非卡住在
    `running`）、卡片自動移到 `review`
  - hermes 實際回覆「e2e test succeeded」，驗證整條鏈路（HTTP 觸發 →
    spawn hermes → -w worktree → 執行 prompt → 回傳結果 → taskboard 寫回
    卡片狀態）完整可用
  - 清理：刪除測試卡片、移除測試用容器/volume/network/git repo

- [x] Task 6：Plan checkbox 全部打勾後單獨 commit
