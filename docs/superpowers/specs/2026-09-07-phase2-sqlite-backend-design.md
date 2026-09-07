# AI Task Board — Phase 2 設計文件：後端持久化（SQLite + Node API）

> 討論日期：2026-09-07
> 參考來源：https://github.com/chuspeeism/dashi-taskboard/blob/main/README.zh-CN.md

## 背景

Phase 1 完成了純前端靜態 Kanban 看板（React + Vite + Tailwind + dnd-kit），使用 `mockTasks.ts`
硬編資料，重新整理頁面資料就消失。本階段目標是加上真正的資料持久化，讓任務可以新增/編輯/
刪除並保留下來，同時盡量保持 POC 的輕量與簡單（YAGNI）。

## 對照 dashi-taskboard 的功能盤點與分期規劃

原專案（dashi-taskboard / Codex Taskboard）是一個很重的 Codex 桌面插件工具，完整功能對照與
相關性評估如下：

| 分類 | 功能 | 與本專案相關性 |
|---|---|---|
| 核心 | Task/Issue CRUD（標題/描述/狀態/優先級/標籤） | 高（Phase 2 必要） |
| 核心 | 本地 HTTP API + SQLite 持久化 | 高（Phase 2 必要） |
| 核心 | 拖拉看板換欄位、排序 | 已完成（Phase 1，前端） |
| 進階 | 多視圖切換（Dashboard / List / Gantt） | 中（Phase 4） |
| 進階 | 任務描述 GFM Markdown 渲染 + mermaid 圖 | 中（Phase 3） |
| 進階 | 留言/評論系統 | 中（Phase 3） |
| 進階 | 附件上傳 | 低（暫不排入） |
| 協作 | SSE/WebSocket 即時多人同步 | 低（Phase 5，可選） |
| 協作 | 樂觀版本控制（optimistic concurrency） | 低（Phase 5，可選） |
| CLI | `taskctl` 命令列操作任務 | 低（暫不排入） |
| 雲端 | Cloudflare Worker + D1 + 密碼驗證的多人協作部署 | 低（超出 POC 範圍，暫不排入） |
| 整合 | 嵌入 Codex/ChatGPT App 側邊欄 | 不相關（Codex 專屬功能，不採用） |

**分期規劃：**
1. **Phase 1（已完成）**：純前端 mock 資料的靜態三欄看板 UI，支援拖拉換欄
2. **Phase 2（本文件）**：任務 CRUD + SQLite 後端持久化
3. **Phase 3（後續）**：任務詳情（描述 Markdown、留言）
4. **Phase 4（後續）**：多視圖（列表/甘特圖）、標籤篩選、搜尋
5. **Phase 5（可選，視需求）**：即時多人同步

## 技術棧選型

| 項目 | 選擇 | 理由 |
|---|---|---|
| 後端框架 | Node.js + Express | 與前端同語言生態，可共用 TypeScript 型別，輕量、社群成熟 |
| 資料庫 | SQLite（better-sqlite3） | 輕量級、無需額外服務、同步 API 開發體驗佳，符合 POC 定位 |
| 部署整合 | 單一 Node server | 同時 serve 前端靜態檔 + `/api/*`，不需要額外的 nginx |

## 架構設計

- **單一 Node.js server**（Express）同時：
  - serve 前端 build 後的靜態檔案（`dist/`）
  - 提供 `/api/*` REST 端點
- **SQLite**（better-sqlite3）存放任務資料，檔案存於 `.data/taskboard.sqlite`
  - 開發、生產環境皆使用檔案資料庫
  - Docker 部署掛 volume 到 `.data/` 以持久化資料
- 前端維持 Vite build 產出靜態 SPA（`dist/`），Node server 直接指向該目錄作為靜態資源根目錄
- 單一 Dockerfile：
  - build stage：安裝依賴、`npm run build` 產出前端靜態檔 + 編譯/準備後端程式碼
  - production stage：只跑 `node server.js`，同時提供靜態檔與 API，不再需要 nginx

## API 設計（Task CRUD）

```
GET    /api/tasks           取得所有任務
POST   /api/tasks           新增任務
PATCH  /api/tasks/:id       更新任務（含拖拉換欄位時更新 columnId）
DELETE /api/tasks/:id       刪除任務
```

資料表 `tasks` 欄位：
```
id             TEXT PRIMARY KEY
title          TEXT NOT NULL
priority       TEXT NOT NULL          -- 'high' | 'medium' | 'low'
tags           TEXT NOT NULL          -- JSON array
assignees      TEXT NOT NULL          -- JSON array
progress       INTEGER                -- 0-100，可為 NULL
comment_count  INTEGER NOT NULL DEFAULT 0
has_unread     INTEGER NOT NULL DEFAULT 0   -- 0/1 boolean
column_id      TEXT NOT NULL          -- 'todo' | 'in_progress' | 'review'
created_at     TEXT NOT NULL
updated_at     TEXT NOT NULL
```

前端改動：
- 移除 `mockTasks.ts` 的硬編資料使用，改為 `fetch('/api/tasks')` 載入初始資料
- 拖拉換欄位、新增、刪除、編輯等操作，改為呼叫對應 API 並以回應更新本地 state

## 開發與部署模式

- **開發模式（`npm run dev`）**：
  - Vite dev server 負責前端 HMR，監聽 port 8088
  - 另開一個 Node API server（例如 port 3001）
  - Vite 設定 proxy，將 `/api` 轉發到後端 API server
- **正式/Docker 模式**：
  - 單一 Node server 監聽 8088，同時 serve 靜態檔與 API（不需要 nginx）
- `docker-compose.yml` 調整為單一 service 跑 Node server（移除 nginx service），
  掛載 `.data/` volume 以持久化 SQLite 資料庫檔案

## 待辦（不在本階段處理）

- Markdown 任務描述、留言系統 → Phase 3
- 多視圖（List/Gantt）、篩選、搜尋 → Phase 4
- 即時多人同步（SSE/WebSocket）、樂觀版本控制 → Phase 5（視需求評估）
- CLI 工具、雲端多人協作部署（Cloudflare/D1）→ 暫不排入，超出目前 POC 範圍
