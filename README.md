# AI Task Board

繁體中文 | [English](README.en.md)

一個結合傳統 Kanban 看板與 AI Agent 自動執行能力的任務管理工具：可以用它排程、追蹤任務，也可以直接把某張任務卡交給 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 在隔離的 git worktree 中自動動手完成。

- 📋 三欄看板（等待認領／處理中／等你確認）+ 已完成頁面，支援拖拉、手機版
- 📝 任務詳情：Markdown 描述、留言、優先級、標籤、負責人、預計完成日期
- 🔍 搜尋、標籤篩選、列表視圖、甘特圖
- 🌓 明亮／黑暗模式
- 🤖 Hermes Agent 自動化執行：卡片拖到「處理中」即可觸發 AI agent 在獨立 worktree 中實際完成任務並自動 push 分支

完整操作說明另見 **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**（給不需要懂程式碼的一般使用者）。本檔案聚焦在安裝、開發、部署。

![AI Task Board 看板畫面](docs/images/task_board.webp)

---

## 安裝

### 需求

- Node.js 22 以上
- npm

### 步驟

```bash
git clone <此 repo 的 URL>
cd AI-Task-Board
npm install

# 首次啟動前，先建立 SQLite 資料庫並灌入種子資料
npm run db:seed
```

### 啟動（本機開發模式）

```bash
npm run dev
```

啟動後：
- 前端（Vite dev server，含 HMR）：http://localhost:8088
- 後端 API server：http://localhost:3001（前端透過 Vite proxy 轉發 `/api` 請求，不需要另外開瀏覽器分頁）

`npm run dev` 底層用 `concurrently` 同時執行 `npm run dev:client`（Vite）與 `npm run dev:server`（`node --watch server/index.mjs`，檔案變更會自動重啟）。也可以分別在不同 terminal 手動執行這兩個指令。

停止服務：在執行 `npm run dev` 的終端機按 `Ctrl+C`，或用工具/系統管理員終止該背景程序。

### 用 Docker 部署

**⚠️ 部署前請先設定登入帳密。** 這個服務預設不對外做任何身份驗證，一旦部署到
非 localhost 的環境（公網、內網共用主機等），任何知道網址的人都能讀寫所有
任務資料。請先建立 `.env`：

```bash
cp .env.example .env
# 編輯 .env，設定 AUTH_USER 與高強度密碼 AUTH_PASS（建議：openssl rand -base64 24）
```

若 `.env` 中的 `AUTH_USER` / `AUTH_PASS` 留空，伺服器會停用驗證並在啟動 log
印出警告——僅適合在完全本機、無對外風險的開發情境使用。

```bash
docker compose up -d --build
```

服務啟動後可於 `http://localhost:8088` 存取，瀏覽器會跳出帳號密碼輸入框
（HTTP Basic Auth）。前端頁面與 `/api/*` 由同一個 port 提供，單一 Node
service，不需要額外 nginx。SQLite 資料庫存放在 named volume
`taskboard-data:/app/.data`，container 重啟/重建後資料不會遺失。

**首次啟動後灌入種子資料：**

```bash
docker compose exec taskboard node server/seed.mjs
```

> `npm run db:seed`（本機開發模式用）跟這個指令不能混用——本機模式寫入主機上的 `.data/taskboard.sqlite`，Docker 模式的資料庫檔案在 container 的 volume 裡，必須用 `docker compose exec` 讓 seed script 在容器內執行才能寫進同一份資料庫。此指令是冪等的，已有資料時重跑不會重複灌入。

> **本機開發模式（`npm run dev` / `npm start`）不受影響**：`automationRunner.mjs`
> 是雙模式設計，未設定 `AUTOMATION_URL` 時會直接 `spawn` 呼叫本機安裝的
> `hermes` CLI，行為與加入 Docker automation 功能之前完全相同。只有 Docker
> compose 模式（`docker-compose.yml` 的 `taskboard` service 有設定
> `AUTOMATION_URL`）才會改成呼叫下方的 `automation` service。
>
> **Docker 模式下的 Hermes Agent 自動化執行功能**：需要額外啟用 `automation`
> service（拉取 Nous Research 官方 `nousresearch/hermes-agent` image，掛載
> `/home/ubuntu` 與宿主機的 `~/.hermes`），詳見下方「Docker 模式啟用自動化執行
> 功能」段落。若不啟用該 service，卡片拖到 `in_progress` 時觸發自動化會因為
> 連不上 `automation` 而直接標記為失敗，不影響看板其餘功能。

