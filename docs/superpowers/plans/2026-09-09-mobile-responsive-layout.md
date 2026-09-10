# 手機版響應式版面 實作計畫

> **給執行的 agent：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐一任務執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤進度。

**目標：** 在 `< 640px`（Tailwind `sm` 斷點）螢幕寬度下，把看板改為單欄 + 標籤切換的呈現方式，並在手機模式的任務卡片上提供「移動到...」選單取代拖拉換欄；`≥ 640px`（桌面）維持現有多欄橫向排列 + 拖拉的行為完全不變。

**架構：** 全程使用 Tailwind CSS 的 `hidden sm:flex` / `flex sm:hidden` 之類的純 CSS 響應式 class 做顯示切換，不使用 JS 偵測視窗寬度（避免版面閃爍與 SSR/hydration 不一致問題）。`App.tsx` 新增手機模式下「目前選中欄位」的 state；`BoardColumn.tsx` 新增可選的 `isMobile` prop 讓寬度改成撐滿；`TaskCard.tsx` 新增手機模式限定的「移動到...」選單，透過既有的 `updateTaskApi` 呼叫換欄。

**技術選型：** 不新增 npm 依賴，選單用原生 HTML `<select>` 元素（比照現有 `TaskDrawer.tsx` 的優先級/欄位下拉選單風格），驗證方式為型別檢查 + 瀏覽器手動測試（含縮小視窗寬度模擬手機、實際切換欄位）。

## 全域限制條件

- 不新增任何 npm 依賴。
- 桌面版（`≥ 640px`）的既有拖拉邏輯（`DndContext`/`handleDragStart`/`handleDragEnd`）維持完全不變，本計畫任何一個 Task 都不得修改這些函式的內部邏輯。
- 響應式切換全部用 Tailwind CSS class 完成，不引入 JS 的 `window.innerWidth`/`matchMedia` 判斷。
- 手機模式「移動到...」選單不在桌面版渲染，避免介面雜訊。
- 所有新增的使用者可見文字一律使用繁體中文。

---

### Task 1：`App.tsx` 新增手機模式的欄位標籤切換邏輯

**檔案：**
- 修改：`src/App.tsx`

**介面：**
- 產出：`mobileActiveColumnId: ColumnId` state，預設為 `columns[0].id`；後續 Task 2/3 的元件會依此渲染對應內容。

- [x] **Step 1：新增手機模式選中欄位的 state**

在既有 `isDoneCollapsed` state 之後加入：

```ts
  const [mobileActiveColumnId, setMobileActiveColumnId] = useState<ColumnId>(columns[0].id)
```

- [x] **Step 2：新增換欄位的 handler，供手機版「移動到...」選單使用**

在 `handleDragEnd` 函式之後加入：

```ts
  function handleMoveToColumn(task: Task, targetColumnId: ColumnId) {
    if (task.columnId === targetColumnId) return
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, columnId: targetColumnId } : t)),
    )
    updateTaskApi(task.id, { columnId: targetColumnId }).catch((err) => {
      console.error('Failed to persist column change', err)
    })
  }
```

- [x] **Step 3：重構看板渲染區塊——桌面版與手機版分岔**

將現有的：

```tsx
          <div className="flex w-full justify-center gap-4">
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
          </div>
```

替換為：

```tsx
          {/* 桌面版：多欄橫向排列（sm 以上顯示） */}
          <div className="hidden w-full justify-center gap-4 sm:flex">
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
          </div>

          {/* 手機版：單欄 + 標籤切換（sm 以下顯示） */}
          <div className="flex w-full flex-col gap-3 sm:hidden">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {columns.map((column) => (
                <button
                  key={column.id}
                  type="button"
                  onClick={() => setMobileActiveColumnId(column.id)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    mobileActiveColumnId === column.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {column.title} ({tasksByColumn[column.id].length})
                </button>
              ))}
            </div>
            {columns
              .filter((column) => column.id === mobileActiveColumnId)
              .map((column) => (
                <BoardColumn
                  key={column.id}
                  column={column}
                  tasks={tasksByColumn[column.id]}
                  onTaskClick={openEditDrawer}
                  isCollapsed={column.id === 'done' ? isDoneCollapsed : false}
                  onToggleCollapse={column.id === 'done' ? toggleDoneCollapsed : undefined}
                  isMobile
                  onMoveToColumn={handleMoveToColumn}
                />
              ))}
          </div>
```

