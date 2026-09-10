# AI Task Board

一個仿照 [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard) 的前端 Kanban 任務看板專案。

## 目前進度

- ✅ **Phase 1**：純前端、無後端的靜態看板 UI（React + Vite + Tailwind + dnd-kit），使用 mock 資料
- ✅ **Phase 2**：任務 CRUD + SQLite 後端持久化，資料不再因重新整理而消失
- ✅ Phase 3：任務詳情（Markdown 描述、留言系統）
- ✅ Phase 4：Hermes Agent 自動化執行（卡片拖到「處理中」時背景觸發 Hermes agent 動手執行任務）
- ⏳ Phase 5（可選）：多視圖（列表 / 甘特圖）、標籤篩選、搜尋
- ⏳ Phase 6（可選）：即時多人同步（SSE/WebSocket）

詳見分期規劃與功能盤點：[docs/superpowers/specs/2026-09-07-phase2-sqlite-backend-design.md](docs/superpowers/specs/2026-09-07-phase2-sqlite-backend-design.md)

## 技術棧

**前端**
- React + Vite
- TypeScript
- Tailwind CSS
- @dnd-kit/core（拖拉互動）
- lucide-react（圖示）
- react-markdown + remark-gfm（Markdown 描述渲染）

**後端（Phase 2 起）**
- Node.js + Express（提供 `/api/*` REST 端點，並直接 serve 前端靜態檔，單一 server 不需要額外 nginx）
- SQLite（better-sqlite3）作為輕量級持久化資料庫，資料庫檔案存於 `.data/taskboard.sqlite`

詳細規格請見 [docs/spec.md](docs/spec.md)。

## 看板設計

四欄式 Kanban，整體在頁面中水平置中顯示：
- **等待認領**（To Do）
- **處理中**（In Progress）
- **等你確認**（Review / Pending Approval）
- **已完成**（Done）——確認過的任務可從「等你確認」拖過來這裡封存

「已完成」欄位可折疊/展開（點擊欄位標題列右側的圖示按鈕），折疊狀態存在瀏覽器 `localStorage`（key: `taskboard.doneColumnCollapsed`），重新整理頁面後會維持上次的展開/收合選擇。折疊時該欄的卡片列表會暫時無法作為拖放目標，需先展開才能把卡片拖進去。

### 手機版響應式佈局

螢幕寬度 **< 640px**（Tailwind `sm` 斷點）時，看板自動切換為手機模式：

- 改為單欄顯示，畫面上方是一列可橫向捲動的欄位標籤（顯示各欄位名稱與任務數量），點擊標籤切換目前顯示哪一欄。
- 任務卡片上會多出一個「移動到...」下拉選單（取代拖拉），選單只列出除目前所在欄位外的其他欄位，選擇後立即透過 API 更新該任務的欄位。
- 桌面寬度（**≥ 640px**）行為完全不變：維持多欄橫向排列、拖拉換欄、「已完成」欄折疊功能皆照舊。
- 響應式切換全部用 Tailwind CSS class（`hidden sm:flex` / `flex sm:hidden`）完成，不依賴 JS 偵測視窗寬度。

## 新增與編輯任務

- 點擊右上角「新增任務」按鈕，從右側滑出表單，填寫標題（必填）、優先級、欄位、標籤（可複選）、負責人（可複選）、進度後建立
- 點擊任一任務卡片，開啟同一個表單進行編輯，可修改欄位或刪除該任務（刪除前會有確認提示）
- 標籤與負責人皆為固定選單（不開放自由輸入新增選項）

## 任務詳情

- 編輯任務時，Drawer 會顯示「描述」欄位，支援 Markdown 語法（標題、清單、表格、程式碼區塊等），採「編輯／預覽」頁籤切換顯示（而非左右並排）
- 編輯任務時，Drawer 下方會顯示「留言／執行紀錄」頁籤：
  - 「留言」頁籤可新增/編輯/刪除留言（刪除前會有確認提示），留言固定顯示作者為「Josh」
  - 「執行紀錄」頁籤唯讀顯示該任務所有 Hermes 自動執行紀錄（見下方「Hermes Agent 自動化執行」章節），若有執行中的紀錄，頁籤旁會顯示小圓點提示
- 新增任務（尚未建立）時不會顯示這兩組頁籤，需先建立任務後才能使用

## Hermes Agent 自動化執行（Phase 4）

- 每張任務卡可選填「自動執行目錄」（`targetPath`，絕對路徑），指向本機某個專案/repo。
- 當卡片被拖曳（或 PATCH）使 `columnId` 從其他狀態變為 `in_progress`，且該卡已填 `targetPath` 時，後端會在該目錄下背景 spawn 一個 `hermes chat -q` 子程序，根據卡片標題與描述實際動手執行任務。
- `automationStatus` 狀態機：`idle → running → done | failed`
  - `done`：執行成功（exit code 0），卡片自動移到「等你確認」（`review`）欄位。
  - `failed`：非 0 結束代碼、逾時，或 `targetPath` 無效／不存在，卡片停留在原欄位，**不會**自動移到 `review`。
