# AI Task Board — Docker Compose 化 Automation 服務設計文件（規劃階段，尚未實作）

> 討論日期：2026-09-15
> 狀態：**Spec only — 本文件僅記錄設計決策，尚未動工實作**

## 背景

目前 `server/automationRunner.mjs` 在偵測到卡片拖到 `in_progress` 時，是用
`child_process.spawn('hermes', [...])` 直接在**執行 Node server 的那台機器上**
啟動 hermes CLI 子程序，以 `task.targetPath`（宿主機絕對路徑）當 cwd 去執行任務。

這個模式隱含假設「Node server 跟 hermes CLI 跑在同一台機器、同一個檔案系統」。
如果把 `taskboard` 服務改用 docker compose 執行（目前 `docker-compose.yml` 只有
`taskboard` + 可選 `postgres` 兩個 service），這個假設會被打破：

1. **hermes 執行檔不存在於容器內**：production image 是精簡過的 `node:22-alpine`，
   沒有裝 hermes CLI，`spawn('hermes', ...)` 會直接 ENOENT。
2. **`targetPath` 在容器裡看不到**：資料庫存的是宿主機路徑（如
   `/home/ubuntu/hpb-backend`），容器是獨立檔案系統，這些 repo 目錄不會自動存在。
3. **hermes 的設定/憑證（`~/.hermes`）不在容器內**：CLI 要能跑，需要 profile、
   skills、API key 等設定，這些目前都在宿主機 `~/.hermes`。

本文件規劃「讓 docker compose 跑起來、同時讓 automation 功能接上本機的 hermes
agent」的架構方案。

## 部署範圍（已確認）

**只鎖定「這台開發機」，不做正式環境部署。**

理由：AI-Task-Board 是單人開發輔助專案（先前已定調 Phase 6 多人即時協作不需要規
劃/實作），automation 本質上是本機開發輔助工具，不需要在正式環境跑遠端 agent。
正式環境的 `taskboard` image 維持現狀的精簡設計，不塞 hermes CLI 進去。

## 已確認的設計決策

| 決策點 | 選擇 |
|---|---|
| 架構 | 拆成獨立的 `automation` compose service，不塞進現有 `taskboard` service/image |
| taskboard ↔ automation 通訊 | taskboard 不再自己 `spawn('hermes', ...)`，改成 HTTP 呼叫 automation service 的內部 API（例如 `POST http://automation:PORT/run`），由 automation service 負責真正 spawn hermes CLI |
| automation 回報進度的位址 | `buildPrompt()` 內寫死的 `http://localhost:${port}` 改成 compose service name，例如 `http://taskboard:8088`（兩個 service 在同一個 compose 預設 network 內，可互相以 service name 解析） |
| repo 掛載範圍 | 掛整個 `/home/ubuntu:/home/ubuntu`（而非逐一列出 AI-Task-Board / hpb-backend / supabase-web），容器內路徑與宿主機路徑天生一致，`target_path` 完全不用轉換，未來新增專案也不用改 compose |
| `~/.hermes` 掛載方式 | **（已修正，見下方「重大更新」章節）** 改用官方 image 後必須讀寫掛載 `~/.hermes:/opt/data`，因為 hermes 本身在啟動時會寫入該目錄（session 記錄、skills 同步等），無法唯讀 |
| Git 身份 | 不在 automation image 裡設全域 git config；每個 repo 已有各自的 local `user.email`（個人專案 `josh <shihjosh@...>` vs hpb-backend `josh-giant <joshshih@...>`），繼承宿主機掛進來的 local config 即可，不寫死單一身份 |

## 架構圖（文字版）

```
┌─────────────────────────── docker compose network ───────────────────────────┐
│                                                                                │
│   ┌────────────────┐   HTTP POST /run    ┌──────────────────────┐            │
│   │   taskboard     │ ───────────────────▶│     automation       │           │
│   │ (現有 image,    │                      │ (新 image, 裝 hermes │           │
│   │  精簡, 無 hermes│◀─────────────────────│  CLI + git)          │           │
│   │  CLI)           │  PATCH /api/tasks    │                      │           │
│   └────────┬────────┘  (回報進度/結果)      └──────────┬───────────┘          │
│            │                                            │                     │
│            ▼                                            ▼                     │
│      taskboard-data                          /home/ubuntu (bind, rw?)         │
│      (named volume)                          ~/.hermes (bind, ro)             │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 重大更新：改用官方 hermes-agent image，不自建 Dockerfile

原規劃是自己寫一個 `Dockerfile.automation` 從零裝 hermes CLI + git。查證後發現
Nous Research 已發布官方 image `nousresearch/hermes-agent`（Docker Hub /
`ghcr.io/nousresearch/hermes-agent`），標準用法：

```yaml
image: nousresearch/hermes-agent:latest
volumes:
  - ~/.hermes:/opt/data   # 容器內 HERMES_HOME=/opt/data