（`isMobile` 與 `onMoveToColumn` props 由 Task 2 在 `BoardColumn.tsx`/`TaskCard.tsx` 中定義並串接，此處先在呼叫端加上。）

- [x] **Step 4：型別檢查（預期此時會因 `BoardColumn` 尚未支援新 props 而報錯，屬於正常過渡狀態，留給 Task 2 修正）——確認錯誤訊息確實只跟 `isMobile`/`onMoveToColumn` props 有關**

```bash
npx tsc -b
```

預期結果：報錯訊息應該只與 `BoardColumn` 缺少 `isMobile`/`onMoveToColumn` props 有關；若出現其他非預期錯誤，先排除再繼續。

- [x] **Step 5：Commit**

```bash
git add src/App.tsx
git commit -m "feat: add mobile column tab state and move-to-column handler in App"
```

---

### Task 2：`BoardColumn.tsx` 支援手機模式寬度 + 串接「移動到」callback

**檔案：**
- 修改：`src/components/BoardColumn.tsx`

**介面：**
- 消耗：Task 1 的 `handleMoveToColumn(task, targetColumnId)`。
- 產出：`BoardColumn` 新增 props `isMobile?: boolean`, `onMoveToColumn?: (task: Task, targetColumnId: ColumnId) => void`，並把 `onMoveToColumn` 透傳給 `SortableTaskCard`（Task 3 會再往下傳給 `TaskCard`）。

- [x] **Step 1：修改 `BoardColumnProps` interface**

```tsx
interface BoardColumnProps {
  column: Column
  tasks: Task[]
  onTaskClick?: (task: Task) => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  isMobile?: boolean
  onMoveToColumn?: (task: Task, targetColumnId: Task['columnId']) => void
}
```

- [x] **Step 2：修改函式簽章與外層容器寬度**

將：

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
```

改為：

```tsx
export default function BoardColumn({
  column,
  tasks,
  onTaskClick,
  isCollapsed = false,
  onToggleCollapse,
  isMobile = false,
  onMoveToColumn,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <div className={`flex shrink-0 flex-col rounded-xl bg-slate-50/60 ${isMobile ? 'w-full' : 'w-80'}`}>
```

- [x] **Step 3：把 `onMoveToColumn` 與 `isMobile` 透傳給 `SortableTaskCard`**

將：

```tsx
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <SortableTaskCard key={task.id} task={task} onTaskClick={onTaskClick} />
            ))}
          </SortableContext>
```

改為：

```tsx
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                onTaskClick={onTaskClick}
                isMobile={isMobile}
                onMoveToColumn={onMoveToColumn}
              />
            ))}
          </SortableContext>
```

- [x] **Step 4：型別檢查（預期此時會因 `SortableTaskCard` 尚未支援新 props 而報錯，留給 Task 3 修正）——確認 Task 1 的錯誤已消失，只剩 `SortableTaskCard` 缺 props 的錯誤**

```bash
npx tsc -b
```

- [x] **Step 5：Commit**

```bash
git add src/components/BoardColumn.tsx
git commit -m "feat: support mobile width and move-to-column prop passthrough in BoardColumn"
```

---

### Task 3：`SortableTaskCard.tsx` + `TaskCard.tsx` 新增「移動到...」選單

**檔案：**
- 修改：`src/components/SortableTaskCard.tsx`
- 修改：`src/components/TaskCard.tsx`

**介面：**
- 消耗：Task 2 透傳的 `isMobile`, `onMoveToColumn`。
- 產出：`TaskCard` 在 `isMobile === true` 時渲染一個「移動到...」`<select>`，選項為 `columns`（排除目前所在欄位），選擇後呼叫 `onMoveToColumn(task, 選中的columnId)`。

- [x] **Step 1：修改 `SortableTaskCard.tsx`，透傳新 props**

```tsx
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import TaskCard from './TaskCard'
import type { ColumnId, Task } from '../types/task'

interface SortableTaskCardProps {
  task: Task
  onTaskClick?: (task: Task) => void
  isMobile?: boolean
  onMoveToColumn?: (task: Task, targetColumnId: ColumnId) => void
}