- 每次自動執行的完整過程（prompt、輸出、錯誤、開始/結束時間）都記錄在獨立的 `automation_runs` 資料表，透過 TaskDrawer 的「執行紀錄」頁籤查看，**不會**寫入留言（`comments`），避免與使用者手動留言混雜。
- 執行中的卡片在看板上會顯示旋轉圖示與「Hermes 執行中」文字。
- **重複觸發防護**：`automationStatus` 為 `running` 時，再次拖回 `in_progress`會被靜默忽略，不會產生第二個程序。
- **逾時**：每次執行上限 15 分鐘，超過會被強制中止並視為失敗。
- **併發上限**：全系統同一時間只執行 **1** 個 Hermes 程序（正在執行的先跑完，才輪到下一個），超過上限的觸發會排進記憶體內的佇列；此佇列**不會持久化**，伺服器重啟會遺失所有已排隊但尚未啟動的自動執行任務。
- **佇列排序**：等待中的任務依**優先級**（`high` > `medium` > `low`）排序，優先級高的先執行；同優先級之間依加入佇列的先後順序執行（穩定排序），不是單純先到先執行的 FIFO。
- **即時進度回報**：若任務描述包含明確的執行步驟（例如「Step 1」「Step 2」等清單），Hermes 子代理在執行過程中會被要求每完成一個步驟就呼叫 `PATCH /api/tasks/:id` 即時更新 `progress` 欄位。這是 prompt 層級的軟性指示，不保證子代理一定會照做——若未回報，`progress` 就不會變化，但不影響任務本身的執行與最終完成狀態。
- **已知限制**：`hermes` CLI 是在**執行 API server 的主機**上執行，並非在 app 的 Docker 容器內執行。此功能目前僅適用於直接在有安裝 `hermes` CLI 的主機上以 `npm run dev:server` / `npm start` 執行 API server，尚未接上 Dockerized 部署路徑（`docker compose up`）。

## API（Phase 2 起）

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
```

**驗證規則：**
- `priority` 僅接受 `high` / `medium` / `low`，其他值回 `400`
- `columnId` 僅接受 `todo` / `in_progress` / `review`，其他值回 `400`
- `progress` 若提供，必須是 `0` 到 `100` 之間的數字，其他值回 `400`
- `title` 若提供，長度不可超過 500 字元
- `description` 若提供，長度不可超過 50000 字元
- 留言 `content` 長度不可超過 5000 字元，且不可為空白
- 請求 body 大小上限為 1MB，超過回 `413`
- `POST`/`PATCH` 皆採白名單方式只接受既定欄位（`title, priority, tags, assignees, progress, commentCount, hasUnread, columnId, description, targetPath, automationStatus`），多餘欄位（如客戶端夾帶的 `id`）會被忽略，不會覆蓋伺服器產生的值
- 找不到指定 `id` 的 `PATCH`/`DELETE` 回 `404`
- 未預期的伺服器錯誤統一回 `500`（不含 stack trace，詳細錯誤僅記錄於伺服器端 console）

## 開發

```bash
npm install

# 首次啟動前，先建立 SQLite 資料庫並灌入種子資料
npm run db:seed

# 同時啟動前端（Vite dev server）與後端（Node API server）
npm run dev
```

`npm run dev` 底層透過 `concurrently` 同時執行：
- `npm run dev:client`：Vite dev server，前端 HMR
- `npm run dev:server`：`node --watch server/index.mjs`，Node API server，並隨檔案變更自動重啟

也可以分別在不同 terminal 手動執行 `npm run dev:server` 與 `npm run dev:client`（即 `npm run dev` 的展開版本）。

前端會透過 Vite proxy 將 `/api` 請求轉發到後端；正式環境（`npm run start` 或 Docker）則是單一 Node server 同時 serve 靜態檔與 API。

## Docker

```bash
docker compose up -d --build
```

服務啟動後可於 `http://localhost:8088` 存取（前端頁面與 `/api/*` 皆由同一個 port 提供）。

- 單一 Node service（`taskboard`），同時提供靜態檔與 API
- 掛載 named volume `taskboard-data:/app/.data`，讓 SQLite 資料庫檔案（`.data/taskboard.sqlite`）在 container 重啟 / 重建後仍然保留

**首次啟動後灌入種子資料：**

```bash
docker compose exec taskboard node server/seed.mjs
```

> 注意：`npm run db:seed`（見上方「開發」章節）只適用於本機開發模式，因為它寫入的是主機上的 `.data/taskboard.sqlite`。Docker 模式下資料庫檔案在 container 內的 volume 裡，必須用 `docker compose exec` 讓 seed script 在容器內執行才能寫入同一份資料庫。
>
> 此指令是冪等的：已有資料時重跑會印出 `Tasks table already has data, skipping seed.`，不會重複灌入。

## 專案結構

```
AI-Task-Board/
├── docs/
│   ├── spec.md
│   └── superpowers/
│       └── specs/
│           └── 2026-09-07-phase2-sqlite-backend-design.md
├── server/
│   ├── index.mjs
│   ├── db.mjs
│   ├── taskRepository.mjs
│   ├── commentRepository.mjs
│   ├── automationRunner.mjs
│   ├── automationRunRepository.mjs
│   └── seed.mjs
├── src/
│   ├── components/
│   │   ├── TaskDrawer.tsx
│   │   ├── CommentList.tsx
│   │   ├── AutomationRunList.tsx
│   │   └── ...
│   ├── data/
│   ├── lib/
│   │   ├── api.ts
│   │   ├── commentsApi.ts
│   │   └── automationRunsApi.ts
│   ├── types/
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── Dockerfile
└── docker-compose.yml
```

## 授權

Private project.