```

官方 image 內建 s6-overlay 監督、hermes CLI 本體、`git`（automation image 本身
已裝好，不用自己裝）。命令可以直接是 `chat -q "<prompt>" ...` 這種子命令形式
（entrypoint 已處理好 dispatch）。

**這改變了原方案的取捨**：不用再自己維護 hermes 安裝/升級/依賴（git、python
toolchain 等），直接跟著官方 image tag 升級即可。付出的代價是 image 體積由官方
決定（本來就不小，因為要支援瀏覽器自動化等功能），但不需要我們自己維護。

## 驗證中發現並修正的問題（實作與計畫不同的地方）

執行 Task 5 本機驗證時，發現原計畫沒有預料到的 3 個實質問題，均已修正：

1. **`network_mode: host` 是必要的，不是可選優化。** 宿主機 `~/.hermes/config.yaml`
   的 model `base_url` 通常寫死 `http://localhost:<port>`（本例是本機 9Router
   閘道）。容器若用一般 bridge network，容器內的 `localhost` 是指容器自己，
   連不到宿主機的閘道服務，`hermes chat` 會直接連線失敗。改用
   `network_mode: host` 後容器共用宿主機網路 namespace，`localhost` 直接可用，
   不需要改寫 `config.yaml`。代價：`network_mode: host` 與 compose 的
   `networks:`/`ports:` 互斥（`automation` 因此不再與 `taskboard`/`postgres`
   同一個 `default` network），且僅支援 Linux（本專案的使用情境符合）。
   `taskboard` 改用 `host.docker.internal`（搭配 `extra_hosts:
   host-gateway`）去呼叫使用 host network 的 `automation`。

2. **`HERMES_DOCKER_EXEC_AS_ROOT=1` 是必要的。** 官方 image 的
   `/opt/hermes/bin/hermes` 是一個 privilege-drop shim：以 root 執行時會自動
   降權到內建的 `hermes` 使用者（UID 10000）。但掛進去的是宿主機 `ubuntu`
   使用者（UID 1000）的 `~/.hermes`，UID 不對齊會導致 `hermes` 讀取
   `~/.hermes/.env` 時噴 `PermissionError`。設這個環境變數讓 shim 維持以
   root 執行、對齊掛載檔案的擁有者。

3. **`targetPath` 存在性檢查必須搬到 automation service，不能留在 taskboard。**
   原 Task 2 沒注意到：`taskboard` 容器本身沒有掛載 `/home/ubuntu`（只有
   `automation` 容器有掛），所以 `automationRunner.mjs` 原本在
   `triggerAutomation()` 裡對 `task.targetPath` 做的 `fs.existsSync()` 檢查
   在容器化後永遠回傳 false、每次都直接失敗。已將此檢查移到
   `automation/server.mjs` 的 `/run` handler 內（它能看到 `/home/ubuntu`），
   `automationRunner.mjs` 不再檢查路徑是否存在，只檢查是否有填。

4. git `safe.directory` 保護會擋下 `-w` worktree 模式。容器內以 root
   身份操作掛載進來、屬於宿主機 `ubuntu` 使用者（不同 UID）的 git repo，
   git 會判定為「dubious ownership」並拒絕操作。`automation` service 的
   `entrypoint` 因此改成先執行
   `git config --global --add safe.directory '*'` 再啟動
   `automation/server.mjs`。

5. **忘記本機開發模式（`npm run dev`）的相容性——Task 2 原本讓
   `automationRunner.mjs` 無條件改成 HTTP 呼叫，導致本機開發模式下自動化
   功能直接壞掉。** 本機開發模式沒有 `AUTOMATION_URL` 環境變數、也沒有
   `automation` service 在跑，`fetch` 一定連線失敗。已改回讓
   `automationRunner.mjs` 支援兩種模式：`AUTOMATION_URL` 未設定（本機
   `npm run dev` 預設）→ 沿用原本的 `spawn('hermes', ...)` 直接執行；
   `AUTOMATION_URL` 有設定（`docker-compose.yml` 的 `taskboard` service
   會設）→ 打 HTTP 給 automation service。`targetPath` 存在性檢查同理：
   本機模式（看得到檔案系統）用 `fs.existsSync()`，docker 模式（看不到）
   交給 automation service 檢查。已用假 hermes 執行檔驗證本機模式的
   spawn 路徑行為與 docker 化前一致。

