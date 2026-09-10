# 已完成獨立頁面 + 拖放標記完成區 實作計畫

> **給執行的 agent：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐一任務執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤進度。

**目標：** 修正桌面版看板在常見視窗寬度（如 1280px）下因四欄超出容器寬度、`justify-center` 左側溢出永久不可捲動而造成的視覺裁切問題。解法：看板主頁面只顯示三欄（等待認領/處理中/等你確認），新增頁面底部拖放長條把卡片標記為「已完成」，已完成任務改在新增的獨立頁面 `/done` 顯示。

**架構：** 新增 `react-router-dom` 依賴提供路由；`App.tsx` 專注看板主頁邏輯（三欄），新增 `DonePage.tsx` 顯示已完成清單；`data/columns.ts` 新增一個只含前三欄的常數供看板渲染使用，`columns` 全量陣列繼續供 `TaskDrawer`/`TaskCard`「移動到...」選單使用。

**技術選型：** `react-router-dom` 最新穩定版（`^7`），用 `<BrowserRouter>` + `<Routes>`/`<Route>` 標準寫法；不引入額外的狀態管理套件，兩個路由各自呼叫既有的 `fetchTasks()`。

## 全域限制條件

- 不修改資料庫 schema、不刪除任何既有 `done` 狀態的任務資料。
- `columns.ts` 的 `columns` 全量陣列（四個欄位）維持不變，供 `TaskDrawer`/`TaskCard` 選單使用。
- 桌面版拖拉核心邏輯（`DndContext`/`handleDragStart`/現有欄位拖放部分）不得破壞，只新增「底部拖放長條」這一個新的拖放目標。
- 手機模式的底部拖放長條不渲染（沿用既有「移動到...」選單標記完成）。
- 所有新增的使用者可見文字一律使用繁體中文。

---

### Task 1：新增 `react-router-dom` 依賴 + 路由骨架

**檔案：**
- 修改：`package.json`（新增依賴）
- 修改：`src/main.tsx`（包 `<BrowserRouter>`）
- 修改：`src/App.tsx`（改為只負責看板主頁邏輯，之後 Task 2 會再處理三欄篩選）
- 新增：`src/components/DonePage.tsx`（先建立最小可運作的空殼元件，內容留給 Task 4 補完）

**介面：**
- 產出：`/` 路由渲染看板主頁（既有 `App` 元件邏輯），`/done` 路由渲染 `DonePage` 元件。

- [x] **Step 1：安裝依賴**

```bash
npm install react-router-dom
```

- [x] **Step 2：修改 `src/main.tsx`，包一層 `<BrowserRouter>`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [x] **Step 3：建立最小可運作的 `src/components/DonePage.tsx`（空殼，Task 4 補完內容）**

```tsx
import { Link } from 'react-router-dom'

export default function DonePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white p-6">
      <Link to="/" className="mb-4 inline-block text-sm text-slate-500 hover:text-slate-700">
        ← 返回看板
      </Link>
      <h1 className="text-lg font-semibold text-slate-800">已完成任務</h1>
      <p className="mt-4 text-sm text-slate-400">（頁面內容將於後續 Task 補完）</p>
    </div>
  )
}
```

- [x] **Step 4：修改 `src/App.tsx`，在既有 `export default function App()` 外層包一個負責路由分派的元件**

將檔案最上方的 import 區塊新增：

```tsx
import { Routes, Route } from 'react-router-dom'
import DonePage from './components/DonePage'
```

將現有的 `export default function App() { ... }` 整個函式改名為 `function Board() { ... }`（函式內容完全不變，只改名稱），並在檔案最後新增：

```tsx
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Board />} />
      <Route path="/done" element={<DonePage />} />
    </Routes>
  )
}
```

（`Board` 函式維持 `export` 關鍵字移除，不對外匯出，只有最外層新的 `App` 是預設匯出。）

- [x] **Step 5：型別檢查 + 瀏覽器手動驗證**（`/` 顯示既有四欄看板、`/done` 顯示空殼內容並可點擊返回連結、確認為 client-side navigation 而非整頁重載）

```bash
npx tsc -b
```

啟動 `npm run dev`，確認：
1. `http://localhost:8088/` 顯示既有看板（此時應該還是四欄，因為 Task 2 才會改成三欄）。
2. `http://localhost:8088/done` 顯示 `DonePage` 的最小空殼內容，並可點擊「← 返回看板」連結回到 `/`。
3. 瀏覽器網址列的路徑確實跟著切換（`/` ↔ `/done`），非整頁重新載入（React Router 的 client-side navigation）。

