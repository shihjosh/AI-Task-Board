# 看板置中 + 新增「已完成」欄位（可折疊）設計文件

> 討論日期：2026-09-09
> 狀態：**Spec only — 本文件僅記錄設計決策，待確認後進入 plan + 實作階段**

## 背景

目前看板為三欄式 Kanban（等待認領 / 處理中 / 等你確認），使用 `flex gap-4` 由左至右排列，寬螢幕下會貼齊視窗左側而非置中。同時，「等你確認」欄位是流程的終點，任務被確認後仍留在同一欄，沒有一個明確的「完成並封存」的地方，看板會隨著已確認任務累積而持續變長。

本次規劃：① 讓看板整體在頁面中水平置中；② 新增第四欄「已完成」作為封存欄位；③ 讓「已完成」欄位可以折疊/展開，避免看板隨完成任務增加而不斷變長。

## 已確認的設計決策

| 決策點 | 選擇 |
|---|---|
| 看板置中方式 | 看板的欄位容器（目前 `App.tsx` 內的 `<div className="flex gap-4">`）改為在其父層 `<main>` 內水平置中（`justify-center`），而非貼齊左側 |
| 新欄位的定位 | 新增第四欄「已完成」，`ColumnId` 增加 `'done'`，順序排在「等你確認」之後（等待認領 → 處理中 → 等你確認 → 已完成） |
| 進入「已完成」欄的方式 | 沿用既有的拖拉機制——使用者手動把「等你確認」欄的卡片拖到「已完成」欄，等同封存；不做自動化（例如 review 停留超過 N 天自動移入） |
| 折疊功能適用範圍 | **只有「已完成」欄位**可以折疊/展開，其他三欄（等待認領/處理中/等你確認）維持現狀，不提供折疊功能 |
| 折疊狀態持久化 | 存在瀏覽器 `localStorage`（不需要存進後端資料庫），重新整理頁面後維持使用者上次的展開/收合選擇 |
| 折疊時的顯示內容 | 折疊後只保留欄位標題列（標題文字 + 任務數量徽章 + 展開/收合圖示按鈕），卡片列表區域隱藏 |

## 資料模型變更（規劃）

### `ColumnId` 型別

```ts
export type ColumnId = 'todo' | 'in_progress' | 'review' | 'done'
```

### 後端驗證清單

`server/index.mjs` 的 `VALID_COLUMN_IDS`：

```js
const VALID_COLUMN_IDS = ['todo', 'in_progress', 'review', 'done']
```

### 欄位設定

`src/data/columns.ts` 新增第四筆：

```ts
{ id: 'done', title: '已完成', colorClass: 'bg-violet-50 text-violet-700 border-violet-200' }
```

## 前端變更（規劃）

### `App.tsx`

- `tasksByColumn` 的初始 map 加入 `done: []`。
- 看板容器（`<div className="flex gap-4">` 的外層 `<main>`）加上 `flex justify-center`（或等效寫法），讓多欄整體置中；欄寬本身（每欄固定 `w-80`）維持不變，只調整整體置中方式。

### `BoardColumn.tsx`

- 新增一個 `isCollapsible` 或直接用 `column.id === 'done'` 判斷是否顯示折疊按鈕。
- 折疊狀態透過 props 從父層（`App.tsx`）傳入與控制（`isCollapsed: boolean`, `onToggleCollapse: () => void`），維持 `BoardColumn` 是無狀態展示元件的既有風格（不在元件內部直接讀寫 `localStorage`）。
- 折疊時：欄位標題列維持顯示（含任務數量），下方原本顯示卡片列表與「拖曳任務到這裡」提示的區塊整個隱藏。
- 折疊/展開切換按鈕使用 `lucide-react` 既有圖示風格（例如 `ChevronDown`/`ChevronUp`），與現有 UI 語言一致。

### `App.tsx` 的 localStorage 讀寫

- 新增一個 `localStorage` key：`taskboard.doneColumnCollapsed`，值為 `'1'`/`'0'`（或用 `JSON.stringify(boolean)`）。
- 元件掛載時讀取此 key 決定初始折疊狀態（若不存在則預設展開，即 `isCollapsed = false`）。
- 使用者點擊折疊按鈕時，同步更新 state 與 `localStorage`。

## 拖拉互動的相容性

- `@dnd-kit/core` 的 `useDroppable({ id: column.id })` 機制不受欄位新增影響，`done` 欄位比照其他三欄設定即可正常接收拖放。
- 折疊狀態下欄位是否仍可接收拖放：**維持可接收**（折疊只是視覺上隱藏卡片列表，不影響 `useDroppable` 的判定範圍——欄位標題列本身仍在 DOM 中，作為拖放目標）；此細節在實作階段驗證。

## 範圍外（本次規劃不涉及）

- 不涉及卡片從「已完成」欄自動清除或到期封存的機制。
- 不涉及其他三欄的折疊功能。
- 不涉及看板欄位順序的使用者自訂（欄位順序固定為程式碼寫死的四欄）。
- 不涉及「已完成」欄位的欄位顏色/圖示以外的視覺客製化（例如摺疊動畫效果）。