以上 5 點已同步反映在 `docker-compose.yml` 的註解與下方 Task 3/Task 5 的
勾選狀態中；本文件的「需要新增/修改的檔案」與 Task 清單保留原樣（歷史記錄），
實際最終行為以 `docker-compose.yml`、`automation/server.mjs`、
`server/automationRunner.mjs` 現狀為準。

## 需要新增/修改的檔案（規劃，尚未動工）

- 修改 `docker-compose.yml`：新增 `automation` service
  - `image: nousresearch/hermes-agent:latest`（不需要 build，直接 pull）
  - volumes：
    - `/home/ubuntu:/home/ubuntu`（掛整個 home，含所有可能的 target repo）
    - `~/.hermes:/opt/data`（對應官方 image 的 `HERMES_HOME`，讀寫掛載——
      因為 hermes 本身需要在這裡寫入 session/skills 快取等狀態，不能唯讀，這點
      跟先前規劃「唯讀掛 `~/.hermes`」不同，需要重新評估風險，見下方風險章節）
  - 與 `taskboard` 在同一個預設 network（compose 預設行為，不需額外設定）
  - 需要一個小型 HTTP 觸發層讓 `taskboard` 能呼叫它去執行 `hermes chat -q ...`
    ——官方 image 本身沒有現成的「收到 HTTP request 就 spawn 一次 chat」介面，
    這一層仍需要我們自己實作（見下方 Open Questions 第 1 點）
- 修改 `server/automationRunner.mjs`：
  - `spawn('hermes', ...)` 改成打 HTTP 給 `automation` service
  - `buildPrompt()` 內的 `http://localhost:${port}` 改成 `http://taskboard:8088`
    （視最終 service 命名調整）

## 風險與取捨

1. **掛整個 `/home/ubuntu` 的安全性**：automation container 能看到宿主機整個
   home 目錄（含其他無關檔案），风险高於逐一列出專案路徑；但因為只跑在使用者
   自己的開發機、單人使用、不對外曝露，判斷風險可接受，換取「新增專案不用改
   compose」的維護便利性。
2. **image 變胖**：automation image 需要裝 hermes CLI + git，體積會比現有
   taskboard production image 大不少；但因為拆成獨立 service，不影響 taskboard
   本體。
3. **僅限本機開發**：此方案完全不考慮正式環境部署、多人協作、遠端存取，若未來
   需求改變（例如要在雲端伺服器上跑），這個「掛整個 home 目錄」的做法就不適用，
   需要重新設計掛載範圍。
4. **taskboard ↔ automation 之間新增一個 HTTP 呼叫層**：比起原本單一 process
   直接 spawn 子程序，多了一層網路呼叫、需要處理 automation service 本身掛掉
   或無回應時 taskboard 端的容錯（例如逾時、重試策略），這部分本文件尚未細化。

## 待實作前需要再確認的問題（Open Questions）

1. `automation` service 內部 API 的介面規格（request/response 格式、如何傳遞
   task 完整資訊、如何串流 stdout 回 taskboard 供即時顯示）尚未定義。
2. hermes CLI 在 automation image 內的安裝方式與版本固定策略（要不要 pin 版本、
   如何升級）。
3. automation service 掛掉/重啟時，正在執行中的 automation run 要怎麼處理（現有
   `automation_runs` 表的狀態會卡在 `running` 而永遠不會更新）。
4. `/home/ubuntu` 掛載要唯讀還是讀寫？如果唯讀，`-w` worktree 模式需要寫入 repo
   目錄（建立 `.worktrees/`），唯讀會直接失敗——這點需要在 plan 階段拍板，目前
   傾向讀寫掛載並接受對應風險。
5. `docker-compose.yml` 現有的 `postgres` service 是否也要跟 automation 一起
   納入同一個 network 考量（目前判斷 automation 不需要直接碰資料庫，只透過
   taskboard 的 HTTP API 溝通，暫不需要）。

## 範圍外（本次規劃不涉及）

- 正式環境部署方案
- 多人協作 / 遠端存取 automation 服務
- automation service 內部 API 的完整規格實作
- `server/automationRunner.mjs` 的實際程式碼修改