- [x] **Step 6：Commit**

```bash
git add package.json package-lock.json src/main.tsx src/App.tsx src/components/DonePage.tsx
git commit -m "feat: add react-router-dom and route skeleton for board and done page"
```

---

### Task 2：看板主頁面改為三欄 + 移除已完成欄折疊邏輯

**檔案：**
- 修改：`src/data/columns.ts`（新增 `BOARD_COLUMNS` 常數）
- 修改：`src/App.tsx`（`Board` 函式：改用 `BOARD_COLUMNS`，移除已完成欄折疊相關程式碼）

**介面：**
- 產出：`BOARD_COLUMNS`（`Column[]`，只含 `todo`/`in_progress`/`review` 三個欄位），供 `Board` 函式的桌面版/手機版渲染迴圈使用。
- 消耗：既有 `columns`（全量四欄，維持不變，供其他元件使用）。

- [x] **Step 1：修改 `src/data/columns.ts`，新增 `BOARD_COLUMNS`**

在檔案最後新增：

```ts
// 看板主頁面只顯示前三欄；「已完成」欄位改在獨立的 /done 頁面呈現，
// 避免四欄總寬度超出常見桌面視窗寬度造成裁切（見 spec 文件背景說明）。
export const BOARD_COLUMNS: Column[] = columns.filter((c) => c.id !== 'done')
```

- [x] **Step 2：修改 `src/App.tsx` 的 `Board` 函式**

移除已完成欄折疊相關的 state 與函式：

```tsx
// 移除這一段（DONE_COLLAPSED_KEY 常數本身也移除）：
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

將 import 區塊的：

```tsx
import { columns } from './data/columns'
```

改為：

```tsx
import { BOARD_COLUMNS } from './data/columns'
```

（`columns` 全量陣列在 `App.tsx` 內若還有其他用途——例如 `handleDragEnd` 內用 `columns.find((c) => c.id === overId)` 判斷拖放目標是否為欄位——則改為 `BOARD_COLUMNS.find(...)` 即可，因為看板主頁面本來就只該辨識這三欄的拖放；`tasksByColumn` 的 `Record<ColumnId, Task[]>` 初始化仍需包含 `done: []`，因為 `tasks` 陣列本身仍可能含有 `done` 狀態的任務，只是不渲染在看板上。）

將桌面版與手機版渲染迴圈中的 `columns.map(...)` 全部改為 `BOARD_COLUMNS.map(...)`，並移除傳給 `BoardColumn` 的 `isCollapsed`/`onToggleCollapse` props（三欄都不需要折疊功能，直接省略這兩個 prop 或明確傳 `false`/`undefined）：

```tsx
{BOARD_COLUMNS.map((column) => (
  <BoardColumn
    key={column.id}
    column={column}
    tasks={tasksByColumn[column.id]}
    onTaskClick={openEditDrawer}
  />
))}
```

（桌面版與手機版兩處迴圈都要同步修改；手機版的 `mobileActiveColumnId` 初始值 `columns[0].id` 也要改成 `BOARD_COLUMNS[0].id`。）

- [x] **Step 3：型別檢查**

```bash
npx tsc -b
```

- [x] **Step 4：瀏覽器手動驗證**（`done` 狀態任務用 curl 建立後確認不出現在看板任何欄位、不報錯；手機模式標籤列也確認只剩三個標籤）

啟動 `npm run dev`，確認：
1. 桌面寬度（≥ 640px）下看板只顯示三欄（等待認領/處理中/等你確認），沒有「已完成」欄。
2. 手機寬度（< 640px，用先前 Task 驗證方式模擬 390px）下標籤列也只有三個標籤。
3. 用 curl 建立一個 `columnId: done` 的任務，確認它不會出現在看板任何欄位（因為 `BOARD_COLUMNS` 不含 `done`），但也不會導致頁面報錯（`tasksByColumn.done` 陣列依然存在，只是沒有被渲染）。

- [x] **Step 5：Commit**

```bash
git add src/data/columns.ts src/App.tsx
git commit -m "feat: limit board page to three columns, remove done column collapse logic"
```

---

### Task 3：新增底部拖放長條，拖曳標記任務為已完成