### Docker 模式啟用自動化執行功能（選用）

`docker-compose.yml` 內建了 `automation` service，讓 Docker 模式下的
`taskboard` 也能觸發真正的 Hermes Agent 執行任務（不只是本機 `npm run dev`
才能用）。這個 service 直接使用官方 `nousresearch/hermes-agent` image，並
掛載：
- 整個 `/home/ubuntu`（讓 automation 能存取卡片 `targetPath` 指定的任何專案
  目錄）
- 宿主機的 `~/.hermes`（讀寫掛載——hermes 執行時需要在這裡寫入 session/skills
  快取，因此必須是讀寫，不能唯讀）

`automation` service 還設定了兩個本機驗證後確認必要的項目，皆已內建在
`docker-compose.yml` 裡，不需要手動處理：
- **`network_mode: host`**：讓容器內的 `localhost` 直接等於宿主機的
  `localhost`，才能連到宿主機 `~/.hermes/config.yaml` 裡設定的本機模型閘道
  （例如自架的 9Router）。因此 `taskboard` 是透過 `host.docker.internal`
  （而非 compose service name）呼叫 `automation`。這個模式僅支援 Linux。
- **`HERMES_DOCKER_EXEC_AS_ROOT=1`**：官方 image 預設會把以 root 執行的
  `hermes` 指令自動降權到內建的 `hermes` 使用者（UID 10000），但掛載進來的
  `~/.hermes` 屬於宿主機使用者（通常 UID 1000），UID 不一致會導致讀取
  `~/.hermes/.env` 時發生權限錯誤，故關閉此降權行為。
- entrypoint 啟動時會先執行 `git config --global --add safe.directory '*'`，
  避免 git 因為掛載進來的 repo 擁有者 UID 與容器內執行者不同，判定為
  「dubious ownership」而拒絕操作（會擋下 `-w` worktree 模式）。

**前置需求**：宿主機必須先跑過 `hermes setup` 完成過一次設定（profile、
API key 等），因為 `automation` service 只是掛載既有的 `~/.hermes`，不會
自己重新設定。

啟動方式：

```bash
docker compose up -d --build
```

`docker-compose.yml` 沒有把 `automation` 設成 `profiles`，預設就會跟著
`taskboard` 一起啟動。若不需要自動化功能、想省資源，可以只啟動
`taskboard`：`docker compose up -d --build taskboard`。

**注意事項與限制**：
- 僅限本機開發機使用。`automation` service 掛載整個 `/home/ubuntu` 目錄，
  容器內能看到宿主機 home 目錄下的所有檔案，不建議部署到共用主機或正式環境。
- 卡片的 `targetPath` 欄位填入的路徑，必須是 `/home/ubuntu` 底下、容器內外
  都存在的絕對路徑（因為掛載方式是把整個 `/home/ubuntu` bind mount 到容器內
  相同路徑，例如 `/home/ubuntu/AI-Task-Board`）。
- 已完整驗證過端到端流程（建卡 → 拖到 in_progress → automation service 觸發
  hermes chat -w → worktree 建立/清除 → 卡片自動移到 review），詳細架構決策
  與驗證中發現的問題見
  `docs/superpowers/specs/2026-09-15-docker-compose-automation-service-design.md`。

### 切換到 PostgreSQL（選用）

預設資料庫是 SQLite（`.data/taskboard.sqlite`），不需要任何額外設定。若想改用
PostgreSQL：

1. 在 `.env` 設定：

   ```bash
   DB_DRIVER=postgres
   DATABASE_URL=postgres://taskboard:taskboard@postgres:5432/taskboard
   ```

   （若接外部/現有的 Postgres，把 `DATABASE_URL` 換成該資料庫的連線字串即可，
   不需要用到下方的內建 postgres service）

