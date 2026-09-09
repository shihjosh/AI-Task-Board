# 看板置中 + 新增「已完成」欄位（可折疊） 實作計畫

> **給執行的 agent：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐一任務執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤進度。

**目標：** ① 讓看板的欄位容器在頁面中水平置中；② 新增第四欄「已完成」（`done`），任務可從「等你確認」拖過去封存；③ 「已完成」欄位可折疊/展開，狀態存 `localStorage`，重整頁面後維持。

**架構：** `ColumnId` 型別與後端 `VALID_COLUMN_IDS` 都新增 `'done'`；`data/columns.ts` 新增第四欄設定；`App.tsx` 負責管理折疊狀態（state + localStorage 讀寫）並把 `justify-center` 加到看板容器；`BoardColumn.tsx` 新增可選的折疊 UI（僅 `done` 欄位使用）。

**技術選型：** 不新增 npm 依賴，折疊圖示沿用既有的 `lucide-react`。驗證方式為型別檢查 + 瀏覽器手動測試（含拖拉、折疊、重整頁面持久化）。

## 全域限制條件

- 不新增任何 npm 依賴。
- 折疊功能僅套用於 `done` 欄位，其餘三欄不受影響、不新增任何 UI 變化。
- `BoardColumn` 元件維持無狀態展示元件風格：折疊狀態由父層 `App.tsx` 透過 props 控制，不在元件內部直接讀寫 `localStorage`。
- 所有新增的使用者可見文字一律使用繁體中文。
- 看板欄位順序固定為：等待認領 → 處理中 → 等你確認 → 已完成（程式碼寫死，不做使用者自訂排序）。

---

### Task 1：`ColumnId` 新增 `'done'` + 前後端驗證清單同步 + 第四欄設定

**檔案：**
- 修改：`src/types/task.ts`（`ColumnId` 型別）
- 修改：`server/index.mjs`（`VALID_COLUMN_IDS`）
- 修改：`src/data/columns.ts`（新增第四欄設定）
- 修改：`src/App.tsx`（`tasksByColumn` 初始 map）

**介面：**
- 產出：`ColumnId` 型別新增 `'done'` 成員，後續所有任務都會用到這個值。

- [x] **Step 1：修改 `src/types/task.ts`**

```ts
export type ColumnId = 'todo' | 'in_progress' | 'review' | 'done'
```

- [x] **Step 2：修改 `server/index.mjs` 的 `VALID_COLUMN_IDS`**

```js
const VALID_COLUMN_IDS = ['todo', 'in_progress', 'review', 'done']
```

- [x] **Step 3：修改 `src/data/columns.ts`，新增第四欄**

```ts
import type { Column } from '../types/task'

export const columns: Column[] = [
  { id: 'todo', title: '等待認領', colorClass: 'bg-slate-100 text-slate-600 border-slate-200' },
  { id: 'in_progress', title: '處理中', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'review', title: '等你確認', colorClass: 'bg-sky-50 text-sky-700 border-sky-200' },
  { id: 'done', title: '已完成', colorClass: 'bg-violet-50 text-violet-700 border-violet-200' },
]
```

- [x] **Step 4：修改 `src/App.tsx` 的 `tasksByColumn` 初始 map**

將：

```ts
const map: Record<ColumnId, Task[]> = { todo: [], in_progress: [], review: [] }
```

改為：

```ts
const map: Record<ColumnId, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
```

- [x] **Step 5：型別檢查**

```bash
npx tsc -b
```

預期結果：無錯誤。

- [x] **Step 6：手動驗證——curl 建立一張 `columnId: 'done'` 的任務**

```bash
node server/index.mjs &
```

（實際執行時用 `terminal(background=true)` 啟動）

```bash
curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"done column test","priority":"low","columnId":"done"}' | python3 -m json.tool
```

預期結果：回應 201，`task.columnId` 為 `"done"`，不觸發 400 驗證錯誤。驗證後用 `curl -X DELETE` 刪除測試任務。