**檔案：**
- 新增：`src/components/DoneDropZone.tsx`
- 修改：`src/App.tsx`（`Board` 函式：掛載 `DoneDropZone`、`handleDragEnd` 新增判斷邏輯）

**介面：**
- 產出：`DoneDropZone` 元件，內部用 `useDroppable({ id: 'done-drop-zone' })` 註冊拖放目標；接受 `isDragActive: boolean` prop 決定樣式（拖拉進行中時更明顯）。
- 消耗：`Board` 函式現有的 `activeTask` state（判斷是否正在拖拉）。

- [x] **Step 1：建立 `src/components/DoneDropZone.tsx`**

```tsx
import { useDroppable } from '@dnd-kit/core'
import { CheckCircle2 } from 'lucide-react'

interface DoneDropZoneProps {
  isDragActive: boolean
}

export default function DoneDropZone({ isDragActive }: DoneDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'done-drop-zone' })

  return (
    <div
      ref={setNodeRef}
      className={`hidden shrink-0 items-center justify-center gap-2 border-t px-6 py-3 text-sm font-medium transition-colors sm:flex ${
        isOver
          ? 'border-emerald-400 bg-emerald-100 text-emerald-700'
          : isDragActive
            ? 'border-emerald-300 bg-emerald-50 text-emerald-600'
            : 'border-slate-200 bg-slate-50 text-slate-400'
      }`}
    >
      <CheckCircle2 size={16} />
      拖曳到這裡標記為已完成
    </div>
  )
}
```

（`hidden sm:flex` 讓這個長條只在桌面寬度顯示，手機模式不渲染，符合 spec 決策；`isOver` 是 `useDroppable` 內建的即時懸停狀態，`isDragActive` 由外層傳入表示「目前是否有任何卡片正在被拖拉」，兩者疊加控制視覺明顯程度。）

- [x] **Step 2：修改 `src/App.tsx` 的 `Board` 函式，掛載 `DoneDropZone` 並串接拖放邏輯**

在 import 區塊新增：

```tsx
import DoneDropZone from './components/DoneDropZone'
```

修改 `handleDragEnd` 函式，在判斷 `overColumnId` 之前，先處理拖到 `done-drop-zone` 的情況：

```tsx
function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event
  setActiveTask(null)
  if (!over) return

  const draggedTask = tasks.find((t) => t.id === active.id)
  if (!draggedTask) return

  const overId = over.id as string

  // 拖到「拖曳到這裡標記為已完成」長條：直接標記為 done，邏輯與一般欄位拖放共用同一套更新方式
  if (overId === 'done-drop-zone') {
    if (draggedTask.columnId === 'done') return
    setTasks((prev) =>
      prev.map((t) => (t.id === draggedTask.id ? { ...t, columnId: 'done' } : t)),
    )
    updateTaskApi(draggedTask.id, { columnId: 'done' }).catch((err) => {
      console.error('Failed to persist column change', err)
    })
    return
  }

  const overColumnId = (BOARD_COLUMNS.find((c) => c.id === overId)?.id ??
    tasks.find((t) => t.id === overId)?.columnId) as ColumnId | undefined

  // ...其餘既有邏輯不變
}
```

在 JSX 中，`<DragOverlay>` 之前加入 `<DoneDropZone isDragActive={activeTask !== null} />`：

```tsx
          <DoneDropZone isDragActive={activeTask !== null} />
          <DragOverlay>{activeTask ? <TaskCard task={activeTask} /> : null}</DragOverlay>
```

（`DoneDropZone` 放在 `<main>` 外、`<DndContext>` 內部的最後，讓它固定在頁面底部；若目前 `<main>` 的 `overflow-x-auto` 影響到长条的定位，視情況調整為 `<main>` 內部最下方或用 `sticky bottom-0`——實作時依實際渲染結果決定，只要保證视觉上「固定在畫面底部」即可。）

- [x] **Step 3：型別檢查**

```bash
npx tsc -b
```

- [x] **Step 4：瀏覽器手動驗證**（實測發現真實 bug：預設 `closestCorners` 對「窄長條 vs 大面積欄位」碰撞判定系統性偏向大欄位，導致拖到長條上仍被誤判為鄰近欄位；已修正為自訂 `collisionDetection`，優先用 `pointerWithin` 判斷、找不到再 fallback `closestCorners`，修正後大量用 pointer event 模擬驗證通過）