2. 若要用 `docker-compose.yml` 內建的 Postgres 服務做本機測試：

   ```bash
   docker compose up -d postgres
   docker compose up -d --build taskboard
   ```

   `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` 可在 `.env` 中調整，
   需與 `DATABASE_URL` 中的帳密/資料庫名稱一致。

3. Table 與欄位會在伺服器啟動時自動建立/檢查（跟 SQLite 版行為一致），
   不需要手動跑 migration。`npm run db:seed` 會依 `DB_DRIVER` 自動寫入
   對應的資料庫。

若未設定 `DB_DRIVER`（或設為 `sqlite`），行為與過去完全相同。

---

## 使用

### 基本操作

- **新增/編輯任務**：點擊右上角「新增任務」，或直接點任一任務卡片，填寫標題（必填）、優先級、欄位、標籤、負責人、進度、預計完成日期後儲存。
- **拖拉換欄**：桌面版直接拖拉卡片；手機版（螢幕寬度 < 640px）用卡片上的「移動到...」下拉選單代替拖拉。
- **多視圖的手機適配**：手機寬度（< 640px）下「列表視圖」改為卡片堆疊呈現（取代橫向捲動表格）；「甘特圖」改為依「預計完成日期」排序的簡易清單（時間軸格線僅在桌面寬度顯示，窄螢幕上不適合閱讀）。
- **標記已完成**：把卡片拖到看板底部「拖曳到這裡標記為已完成」長條，或在編輯表單把「欄位」改選「已完成」。已完成的任務會移到獨立的「已完成」頁面，不佔用看板版面。
- **Markdown 描述**：任務詳情的「描述」欄位支援標題、清單、表格、程式碼區塊等 Markdown 語法，可切換「編輯／預覽」頁籤查看渲染結果。
- **留言**：任務詳情下方「留言」頁籤可新增/編輯/刪除留言，方便記錄討論過程。
- **搜尋與篩選**：Toolbar 的搜尋框比對任務標題即時過濾；標籤篩選面板可複選多個標籤（符合任一標籤即顯示）。
- **多視圖**：Toolbar 可切換「議題看板」（預設拖拉看板）、「列表視圖」（表格形式，含已完成任務）、「甘特圖」（依建立日期到預計完成日期畫出時間軸，僅顯示有填「預計完成日期」的任務）。
- **明亮／黑暗模式**：Toolbar 左側太陽/月亮圖示手動切換，選擇會記住在瀏覽器（不跟隨系統設定）。

### Hermes Agent 自動化執行

這是本專案最核心的差異化功能：把一張任務卡交給 AI agent 實際動手完成，而不只是紀錄待辦事項。

1. 編輯任務時填入「**自動執行目錄**」（`targetPath`，一個本機 git repo 的絕對路徑），選填「**自動執行使用的 Skill**」（讓 Hermes agent 載入特定技能）。
2. 把該卡片拖到（或 PATCH 改成）「**處理中**」欄位，即觸發自動執行。
3. 後端會在該目錄下以獨立的 **git worktree** 執行 `hermes chat`，agent 會實際修改程式碼、執行指令，完成後自動 commit 並 push 分支到 `origin`（**不會自動開 PR**，PR 與 merge 一律由你自己到 GitHub 網頁進行）。
4. 執行過程即時串流輸出到任務詳情的「**執行紀錄**」頁籤，執行中會每 2 秒自動刷新；執行完成後卡片自動移到「等你確認」欄位（成功）或停留在原欄位（失敗）。若同一時間已有其他任務在執行，卡片會先顯示「**排隊中**」，等前面的任務結束後才會實際開始執行。

**限制**：同一時間全系統只會執行 1 個自動化任務（其餘排隊，依優先級排序），每次執行上限 15 分鐘，且只在有安裝 `hermes` CLI 的主機環境可用（見上方 Docker 限制說明）。

