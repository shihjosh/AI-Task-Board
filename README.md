# AI Task Board

一個仿照 [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard) 的前端 Kanban 任務看板專案。

## 目前進度

- ✅ **Phase 1**：純前端、無後端的靜態看板 UI（React + Vite + Tailwind + dnd-kit），使用 mock 資料
- ✅ **Phase 2**：任務 CRUD + SQLite 後端持久化，資料不再因重新整理而消失
- ✅ Phase 3：任務詳情（Markdown 描述、留言系統）
- ⏳ Phase 4：多視圖（列表 / 甘特圖）、標籤篩選、搜尋
- ⏳ Phase 5（可選）：即時多人同步（SSE/WebSocket）

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

三欄式 Kanban：
- **等待認領**（To Do）
- **處理中**（In Progress）
- **等你確認**（Review / Pending Approval）

## 新增與編輯任務

- 點擊右上角「新增任務」按鈕，從右側滑出表單，填寫標題（必填）、優先級、欄位、標籤（可複選）、負責人（可複選）、進度後建立
- 點擊任一任務卡片，開啟同一個表單進行編輯，可修改欄位或刪除該任務（刪除前會有確認提示）
- 標籤與負責人皆為固定選單（不開放自由輸入新增選項）

## 任務詳情

- 編輯任務時，Drawer 會顯示「描述」欄位，支援 Markdown 語法（標題、清單、表格、程式碼區塊等），採左右雙欄即時預覽
- 編輯任務時，Drawer 下方會顯示「留言」區塊，可新增/編輯/刪除留言（刪除前會有確認提示），留言固定顯示作者為「Josh」
- 新增任務（尚未建立）時不會顯示留言區塊，需先建立任務後才能留言

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
```

**驗證規則：**
- `priority` 僅接受 `high` / `medium` / `low`，其他值回 `400`
- `columnId` 僅接受 `todo` / `in_progress` / `review`，其他值回 `400`
- `progress` 若提供，必須是 `0` 到 `100` 之間的數字，其他值回 `400`
- `title` 若提供，長度不可超過 500 字元
- `description` 若提供，長度不可超過 50000 字元
- 留言 `content` 長度不可超過 5000 字元，且不可為空白
- 請求 body 大小上限為 1MB，超過回 `413`
- `POST`/`PATCH` 皆採白名單方式只接受既定欄位（`title, priority, tags, assignees, progress, commentCount, hasUnread, columnId, description`），多餘欄位（如客戶端夾帶的 `id`）會被忽略，不會覆蓋伺服器產生的值
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
│   └── seed.mjs
├── src/
│   ├── components/
│   ├── data/
│   ├── lib/
│   │   └── api.ts
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
