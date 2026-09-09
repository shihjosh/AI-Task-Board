# TaskDrawer 頁籤化 + Hermes 執行紀錄獨立化 設計文件

> 討論日期：2026-09-09
> 狀態：**Spec only — 本文件僅記錄設計決策，待確認後進入 plan + 實作階段**

## 背景

Phase 4（`docs/superpowers/plans/2026-09-08-hermes-agent-automation.md`）已上線「拖卡到處理中觸發 Hermes 自動執行」的功能，但實作時把 Hermes 的執行結果（成功/失敗訊息）直接寫進既有的留言（`comments`）資料表，與使用者手動留言混在一起，介面上也混雜顯示。

同時，任務卡的「描述（Markdown）」欄位目前是左右並排顯示「編輯用的 textarea」與「即時預覽」，在 Drawer 寬度有限的情況下較為擁擠。

本次規劃要解決兩個獨立但都與 `TaskDrawer` 版面相關的問題：

1. 描述欄位改用頁籤切換編輯/預覽，而非左右並排。
2. Hermes 執行紀錄從留言系統中完全分離，改用專屬資料表與獨立頁籤呈現。

## 已確認的設計決策

| 決策點 | 選擇 |
|---|---|
| 描述欄位顯示方式 | 從左右並排（`grid grid-cols-1 md:grid-cols-2`）改為頁籤切換：「編輯」「預覽」兩個頁籤，同一時間只顯示一個 |
| Hermes 執行紀錄的資料儲存方式 | **完整做法**：新建專屬資料表 `automation_runs`，完整記錄每次執行的 prompt、輸出、狀態、時間，與 `comments` 表完全分開，不再寫入 `comments` 表 |
| TaskDrawer 頁籤配置 | 兩組獨立頁籤：① 描述區塊用「編輯 / 預覽」；② 描述區塊下方另外用「留言 / 執行紀錄」（不是把整個 Drawer 改成單一頁籤列） |
| 舊資料處理 | 不遷移。既有寫入 `comments` 表的 Hermes 執行紀錄（測試期間產生，已清空）維持原樣，不做资料搬移；新的執行紀錄一律寫入 `automation_runs` |

## 資料庫變更（規劃）

新增資料表：

```sql
CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,            -- 'running' | 'done' | 'failed'
  prompt TEXT NOT NULL,
  output TEXT NOT NULL DEFAULT '',
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
)
```

- 沿用既有 `comments` 表的 migration 慣例：用 `CREATE TABLE IF NOT EXISTS` 建表（新表不需要 `ALTER TABLE` 欄位補丁）。
- 沿用既有 `db.pragma('foreign_keys = ON')` 設定，讓 `ON DELETE CASCADE` 生效（刪除任務時一併清除其執行紀錄）。

## API 變更（規劃）

新增：
```
GET /api/tasks/:taskId/automation-runs   取得指定任務的所有 Hermes 執行紀錄（按 started_at 排序）
```

不新增寫入端點——`automation_runs` 只由後端的 `automationRunner.mjs` 內部寫入（`createAutomationRun` / `updateAutomationRun`），不開放前端直接建立/編輯/刪除執行紀錄（這是唯讀的稽核紀錄，不是使用者可編輯的內容，比照現有 `comments` 的可寫入模式不同）。

## `automationRunner.mjs` 行為變更（規劃）

目前流程（`finishSuccess` / `finishFailed`）會呼叫 `createComment(task.id, "✅/❌ ...")`。改為：

1. `runOne(task)` 一開始，除了 `updateTask(task.id, { automationStatus: 'running' })`，同時呼叫 `createAutomationRun(task.id, { status: 'running', prompt })`，取得這次執行的 `runId`。
2. `finishSuccess` / `finishFailed` 改成呼叫 `updateAutomationRun(runId, { status: 'done'|'failed', output/error, finishedAt })`，不再呼叫 `createComment`。
3. `triggerAutomation` 內「`targetPath` 無效」與「同步 spawn 例外」兩個提前失敗的分支，也都改成建立一筆 `status: 'failed'` 的執行紀錄（`started_at` = `finished_at` = 當下時間），而不是寫留言。

## 前端變更（規劃）

### `TaskDrawer.tsx`

- 描述區塊：新增 `descriptionTab: 'edit' | 'preview'` 的本地 state，頁籤按鈕切換顯示 `<textarea>` 或 `<ReactMarkdown>`，取代目前的 `grid grid-cols-1 md:grid-cols-2` 並排寫法。
- 下方區塊：新增 `bottomTab: 'comments' | 'automation'` 的本地 state，頁籤按鈕切換渲染 `<CommentList>` 或新元件 `<AutomationRunList>`。
- 兩組頁籤都只在 `mode === 'edit' && initialTask`（已存在的任務）時顯示，與現有 `CommentList` 的顯示條件一致（新建任務尚無 id，不會有留言也不會有執行紀錄）。
- 「執行紀錄」頁籤的分頁標籤上，若該任務 `automationStatus === 'running'`，顯示一個小紅點或文字提示（避免使用者沒注意到有正在執行的任務）。

### 新增 `src/lib/automationRunsApi.ts`

```ts
export async function fetchAutomationRuns(taskId: string): Promise<AutomationRun[]>
```

### 新增 `src/components/AutomationRunList.tsx`

- 唯讀列表，每筆顯示：狀態（圖示 + 文字，running/done/failed 三色）、開始時間、結束時間（若有）、輸出或錯誤內容（可摺疊，避免過長內容撐爆 Drawer）。
- 無執行紀錄時顯示「尚無執行紀錄」提示文字（比照 `CommentList` 的「尚無留言」寫法）。
- 不提供新增/編輯/刪除操作（唯讀）。

### `src/types/task.ts`

新增：
```ts
export interface AutomationRun {
  id: string
  taskId: string
  status: 'running' | 'done' | 'failed'
  prompt: string
  output: string
  error?: string
  startedAt: string
  finishedAt?: string
}
```

## 範圍外（本次規劃不涉及）

- 不涉及 Docker 部署限制的解法（見既有 issue 草稿，另案處理）。
- 不涉及執行紀錄的分頁/搜尋/篩選（資料量小，暫時全部載入即可，比照 `CommentList` 現有做法）。
- 不涉及讓使用者手動重新觸發/取消某次執行（維持現有「拖回 in_progress 才觸發、running 中忽略重複觸發」的邏輯不變）。