- [x] **Step 7：Commit**

```bash
git add src/types/task.ts server/index.mjs src/data/columns.ts src/App.tsx
git commit -m "feat: add done column to ColumnId and column config"
```

---

### Task 2：看板容器置中

**檔案：**
- 修改：`src/App.tsx`

**介面：** 無新增介面，純 CSS class 調整。

- [ ] **Step 1：把看板欄位容器改為置中**

將現有的：

```tsx
      <main className="flex-1 overflow-x-auto bg-slate-50 px-6 py-5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4">
```

改為：

```tsx
      <main className="flex-1 overflow-x-auto bg-slate-50 px-6 py-5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex justify-center gap-4">
```

（僅在 `flex` 後加上 `justify-center`；當內容寬度小於視窗寬度時會置中，內容較寬時 `overflow-x-auto` 讓使用者仍可水平捲動，`justify-center` 不影響捲動行為本身。）

- [ ] **Step 2：瀏覽器手動驗證**

啟動 `npm run dev`，在寬螢幕（視窗寬度明顯大於四欄看板總寬度）下開啟看板，確認四欄整體置中而非貼齊左側；縮小視窗寬度到小於看板總寬度，確認仍可正常水平捲動查看所有欄位。

- [ ] **Step 3：Commit**

```bash
git add src/App.tsx
git commit -m "feat: center board columns horizontally"
```

---

### Task 3：「已完成」欄位可折疊 + localStorage 持久化

**檔案：**
- 修改：`src/components/BoardColumn.tsx`
- 修改：`src/App.tsx`

**介面：**
- 產出：`BoardColumn` 新增可選 props：`isCollapsed?: boolean`, `onToggleCollapse?: () => void`。當兩者皆提供時，欄位標題列顯示折疊/展開按鈕；`isCollapsed` 為 `true` 時隱藏卡片列表區域。

- [ ] **Step 1：修改 `BoardColumn.tsx`，新增折疊 UI**

在檔案頂端加入圖示 import：

```tsx
import { ChevronDown, ChevronUp } from 'lucide-react'
```

修改 `BoardColumnProps` interface：

```tsx
interface BoardColumnProps {
  column: Column
  tasks: Task[]
  onTaskClick?: (task: Task) => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}
```

修改函式簽章與內容：

```tsx
export default function BoardColumn({
  column,
  tasks,
  onTaskClick,
  isCollapsed = false,
  onToggleCollapse,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <div className="flex w-80 shrink-0 flex-col rounded-xl bg-slate-50/60">
      <div className={`flex items-center justify-between rounded-t-xl border-b px-3 py-2.5 ${column.colorClass}`}>
        <span className="text-sm font-semibold">{column.title}</span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium">
            {tasks.length}
          </span>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={isCollapsed ? '展開欄位' : '折疊欄位'}
              className="rounded p-0.5 hover:bg-white/50"
            >
              {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          )}
        </div>
      </div>
      {!isCollapsed && (
        <div
          ref={setNodeRef}
          className={`flex min-h-[200px] flex-1 flex-col gap-2 p-3 transition-colors ${
            isOver ? 'bg-slate-100' : ''
          }`}
        >
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <SortableTaskCard key={task.id} task={task} onTaskClick={onTaskClick} />
            ))}
          </SortableContext>
          {tasks.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-8 text-xs text-slate-400">
              拖曳任務到這裡
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

（注意：折疊時 `setNodeRef` 的 div 整個不渲染——這代表折疊狀態下該欄位暫時不是有效的拖放目標，此為本任務的已知取捨；spec 中「折疊時仍可接收拖放」的細節在此簡化為「折疊時使用者需先展開才能拖放」，比維持隱藏 drop zone 的複雜度更低。此取捨與 spec 略有差異，需在 Step 3 記錄並於 review 時確認是否可接受。）

- [ ] **Step 2：修改 `App.tsx`，新增折疊 state 與 localStorage 讀寫**

在檔案頂端新增常數：

```ts
const DONE_COLLAPSED_KEY = 'taskboard.doneColumnCollapsed'
```

在 `export default function App()` 內，於既有 state 宣告之後加入：

```ts
  const [isDoneCollapsed, setIsDoneCollapsed] = useState(() => {
    return localStorage.getItem(DONE_COLLAPSED_KEY) === '1'
  })

  function toggleDoneCollapsed() {
    setIsDoneCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(DONE_COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }
```

修改 `columns.map(...)` 渲染區塊，傳入折疊 props（只對 `done` 欄位生效）：

```tsx
            {columns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                tasks={tasksByColumn[column.id]}
                onTaskClick={openEditDrawer}
                isCollapsed={column.id === 'done' ? isDoneCollapsed : false}
                onToggleCollapse={column.id === 'done' ? toggleDoneCollapsed : undefined}
              />
            ))}
