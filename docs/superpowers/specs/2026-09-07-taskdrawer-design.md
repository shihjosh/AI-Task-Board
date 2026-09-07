# AI Task Board — Phase 2.1 設計文件：新增/編輯任務 UI（TaskDrawer）

> 討論日期：2026-09-07

## 背景

Phase 2 完成了 SQLite 後端持久化與完整的 Task CRUD API（`POST`/`PATCH`/`DELETE /api/tasks`），
並經過驗證可正常運作。但前端 UI 尚未串接「新增任務」與「編輯任務」的互動——
Toolbar 的「新增任務」按鈕沒有 `onClick`，TaskCard 也沒有點擊開啟編輯的功能。
本文件規劃補齊這段前端 UI，讓使用者能透過畫面實際新增、編輯、刪除任務。

## 目標

- 使用者可以透過 UI 新增任務（不需要直接呼叫 API）
- 使用者可以點擊既有任務卡片開啟編輯，修改後儲存
- 使用者可以在編輯模式下刪除任務
- 沿用 Phase 2 已完成且驗證過的後端 API（`src/lib/api.ts` 的 `createTaskApi`/`updateTaskApi`/`deleteTaskApi`），不需要新增後端功能

## 互動設計

### 新增任務
- 點擊 Toolbar 右上角「新增任務」按鈕 → 從右側滑出 Drawer（側邊抽屜），顯示空白表單

### 編輯任務
- 點擊既有任務卡片（TaskCard）→ 開啟同一個 Drawer，表單已帶入該任務現有資料

### 元件共用
- 新增與編輯共用同一個 `TaskDrawer` 元件，透過 `editingTask` 狀態（`null` = 新增模式，有值 = 編輯模式）切換行為與標題文字

## 表單欄位

| 欄位 | 型態 | 說明 |
|---|---|---|
| `title` | 文字輸入 | 必填 |
| `priority` | 下拉選單 | `high` / `medium` / `low` |
| `columnId` | 下拉選單 | `todo` / `in_progress` / `review` |
| `tags` | 多選核取方塊 | 固定選單，來自現有 `TagType`：`github` / `issue` / `bug` / `pr` |
| `assignees` | 多選核取方塊 | 固定選單，來自現有 seed 資料的 3 位負責人：Josh / Amy / Ken（含各自 `avatarColor`/`initials`） |
| `progress` | 數字輸入（0-100） | 可留空 |

**tags 與 assignees 皆為固定選單**（不開放自由輸入新增選項），使用者只能從既有清單中勾選。

## 操作按鈕

- **新增模式**：
  - 「建立」→ 呼叫 `createTaskApi()` → 成功後關閉 Drawer，重新 `fetchTasks()` 更新列表
  - 「取消」/ 點擊背景 overlay → 關閉 Drawer，不送出
- **編輯模式**：
  - 「儲存」→ 呼叫 `updateTaskApi()` → 成功後關閉 Drawer，重新 `fetchTasks()` 更新列表
  - 「刪除」→ 二次確認（`window.confirm`）→ 呼叫 `deleteTaskApi()` → 成功後關閉 Drawer，重新 `fetchTasks()` 更新列表
  - 「取消」/ 點擊背景 overlay → 關閉 Drawer，不送出

## 架構與元件

- **新增元件**：`src/components/TaskDrawer.tsx`
  - Props：`isOpen: boolean`、`mode: 'create' | 'edit'`、`initialTask?: Task`（編輯模式時帶入）、`onClose: () => void`、`onSaved: () => void`（儲存/刪除成功後呼叫，通知 `App.tsx` 重新載入資料）
  - 內部用 `useState` 管理表單欄位（不需要額外表單庫，欄位不多）
- **修改 `src/App.tsx`**：
  - 新增狀態：`isDrawerOpen: boolean`、`drawerMode: 'create' | 'edit'`、`editingTask: Task | null`
  - `<Toolbar>` 新增 `onAddTask` prop，點擊觸發開啟 Drawer（新增模式）
  - `<BoardColumn>` → `<TaskCard>` 鏈路新增 `onTaskClick` callback，點擊卡片觸發開啟 Drawer（編輯模式，帶入該任務）
- **修改 `src/components/Toolbar.tsx`**：「新增任務」按鈕加上 `onClick` prop 呼叫
- **修改 `src/components/TaskCard.tsx`**：外層容器加上 `onClick` prop（注意：需與既有的 dnd-kit 拖拉手勢共存，不能互相干擾——拖拉手勢已有 `distance: 5` 的 activation constraint，點擊應可正常區分）
- **修改 `src/components/BoardColumn.tsx`**：把 `onTaskClick` 往下傳給每個 `SortableTaskCard`/`TaskCard`

## 資料流

- 沿用 Phase 2 已完成的 `src/lib/api.ts`（`createTaskApi`、`updateTaskApi`、`deleteTaskApi`），後端已驗證支援值域驗證（`priority`/`columnId` 白名單）與錯誤處理
- 儲存/刪除成功後採用「重新呼叫 `fetchTasks()`」而非樂觀本地更新，換取實作簡單與資料一致性（Phase 2.1 階段資料量小、單人使用，效能影響可忽略）

## 技術棧

沿用現有 React + TypeScript + Tailwind CSS，**不新增任何套件**：
- 不需要額外表單庫（欄位少，`useState` 手動管理足夠）
- Drawer 動畫用 Tailwind 的 `transition`/`translate-x` 類別手刻，不需要動畫庫

## 範圍外（本次不處理）

- tags/assignees 開放自由輸入新增選項（維持固定選單）
- 樂觀 UI 更新 / 拖拉排序以外的即時同步
- 表單驗證的即時錯誤提示樣式優化（僅需基本的「必填」阻擋與 API 錯誤訊息顯示）