啟動 `npm run dev`：
1. 確認桌面寬度下頁面底部出現「拖曳到這裡標記為已完成」長條，平時樣式較不顯眼（灰色）。
2. 開始拖拉一張卡片（觸發 `handleDragStart`）時，確認長條樣式變化（`isDragActive` 生效，變成淺綠色）。
3. 把卡片拖到長條上放開，確認：
   - 長條在懸停時樣式更明顯（`isOver` 生效，深綠色）。
   - 放開後該卡片從原本的欄位消失（因為看板只顯示三欄，`done` 狀態的任務不會出現在任何欄位）。
   - 用 curl 確認該任務的 `columnId` 已經正確更新為 `done`。
4. 確認手機寬度（< 640px）下，這條長條不會出現（`hidden sm:flex` 生效）。
5. 確認既有的欄位間拖放（例如「等待認領」拖到「處理中」）功能沒有被這次改動影響（用相同 pointer event 模擬拖到「處理中」欄，驗證 `columnId` 正確更新，確認 fallback 邏輯正常）。

- [x] **Step 5：Commit**

```bash
git add src/components/DoneDropZone.tsx src/App.tsx
git commit -m "feat: add drop zone at bottom of board to mark tasks as done"
```

---

### Task 4：`/done` 頁面顯示已完成任務清單

**檔案：**
- 修改：`src/components/DonePage.tsx`（補完內容，取代 Task 1 的空殼）

**介面：**
- 消耗：既有 `fetchTasks()`（`src/lib/api.ts`）、`TaskDrawer`、`Task` 型別。

- [x] **Step 1：補完 `src/components/DonePage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import TaskCard from './TaskCard'
import TaskDrawer from './TaskDrawer'
import { fetchTasks } from '../lib/api'
import type { Task } from '../types/task'

export default function DonePage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  function reload() {
    fetchTasks()
      .then(setTasks)
      .catch((err) => setLoadError(err.message))
  }

  useEffect(() => {
    reload()
    setIsLoading(false)
  }, [])

  const doneTasks = tasks.filter((t) => t.columnId === 'done')

  function openEditDrawer(task: Task) {
    setEditingTask(task)
    setIsDrawerOpen(true)
  }

  function closeDrawer() {
    setIsDrawerOpen(false)
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        載入任務中…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-red-500">
        載入失敗：{loadError}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-white p-6">
      <Link
        to="/"
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={15} />
        返回看板
      </Link>
      <h1 className="mb-4 text-lg font-semibold text-slate-800">
        已完成任務（{doneTasks.length}）
      </h1>
      {doneTasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-16 text-sm text-slate-400">
          目前沒有已完成的任務
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:max-w-2xl">
          {doneTasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => openEditDrawer(task)} />
          ))}
        </div>
      )}
      <TaskDrawer
        isOpen={isDrawerOpen}
        mode="edit"
        initialTask={editingTask ?? undefined}
        onClose={closeDrawer}
        onSaved={reload}
      />
    </div>
  )
}
```

（`TaskCard` 不傳 `dragHandleProps`/`isDragging`，因為此頁面不支援拖拉排序，純點擊開啟編輯即可；點擊任務後透過既有 `TaskDrawer` 的「欄位」下拉選單可以把任務改回其他欄位，改完儲存後 `onSaved={reload}` 會重新拉取清單，若該任務不再是 `done` 狀態就會自動從這個頁面消失。）

- [x] **Step 2：修改 `Toolbar.tsx`，加入「已完成」連結**

在檔案頂端加入 import：

```tsx
import { Link } from 'react-router-dom'
```

在既有右側按鈕群組（搜尋/篩選/新增任務）之前，加入一個顯示已完成數量的連結。因為 `Toolbar` 目前不持有任務清單資料，新增一個 `doneCount` prop：

```tsx
interface ToolbarProps {
  onAddTask: () => void
  doneCount?: number
}

export default function Toolbar({ onAddTask, doneCount = 0 }: ToolbarProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
      {/* ...既有 logo/麵包屑區塊不變... */}
      {/* ...既有中間 tabs 區塊不變... */}
      <div className="flex items-center gap-2">
        <Link
          to="/done"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          已完成 ({doneCount})
        </Link>
        <button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <Search size={16} />
        </button>
        {/* ...既有其餘按鈕不變... */}
      </div>
    </div>
  )
}
```

- [x] **Step 3：修改 `src/App.tsx` 的 `Board` 函式，傳入 `doneCount` 給 `Toolbar`**