export default function SortableTaskCard({
  task,
  onTaskClick,
  isMobile = false,
  onMoveToColumn,
}: SortableTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { columnId: task.columnId, task },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <TaskCard
        task={task}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        onClick={() => onTaskClick?.(task)}
        isMobile={isMobile}
        onMoveToColumn={onMoveToColumn}
      />
    </div>
  )
}
```

- [x] **Step 2：修改 `TaskCard.tsx`，新增「移動到...」選單**

在檔案頂端加入 import：

```tsx
import { columns } from '../data/columns'
import type { ColumnId } from '../types/task'
```

修改 `TaskCardProps` interface：

```tsx
interface TaskCardProps {
  task: Task
  dragHandleProps?: Record<string, unknown>
  isDragging?: boolean
  onClick?: () => void
  isMobile?: boolean
  onMoveToColumn?: (task: Task, targetColumnId: ColumnId) => void
}
```

修改函式簽章：

```tsx
export default function TaskCard({
  task,
  dragHandleProps,
  isDragging,
  onClick,
  isMobile = false,
  onMoveToColumn,
}: TaskCardProps) {
```

在既有的「進度條」區塊（`{typeof task.progress === 'number' && (...)}`）之後、`assignees`/`commentCount` 區塊之前，插入手機模式限定的移動選單：

```tsx
      {isMobile && onMoveToColumn && (
        <div className="mb-2" onClick={(e) => e.stopPropagation()}>
          <select
            value=""
            onChange={(e) => {
              const targetColumnId = e.target.value as ColumnId
              if (targetColumnId) onMoveToColumn(task, targetColumnId)
            }}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
          >
            <option value="">移動到...</option>
            {columns
              .filter((c) => c.id !== task.columnId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </select>
        </div>
      )}
```

（`onClick={(e) => e.stopPropagation()}` 防止點擊選單觸發外層卡片的 `onClick`——即誤開 `TaskDrawer` 編輯視窗；`value=""` + 選完後不手動重置，讓 `<select>` 每次都從「移動到...」這個 placeholder 選項開始，避免顯示卡片剛移動前的舊 columnId 造成混淆。）

- [x] **Step 3：型別檢查**

```bash
npx tsc -b
```

預期結果：無錯誤（Task 1-3 的 props 鏈路完整銜接）。

- [x] **Step 4：Commit**

```bash
git add src/components/SortableTaskCard.tsx src/components/TaskCard.tsx
git commit -m "feat: add move-to-column select menu on TaskCard for mobile mode"
```

---

### Task 4：瀏覽器手動驗證 + Toolbar/TaskDrawer 響應式檢查

**檔案：**
- 視驗證結果決定是否需要修改：`src/components/Toolbar.tsx`

**介面：** 無新增介面，純驗證 + 視情況微調既有 class。

- [x] **Step 1：瀏覽器手動驗證——手機寬度下的看板**（用 iframe 模擬 390px 寬度驗證：單欄+標籤切換正確渲染、「移動到...」選單選項排除當前欄位、選擇後正確透過 `updateTaskApi` 更新後端且畫面即時反映、未誤觸發卡片 onClick）

啟動 `npm run dev`，用瀏覽器 devtools 或直接設定視窗寬度 < 640px（例如 390px，模擬 iPhone）：
1. 確認看板顯示單欄 + 上方橫向標籤列（非多欄橫向排列）。
2. 點擊不同標籤，確認下方顯示對應欄位的卡片列表，且標籤上的數字（任務數量）正確。
3. 確認每張卡片上出現「移動到...」下拉選單，選單選項不包含卡片目前所在的欄位。
4. 選擇一個目標欄位，確認卡片從目前顯示的欄位消失、切到目標欄位標籤後該卡片出現在那裡；用 curl 或瀏覽器 devtools Network 確認 `PATCH /api/tasks/:id` 有帶正確的 `columnId` 送出。
5. 確認點擊「移動到...」選單本身不會誤觸發卡片的 `onClick`（不會意外打開編輯 Drawer）。

- [x] **Step 2：瀏覽器手動驗證——桌面寬度下看板完全不受影響**（1280px 下多欄橫向排列正常、無手機標籤列/移動選單可見、`handleDragEnd` 函式本體未被改動、已完成欄折疊功能正常）

把視窗寬度調回 ≥ 640px（例如 1280px）：
1. 確認看板恢復多欄橫向排列，沒有手機版的標籤列或「移動到...」選單。
2. 確認既有拖拉換欄功能正常運作（拖一張卡片到別的欄位，確認 `columnId` 正確更新）。
3. 確認「已完成」欄位的折疊功能仍正常（桌面版功能不受本次改動影響）。

- [x] **Step 3：檢查 `Toolbar.tsx` 在手機寬度下的呈現**（發現真實問題：中間分頁 tabs 在 390px 下文字換行、高度不一致；已修正為 `overflow-x-auto` + `whitespace-nowrap` + `shrink-0`，改用橫向捲動而非擠壓/換行，重新驗證通過）

在手機寬度（< 640px）下觀察頂部 Toolbar：確認 logo/麵包屑、中間分頁 tabs、右側按鈕群組三個區塊是否有擠壓、溢出或文字被裁切的狀況。若有問題，视情况调整（例如把中間 tabs 加上 `overflow-x-auto`，或在極窄螢幕下隱藏麵包屑的 `codex-taskboard` 文字）；若原有的 `flex-col sm:flex-row` 已經能正常撐開三層排列，則不需修改，記錄「無需調整」即可。

- [x] **Step 4：檢查 `TaskDrawer.tsx` 在手機寬度下的呈現**（實測所有表單欄位皆正常撐滿、無橫向溢出或裁切，無需調整）

在手機寬度下開啟「新增任務」與「編輯任務」的 Drawer：確認表單各欄位（標題、優先級、欄位、標籤 checkbox 群組、負責人 checkbox 群組、進度、自動執行目錄、描述頁籤、留言/執行紀錄頁籤）沒有橫向溢出或文字被裁切。若一切正常，記錄「無需調整」；若有問題，視情況微調（例如 checkbox 群組的 `flex-wrap` 是否生效）。

- [x] **Step 5：Commit（若 Step 3/4 有實際程式碼修改才需要這個 commit；若都是「無需調整」則跳過本步驟，直接進入 Task 5）**——Step 3 有實際修改，已 commit

```bash
git add src/components/Toolbar.tsx
git commit -m "fix: adjust Toolbar responsive layout for mobile width"
```

---

### Task 5：README 同步 + 最終整分支 review

**檔案：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-09-09-mobile-responsive-layout.md`（本檔案）

**介面：** 無（純文件任務）。

- [x] **Step 1：更新 `README.md`**

在「看板設計」章節，補充說明：手機寬度（< 640px）下看板改為單欄 + 標籤切換呈現，任務卡片上會出現「移動到...」選單取代拖拉換欄；桌面寬度（≥ 640px）行為不變。

- [x] **Step 2：最終整分支 review**

- 確認 `src/` 沒有新增 `dangerouslySetInnerHTML`/`innerHTML`/`eval`：0 筆。
- 執行 `npx tsc -b` 與 `npm run lint`，確認皆乾淨：無新增錯誤/警告，僅既有的 2 個 pre-existing warning。
- 確認桌面版（`≥ 640px`）的 `handleDragStart`/`handleDragEnd` 函式本體字元級未被改動：`git diff main -- src/App.tsx` 中這兩個函式僅作為既有呼叫出現，函式本體字元未變動。
- 手動測試「移動到...」選單選到與目前卡片相同的欄位這個邊界情況：程式碼審閱確認 `columns.filter((c) => c.id !== task.columnId)` 邏輯正確，選單不會列出當前欄位；`handleMoveToColumn` 內另有 `if (task.columnId === targetColumnId) return` 作為雙重防禦。
- 清理所有手動驗證過程中建立的測試卡片：已清理（唯一動過的既有卡片 LOCAL-5 已用 curl 復原回 `todo`）。

- [x] **Step 3：Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-09-mobile-responsive-layout.md
git commit -m "docs: sync README with mobile responsive layout, mark plan complete"
```

---

## 本計畫範圍外（依 spec 的「範圍外」章節）

- 不涉及手機模式下停用觸控拖拉。
- 不涉及新增「平板模式」的第三種斷點/佈局。
- 不涉及 Toolbar 的甘特圖/列表視圖等分頁本身內容的手機適配。
- 不涉及 PWA/原生 App 化或離線支援。
