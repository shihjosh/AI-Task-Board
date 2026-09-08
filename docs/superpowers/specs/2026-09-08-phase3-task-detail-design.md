# AI Task Board — Phase 3 設計文件：任務詳情（Markdown 描述 + 留言系統）

> 討論日期：2026-09-08

## 背景

Phase 1 完成靜態看板 UI，Phase 2 完成 SQLite 後端持久化與新增/編輯任務 UI（TaskDrawer）。
Phase 3 依 README 原訂規劃，聚焦「任務詳情」：讓每個任務可以有更豐富的 Markdown 格式描述，
以及讓使用者針對任務留言討論。

## 目標

- 任務可以填寫 Markdown 格式的詳細描述，並在編輯時所見即所得（雙欄即時預覽）
- 任務可以留言討論，留言支援新增/編輯/刪除
- 沿用既有 TaskDrawer 元件擴充，不新增獨立頁面，維持操作一致性

## 範圍決策（brainstorming 討論結果）

| 決策點 | 選擇 |
|---|---|
| 詳情呈現位置 | 在既有 `TaskDrawer` 上擴充，不做獨立頁面/全螢幕 Modal |
| Markdown 編輯體驗 | 雙欄並進（左輸入、右即時預覽，類似 GitHub issue 編輯器） |
| Drawer 寬度 | 加寬整個 `TaskDrawer`（從 `max-w-md` 改為更寬版面，容納雙欄編輯器） |
| 留言功能範圍 | 完整 CRUD（新增/編輯/刪除），各自有時間戳 |
| 留言作者 | 不設作者選擇 UI，全部留言固定標示為預設使用者「Josh」 |
| `commentCount` 欄位 | 維持現狀，仍是獨立的手動數字欄位，**不**自動與真實留言數同步 |
| Markdown 渲染套件 | `react-markdown` + `remark-gfm`（與原專案 dashi-taskboard 一致，支援 GFM 表格/任務清單等語法） |

## 資料庫 Schema 變更

### `tasks` 表新增欄位

```sql
ALTER TABLE tasks ADD COLUMN description TEXT DEFAULT '';
```

- `description`：Markdown 原始文字，可為空字串

### 新增 `comments` 表

```sql
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
)
```

- 留言作者不存欄位（固定顯示「Josh」，由前端寫死，不進資料庫）
- `updated_at` 與 `created_at` 不同時，前端可顯示「已編輯」標記

## API 設計

### 任務描述

- 沿用既有 `PATCH /api/tasks/:id`，`description` 加入既有的白名單欄位機制，與其他欄位一起送出即可，不需要新增專屬端點

### 留言 CRUD

```
GET    /api/tasks/:taskId/comments       取得該任務所有留言（依 created_at 升冪排序）
POST   /api/tasks/:taskId/comments       新增留言（body: { content }）
PATCH  /api/comments/:id                 編輯留言（body: { content }）
DELETE /api/comments/:id                 刪除留言
```

- `content` 為必填，空字串或缺少回 `400`
- `PATCH`/`DELETE` 對不存在的 `id` 回 `404`
- 刪除任務時，該任務所有留言透過 `ON DELETE CASCADE` 一併清除

## 前端設計

### TaskDrawer 版面調整

- Drawer 寬度：`max-w-md` → `max-w-3xl`（或近似寬度，實作時依視覺效果微調）
- 既有欄位（標題/優先級/欄位/標籤/負責人/進度）維持在上半部，版面不變邏輯只是變寬
- 新增「描述」區塊：雙欄並排
  - 左欄：`<textarea>` 輸入 Markdown 原文
  - 右欄：即時渲染預覽（`ReactMarkdown` + `remarkGfm` plugin）
- 新增「留言」區塊（僅在編輯模式顯示，新增任務時不顯示，因為留言需要任務已存在的 id）：
  - 留言列表：依時間排序顯示，每則含內容、時間戳、（若有編輯過）「已編輯」標記
  - 每則留言旁有「編輯」「刪除」按鈕（刪除比照任務刪除，用 `window.confirm` 二次確認）
  - 底部新增留言輸入框 + 送出按鈕，新增留言固定顯示作者為「Josh」

### 新增檔案

- `src/components/CommentList.tsx`：留言列表 + 新增留言表單
- `src/lib/commentsApi.ts`：留言 CRUD 的 API client（`fetchComments`/`createComment`/`updateComment`/`deleteComment`）

### 修改檔案

- `src/components/TaskDrawer.tsx`：加寬版面、新增 description 雙欄編輯器、掛載 `CommentList`
- `src/types/task.ts`：`Task` 型別新增 `description?: string`；新增 `Comment` 型別
- `server/db.mjs`：schema migration（新增 `description` 欄位、新增 `comments` 表）
- `server/taskRepository.mjs`：`rowToTask` 涵蓋 `description`
- `server/index.mjs`：新增留言 CRUD 路由
- 新增：`server/commentRepository.mjs`（留言資料存取層，比照 `taskRepository.mjs` 風格）

## 技術棧變更

**本階段是專案首次新增 npm 套件**：

- `react-markdown`：Markdown → React 元件渲染
- `remark-gfm`：GFM（GitHub Flavored Markdown）語法支援插件（表格、任務清單、刪除線等）

其餘沿用既有技術棧，不新增其他依賴。

## 範圍外（本次不處理）

- 留言作者選擇 UI（固定為「Josh」）
- `commentCount` 與真實留言數自動同步
- Markdown 描述的圖片上傳/附件功能
- mermaid 圖表渲染（原專案 dashi-taskboard 有此功能，本專案暫不跟進）
- 留言巢狀回覆（reply）、@提及功能
- 獨立的任務詳情頁面（本次維持在 TaskDrawer 內擴充）