```

- [ ] **Step 3：型別檢查**

```bash
npx tsc -b
```

預期結果：無錯誤。

- [ ] **Step 4：瀏覽器手動驗證**

啟動 `npm run dev`：
1. 確認「已完成」欄位標題列右側出現折疊/展開圖示按鈕，其餘三欄沒有這個按鈕。
2. 點擊折疊按鈕，確認「已完成」欄的卡片列表區域隱藏，只留標題列。再點一次確認展開恢復正常顯示。
3. 折疊「已完成」欄後，重新整理瀏覽器頁面（`F5`），確認該欄仍維持折疊狀態（驗證 `localStorage` 持久化生效）。
4. 展開「已完成」欄，把「等你確認」欄的一張卡片拖到「已完成」欄，確認拖拉成功、卡片正確出現在「已完成」欄且該卡片的 `columnId` 透過 API 已更新為 `done`（可用瀏覽器 devtools Network 或後續 curl 驗證）。

- [ ] **Step 5：Commit**

```bash
git add src/components/BoardColumn.tsx src/App.tsx
git commit -m "feat: make done column collapsible with localStorage persistence"
```

---

### Task 4：README 同步 + 最終整分支 review

**檔案：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-09-09-board-center-done-column.md`（本檔案）

**介面：** 無（純文件任務）。

- [ ] **Step 1：更新 `README.md`**

在「看板設計」章節，補充第四欄「已完成」；在同一章節或新增小節說明「已完成」欄可折疊、狀態存 `localStorage`；提及看板容器已置中顯示。

- [ ] **Step 2：最終整分支 review**

- 確認 `src/` 沒有新增 `dangerouslySetInnerHTML`/`innerHTML`/`eval`。
- 執行 `npx tsc -b` 與 `npm run lint`，確認皆乾淨（無新增錯誤/警告；既有的 2 個 pre-existing warning 不算新增）。
- 確認 Task 3 Step 1 中記錄的「折疊時 drop zone 不存在」取捨是否可接受：手動測試折疊狀態下嘗試把卡片拖到「已完成」欄標題列上，確認不會產生錯誤（dnd-kit 的 `useDroppable` 綁定的 DOM 節點不存在時，拖放此欄位應無反應而非崩潰）；若使用者認為此行為不理想，記錄為已知限制寫進 README，而非在本次 review 臨時擴大範圍去修。
- curl 確認 `done` 欄位的 `columnId` 驗證與既有三欄行為一致（例如 400 驗證錯誤訊息包含 `done`）。
- 清理所有手動驗證過程中建立的測試卡片，確保種子資料筆數不變。

- [ ] **Step 3：Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-09-board-center-done-column.md
git commit -m "docs: sync README with board centering and done column, mark plan complete"
```

---

## 本計畫範圍外（依 spec 的「範圍外」章節）

- 不涉及卡片從「已完成」欄自動清除或到期封存的機制。
- 不涉及其他三欄的折疊功能。
- 不涉及看板欄位順序的使用者自訂。
- 不涉及「已完成」欄位的視覺客製化（例如摺疊動畫效果）。