```tsx
<Toolbar onAddTask={openCreateDrawer} doneCount={tasksByColumn.done.length} />
```

- [x] **Step 4：型別檢查**

```bash
npx tsc -b
```

- [x] **Step 5：瀏覽器手動驗證**（實測發現真實 bug：`data/options.ts` 的 `COLUMN_OPTIONS` 從未包含 `done`，導致 `TaskDrawer` 的「欄位」下拉選單永遠無法正確顯示/選擇「已完成」；已修正型別與選項清單，重新驗證通過）

啟動 `npm run dev`：
1. 用 curl 建立至少 2 筆 `columnId: done` 的測試任務。
2. 確認 `Toolbar` 顯示「已完成 (2)」（數字與實際筆數相符），點擊後導覽到 `/done`。
3. 確認 `/done` 頁面正確列出這些任務，清單樣式與看板卡片一致（複用 `TaskCard`）。
4. 點擊其中一張任務卡片，確認 `TaskDrawer` 正確開啟，顯示該任務的既有資料（含「欄位」下拉正確顯示「已完成」）。
5. 在 `TaskDrawer` 把「欄位」改回「等你確認」並儲存，確認：
   - `/done` 頁面清單即時更新，該任務消失，數量變成 1。
   - 導覽回 `/` 看板主頁，確認該任務出現在「等你確認」欄位。
6. 清理所有測試任務。

- [x] **Step 6：Commit**（實際 commit 額外納入 `src/data/options.ts` 的修正）

```bash
git add src/components/DonePage.tsx src/components/Toolbar.tsx src/App.tsx src/data/options.ts
git commit -m "feat: implement done page task list and toolbar link; fix: add done option to COLUMN_OPTIONS"
```

---

### Task 5：README 同步 + 最終整分支 review

**檔案：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-09-10-done-page-drop-zone.md`（本檔案）

**介面：** 無（純文件任務）。

- [x] **Step 1：更新 `README.md`**

在「看板設計」章節，說明看板主頁面現在只顯示三欄，「已完成」狀態的任務改在 `/done` 獨立頁面顯示；新增「已完成頁面」小節說明如何標記任務完成（拖到底部長條，或在 `TaskDrawer`/手機版「移動到...」選單手動選「已完成」）以及如何查看（Toolbar 上的「已完成」連結）。移除舊版「已完成欄位可折疊」的說明段落（該功能已被本次改動取代）。

- [x] **Step 2：最終整分支 review**

- 確認 `src/` 沒有新增 `dangerouslySetInnerHTML`/`innerHTML`/`eval`：0 筆。
- 執行 `npx tsc -b` 與 `npm run lint`，確認皆乾淨：無新增錯誤/警告，僅既有的 2 個 pre-existing warning（`DonePage.tsx` 一度新增 1 個 `set-state-in-effect` warning，已比照 `CommentList.tsx`/`AutomationRunList.tsx` 的具名 `reload()` 函式模式修正）。
- 用瀏覽器把視窗寬度設回先前重現 bug 的 1280px，確認三欄看板不再出現任何裁切：`main.scrollWidth (1265) <= main.clientWidth (1265)`，`needsScroll: false`，原始跑版問題徹底修復。
- 確認既有的欄位間拖放（三欄之間）與新的「拖到底部標記完成」兩種拖放路徑都正常運作，互不干擾：Task 3 已用 pointer event 模擬完整驗證，兩種路徑皆正確更新後端 `columnId`。
- 確認手機模式（< 640px）下：看板只有三個標籤、底部拖放長條不出現（`display: none`）、`TaskCard` 的「移動到...」選單依然包含「已完成」選項（選單資料來源是全量 `columns`，不受 `BOARD_COLUMNS` 影響）。
- 清理所有手動驗證過程中建立的測試卡片：已清理。

- [x] **Step 3：Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-10-done-page-drop-zone.md
git commit -m "docs: sync README with done page and drop zone, mark plan complete"
```

---

## 本計畫範圍外（依 spec 的「範圍外」章節）

- 不涉及底部拖放長條在手機模式下的替代呈現。
- 不涉及 `/done` 頁面內任務的排序、篩選、搜尋功能。
- 不涉及把「已完成」從 `ColumnId` 型別移除或修改資料庫 schema。
- 不涉及 `justify-center` 裁切 bug 本身的修正（三欄後不會再觸發）。
