# AI Task Board

一個仿照 [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard) 的前端 Kanban 任務看板專案。

## 目前進度

- ✅ **Phase 1**：純前端、無後端的靜態看板 UI（React + Vite + Tailwind + dnd-kit），使用 mock 資料
- 🚧 **Phase 2**（設計完成，開發中）：任務 CRUD + SQLite 後端持久化，讓資料不再因重新整理而消失
- ⏳ Phase 3：任務詳情（Markdown 描述、留言系統）
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

**後端（Phase 2 起）**
- Node.js + Express（提供 `/api/*` REST 端點，並直接 serve 前端靜態檔，單一 server 不需要額外 nginx）
- SQLite（better-sqlite3）作為輕量級持久化資料庫，資料庫檔案存於 `.data/taskboard.sqlite`

詳細規格請見 [docs/spec.md](docs/spec.md)。

## 看板設計

三欄式 Kanban：
- **等待認領**（To Do）
- **處理中**（In Progress）
- **等你確認**（Review / Pending Approval）

## API（Phase 2 起）

```
GET    /api/tasks           取得所有任務
POST   /api/tasks           新增任務
PATCH  /api/tasks/:id       更新任務（含拖拉換欄位時更新 columnId）
DELETE /api/tasks/:id       刪除任務
```

## 開發

**Phase 1（目前，純前端）**
```bash
npm install
npm run dev
```

**Phase 2 起（前後端）**
- 開發模式：Vite dev server（前端 HMR，port 8088）+ 獨立 Node API server（port 3001），
  Vite proxy `/api` 轉發到後端
- 正式 / Docker 模式：單一 Node server 監聽 8088，同時 serve 靜態檔與 API

## Docker

```bash
docker compose up -d --build
```

- Phase 1：nginx 提供靜態檔案服務
- Phase 2 起：改為單一 Node service，同時提供靜態檔與 API，並掛載 `.data/` volume 以持久化 SQLite 資料庫

## 專案結構

```
AI-Task-Board/
├── docs/
│   ├── spec.md
│   └── superpowers/
│       └── specs/
│           └── 2026-09-07-phase2-sqlite-backend-design.md
├── src/
│   ├── components/
│   ├── data/
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