**當機/重啟復原**：伺服器重啟時，若偵測到有任務停留在「執行中」或「排隊中」狀態（因伺服器重啟或程序中斷而中途卡住，狀態不明），會自動標記為「**執行中斷**」，並在任務詳情提供「重試」或「放棄」按鈕，避免卡片永遠卡在看似執行中但實際已經沒有程序在跑的狀態。

完整操作細節、螢幕截圖範例請見 **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**。

---

## API

```
GET    /api/tasks           取得所有任務
POST   /api/tasks           新增任務
PATCH  /api/tasks/:id       更新任務（含拖拉換欄位時更新 columnId）
DELETE /api/tasks/:id       刪除任務
GET    /api/tasks/:taskId/comments   取得指定任務的所有留言
POST   /api/tasks/:taskId/comments   新增留言
PATCH  /api/comments/:id             編輯留言
DELETE /api/comments/:id             刪除留言
GET    /api/tasks/:taskId/automation-runs   取得指定任務的所有 Hermes 執行紀錄（唯讀，無寫入端點）
GET    /api/skills                          取得可用的 Hermes skill 名稱清單
```

**驗證規則：**
- `priority` 僅接受 `high` / `medium` / `low`，其他值回 `400`
- `columnId` 僅接受 `todo` / `in_progress` / `review` / `done`，其他值回 `400`
- `progress` 若提供，必須是 `0` 到 `100` 之間的數字，其他值回 `400`
- `title` 若提供，長度不可超過 500 字元
- `description` 若提供，長度不可超過 50000 字元
- 留言 `content` 長度不可超過 5000 字元，且不可為空白
- 請求 body 大小上限為 1MB，超過回 `413`
- `POST`/`PATCH` 皆採白名單方式只接受既定欄位，多餘欄位（如客戶端夾帶的 `id`）會被忽略，不會覆蓋伺服器產生的值
- 找不到指定 `id` 的 `PATCH`/`DELETE` 回 `404`
- 未預期的伺服器錯誤統一回 `500`（不含 stack trace，詳細錯誤僅記錄於伺服器端 console）

## 技術棧

**前端**：React + Vite + TypeScript + Tailwind CSS、react-router-dom、@dnd-kit/core（拖拉）、lucide-react（圖示）、react-markdown + remark-gfm（Markdown 渲染）

**後端**：Node.js + Express（`/api/*` REST + serve 前端靜態檔，單一 server）；資料庫預設 SQLite（better-sqlite3，檔案於 `.data/taskboard.sqlite`），亦可選用 PostgreSQL（`pg`，見上方「切換到 PostgreSQL」章節），透過統一的 async 資料層（`server/db/`）切換

## 專案結構

```
AI-Task-Board/
├── docs/
│   ├── USER_GUIDE.md            一般使用者操作手冊（繁中）
│   ├── USER_GUIDE.en.md         一般使用者操作手冊（英文）
│   ├── spec.md
│   └── superpowers/            開發過程的 spec/plan 存檔
├── server/
│   ├── index.mjs               Express app 與所有 route
│   ├── db/
│   │   ├── index.mjs            依 DB_DRIVER 選擇驅動的統一 async 查詢介面
│   │   ├── sqlite.mjs           SQLite schema 與 migration（預設驅動）
│   │   └── postgres.mjs         PostgreSQL schema 與 migration（選用驅動）
│   ├── taskRepository.mjs
│   ├── commentRepository.mjs
│   ├── automationRunner.mjs    Hermes agent spawn 邏輯
│   ├── automationRunRepository.mjs
│   ├── skillsRepository.mjs    掃描 ~/.hermes/skills
│   └── seed.mjs
├── src/
│   ├── components/              TaskDrawer / BoardColumn / TaskCard / ListView / GanttView …
│   ├── contexts/ThemeContext.tsx
│   ├── data/                    固定選項（標籤/負責人/欄位）
│   ├── lib/                     各 API client（api.ts / commentsApi.ts / automationRunsApi.ts / skillsApi.ts）
│   ├── types/task.ts
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── Dockerfile
└── docker-compose.yml
```

## 致謝

看板設計靈感參考自 [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard)。

## 授權

本專案採用 [MIT License](./LICENSE) 授權。
