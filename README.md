# AI Task Board

繁體中文 | [English](README.en.md)

一個結合傳統 Kanban 看板與 AI Agent 自動執行能力的任務管理工具：可以用它排程、追蹤任務，也可以直接把某張任務卡交給 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 在隔離的 git worktree 中自動動手完成。

- 📋 三欄看板（等待認領／處理中／等你確認）+ 已完成頁面，支援拖拉、手機版
- 📝 任務詳情：Markdown 描述、留言、優先級、標籤、負責人、預計完成日期
- 🔍 搜尋、標籤篩選、列表視圖、甘特圖
- 🌓 明亮／黑暗模式
- 🤖 Hermes Agent 自動化執行：卡片拖到「處理中」即可觸發 AI agent 在獨立 worktree 中實際完成任務並自動 push 分支

完整操作說明另見 **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**（給不需要懂程式碼的一般使用者）。本檔案聚焦在安裝、開發、部署。

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

```bash
docker compose up -d --build
```

服務啟動後可於 `http://localhost:8088` 存取（前端頁面與 `/api/*` 由同一個 port 提供，單一 Node service，不需要額外 nginx）。SQLite 資料庫存放在 named volume `taskboard-data:/app/.data`，container 重啟/重建後資料不會遺失。

**首次啟動後灌入種子資料：**

```bash
docker compose exec taskboard node server/seed.mjs
```

> `npm run db:seed`（本機開發模式用）跟這個指令不能混用——本機模式寫入主機上的 `.data/taskboard.sqlite`，Docker 模式的資料庫檔案在 container 的 volume 裡，必須用 `docker compose exec` 讓 seed script 在容器內執行才能寫進同一份資料庫。此指令是冪等的，已有資料時重跑不會重複灌入。

> **已知限制**：Hermes Agent 自動化執行功能（見下方）需要在**執行 API server 的主機**上安裝並可直接呼叫 `hermes` CLI。目前 Docker 部署的 container 內沒有安裝 `hermes`，因此 Docker 模式下無法使用自動化執行功能，僅適用於直接在主機上用 `npm run dev` / `npm start` 執行 API server 的情境。

---

## 使用

### 基本操作

- **新增/編輯任務**：點擊右上角「新增任務」，或直接點任一任務卡片，填寫標題（必填）、優先級、欄位、標籤、負責人、進度、預計完成日期後儲存。
- **拖拉換欄**：桌面版直接拖拉卡片；手機版（螢幕寬度 < 640px）用卡片上的「移動到...」下拉選單代替拖拉。
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
4. 執行過程即時串流輸出到任務詳情的「**執行紀錄**」頁籤，執行中會每 2 秒自動刷新；執行完成後卡片自動移到「等你確認」欄位（成功）或停留在原欄位（失敗）。

**限制**：同一時間全系統只會執行 1 個自動化任務（其餘排隊，依優先級排序），每次執行上限 15 分鐘，且只在有安裝 `hermes` CLI 的主機環境可用（見上方 Docker 限制說明）。

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

**後端**：Node.js + Express（`/api/*` REST + serve 前端靜態檔，單一 server）、SQLite（better-sqlite3），資料庫檔案於 `.data/taskboard.sqlite`

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
│   ├── db.mjs                  SQLite schema 與 migration
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

Private project.
