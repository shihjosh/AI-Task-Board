# Phase 5：搜尋、標籤篩選、多視圖（列表 / 甘特圖） 實作計畫

> **給執行的 agent：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐一任務執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤進度。

**目標：** 依序實作四個子功能——① 任務標題搜尋、② 標籤複選篩選、③ 列表視圖、④ 甘特圖（含新增 `dueDate` 欄位）。全部為看板主頁（`/` 路由）內的新增能力，`/done` 頁面不受影響。

**架構：** `Board` 元件新增 `searchQuery`/`selectedTagTypes`/`activeView` 三個 state；抽出共用的 `filterTasks()` 過濾函式供看板/列表/甘特圖三種視圖共用；`Toolbar` 新增 props 控制分頁高亮與搜尋/篩選 UI 掛載點。甘特圖需要資料庫新增 `due_date` 欄位（比照既有 migration 模式）。

**技術選型：** 不新增 npm 依賴；甘特圖用純 CSS/Tailwind 手刻橫向時間軸；日期輸入用原生 `<input type="date">`。

## 全域限制條件

- 不修改既有拖拉、標記完成、路由等既有功能的行為。
- 搜尋/篩選為純前端邏輯，不新增後端搜尋 API。
- 所有新增的使用者可見文字一律使用繁體中文。
- 甘特圖不使用任何第三方甘特圖套件。

---

### Task 1：搜尋功能

**檔案：**
- 新增：`src/components/SearchBox.tsx`
- 修改：`src/components/Toolbar.tsx`
- 修改：`src/App.tsx`

**介面：**
- 產出：`SearchBox` 元件，props `{ value: string; onChange: (v: string) => void }`。
- 產出：`Board` 新增 `searchQuery: string` state 與 `filterTasks(tasks, searchQuery, selectedTagTypes)` 純函式（本 Task 先只用到 `searchQuery` 參數，`selectedTagTypes` 留給 Task 2 使用，型別先定義好）。

- [x] **Step 1：建立 `src/components/SearchBox.tsx`**

```tsx
import { useState } from 'react'
import { Search, X } from 'lucide-react'

interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
}

export default function SearchBox({ value, onChange }: SearchBoxProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!isExpanded && !value) {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label="搜尋"
      >
        <Search size={16} />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1">
      <Search size={14} className="text-slate-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="搜尋任務標題…"
        autoFocus
        className="w-32 text-sm outline-none sm:w-48"
      />
      <button
        type="button"
        onClick={() => {
          onChange('')
          setIsExpanded(false)
        }}
        className="text-slate-400 hover:text-slate-600"
        aria-label="清除搜尋"
      >
        <X size={14} />
      </button>
    </div>
  )
}
```

- [x] **Step 2：修改 `src/components/Toolbar.tsx`，掛載 `SearchBox` 取代原本靜態搜尋按鈕**

在檔案頂端加入 import：

```tsx
import SearchBox from './SearchBox'
```

修改 `ToolbarProps` interface，新增 `searchQuery`/`onSearchChange`：

```tsx
interface ToolbarProps {
  onAddTask: () => void
  doneCount?: number
  searchQuery: string
  onSearchChange: (value: string) => void
}
```

修改函式簽章：

```tsx
export default function Toolbar({ onAddTask, doneCount = 0, searchQuery, onSearchChange }: ToolbarProps) {
```

將既有的：

```tsx
        <button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <Search size={16} />
        </button>
```

替換為：

```tsx
        <SearchBox value={searchQuery} onChange={onSearchChange} />
```

（此時 `Search` icon 的 import 若只剩篩選按鈕使用，保留 import；若無其他用途則移除，依實際檔案內容決定。）

- [x] **Step 3：修改 `src/App.tsx`，新增搜尋 state 與過濾邏輯**

在 `Board` 函式內，`mobileActiveColumnId` state 之後加入：

```tsx
  const [searchQuery, setSearchQuery] = useState('')
```

在 `tasksByColumn` 的 `useMemo` 之前，新增過濾邏輯（篩選出符合搜尋條件的任務清單，再交給既有的 `tasksByColumn` 分組）：

```tsx
  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return tasks
    return tasks.filter((t) => t.title.toLowerCase().includes(query))
  }, [tasks, searchQuery])
```

將既有的：

```tsx
  const tasksByColumn = useMemo(() => {
    const map: Record<ColumnId, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
    for (const task of tasks) {
      map[task.columnId].push(task)
    }
    return map
  }, [tasks])
```

改為依賴 `filteredTasks`：

```tsx
  const tasksByColumn = useMemo(() => {
    const map: Record<ColumnId, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
    for (const task of filteredTasks) {
      map[task.columnId].push(task)
    }
    return map
  }, [filteredTasks])
```

（`handleDragEnd`/`handleMoveToColumn` 內部操作的 `tasks`/`setTasks` 仍是全量原始清單，不受過濾影響，確保拖拉/API 呼叫的資料完整性不受搜尋條件干擾。）

修改 `<Toolbar>` 呼叫處，傳入新 props：

```tsx
<Toolbar
  onAddTask={openCreateDrawer}
  doneCount={tasksByColumn.done.length}
  searchQuery={searchQuery}
  onSearchChange={setSearchQuery}
/>
```

- [x] **Step 4：型別檢查**

```bash
npx tsc -b
```

- [x] **Step 5：瀏覽器手動驗證**

啟動 `npm run dev`：
1. 點擊搜尋圖示，確認展開輸入框並自動 focus：通過。
2. 輸入部分關鍵字，確認看板即時只顯示標題包含該字串的任務：通過（測試「圖片」關鍵字，只顯示 LOCAL-5）。
3. 清空輸入或點擊 X，確認恢復顯示全部任務、搜尋框收合：通過。
4. 確認手機模式（< 640px）下搜尋功能同樣正常運作：通過（用 iframe 模擬 390px，搜尋「議題」正確過濾標籤數量從 5 變 1）。
5. 確認種子資料筆數不受過濾邏輯影響（`tasks`/`setTasks` 仍操作全量清單）：curl 確認任務總數維持 10 筆。

- [x] **Step 6：Commit**

```bash
git add src/components/SearchBox.tsx src/components/Toolbar.tsx src/App.tsx
git commit -m "feat: add task title search"
```

---

### Task 2：標籤篩選功能

**檔案：**
- 新增：`src/components/TagFilterPanel.tsx`
- 修改：`src/components/Toolbar.tsx`
- 修改：`src/App.tsx`

**介面：**
- 產出：`TagFilterPanel` 元件，props `{ selected: TagType[]; onChange: (tags: TagType[]) => void }`。
- 消耗：Task 1 的 `filteredTasks` 邏輯位置，擴充加入標籤篩選條件。

- [x] **Step 1：建立 `src/components/TagFilterPanel.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { TAG_OPTIONS } from '../data/options'
import type { TagType } from '../types/task'

interface TagFilterPanelProps {
  selected: TagType[]
  onChange: (tags: TagType[]) => void
}

export default function TagFilterPanel({ selected, onChange }: TagFilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleTag(type: TagType) {
    onChange(selected.includes(type) ? selected.filter((t) => t !== type) : [...selected, type])
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label="篩選標籤"
      >
        <SlidersHorizontal size={16} />
        {selected.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900 text-[9px] font-medium text-white">
            {selected.length}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          {TAG_OPTIONS.map((tag) => (
            <label key={tag.type} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                checked={selected.includes(tag.type)}
                onChange={() => toggleTag(tag.type)}
              />
              {tag.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [x] **Step 2：修改 `src/components/Toolbar.tsx`，掛載 `TagFilterPanel` 取代原本靜態篩選按鈕**

在檔案頂端加入 import：

```tsx
import TagFilterPanel from './TagFilterPanel'
import type { TagType } from '../types/task'
```

修改 `ToolbarProps` interface，新增 `selectedTagTypes`/`onTagTypesChange`：

```tsx
interface ToolbarProps {
  onAddTask: () => void
  doneCount?: number
  searchQuery: string
  onSearchChange: (value: string) => void
  selectedTagTypes: TagType[]
  onTagTypesChange: (tags: TagType[]) => void
}
```

修改函式簽章加入新 props，並將既有的：

```tsx
        <button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <SlidersHorizontal size={16} />
        </button>
```

替換為：

```tsx
        <TagFilterPanel selected={selectedTagTypes} onChange={onTagTypesChange} />
```

（若 `SlidersHorizontal` 圖示 import 因此不再被 `Toolbar.tsx` 直接使用，移除該 import。）

- [x] **Step 3：修改 `src/App.tsx`，擴充過濾邏輯納入標籤條件**

在 `searchQuery` state 之後加入：

```tsx
  const [selectedTagTypes, setSelectedTagTypes] = useState<TagType[]>([])
```

修改 `import type { ColumnId, Task } from './types/task'` 為：

```tsx
import type { ColumnId, Task, TagType } from './types/task'
```

修改 `filteredTasks` 的 `useMemo`：

```tsx
  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return tasks.filter((t) => {
      const matchesQuery = !query || t.title.toLowerCase().includes(query)
      const matchesTags =
        selectedTagTypes.length === 0 || t.tags.some((tag) => selectedTagTypes.includes(tag.type))
      return matchesQuery && matchesTags
    })
  }, [tasks, searchQuery, selectedTagTypes])
```

修改 `<Toolbar>` 呼叫處，傳入新 props：

```tsx
<Toolbar
  onAddTask={openCreateDrawer}
  doneCount={tasksByColumn.done.length}
  searchQuery={searchQuery}
  onSearchChange={setSearchQuery}
  selectedTagTypes={selectedTagTypes}
  onTagTypesChange={setSelectedTagTypes}
/>
```

- [x] **Step 4：型別檢查**

```bash
npx tsc -b
```

- [x] **Step 5：瀏覽器手動驗證**

啟動 `npm run dev`：
1. 點擊篩選圖示，確認彈出面板列出 4 個標籤 checkbox：通過。
2. 勾選「Issue」，確認看板只顯示帶有該標籤的任務（3 筆）；徽章顯示「1」：通過。
3. 勾選第二個「GitHub」，確認顯示邏輯是 OR（顯示 7 筆），徽章變成「2」：通過。
4. 同時輸入搜尋字串「圖片」+ 已勾選 GitHub/Issue，確認兩者為 AND 關係（只剩 1 筆同時符合）：通過。
5. 點擊面板外部（`document.body.click()`），確認面板正確關閉：通過。

- [x] **Step 6：Commit**

```bash
git add src/components/TagFilterPanel.tsx src/components/Toolbar.tsx src/App.tsx
git commit -m "feat: add tag filter panel with OR logic across selected tags"
```

---

### Task 3：列表視圖

**檔案：**
- 新增：`src/components/ListView.tsx`
- 修改：`src/components/Toolbar.tsx`
- 修改：`src/App.tsx`

**介面：**
- 產出：`ListView` 元件，props `{ tasks: Task[]; onTaskClick: (task: Task) => void }`。
- 產出：`Board` 新增 `activeView: 'board' | 'list' | 'gantt'` state，控制主內容區渲染哪個視圖。

- [ ] **Step 1：建立 `src/components/ListView.tsx`**

```tsx
import { columns } from '../data/columns'
import type { Task } from '../types/task'

interface ListViewProps {
  tasks: Task[]
  onTaskClick: (task: Task) => void
}

const priorityLabel: Record<Task['priority'], string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export default function ListView({ tasks, onTaskClick }: ListViewProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-16 text-sm text-slate-400">
        沒有符合條件的任務
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2.5">標題</th>
            <th className="px-4 py-2.5">欄位</th>
            <th className="px-4 py-2.5">優先級</th>
            <th className="px-4 py-2.5">負責人</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {tasks.map((task) => {
            const column = columns.find((c) => c.id === task.columnId)
            return (
              <tr
                key={task.id}
                onClick={() => onTaskClick(task)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-4 py-2.5 font-medium text-slate-800">{task.title}</td>
                <td className="px-4 py-2.5 text-slate-600">{column?.title ?? task.columnId}</td>
                <td className="px-4 py-2.5 text-slate-600">{priorityLabel[task.priority]}</td>
                <td className="px-4 py-2.5 text-slate-600">
                  {task.assignees.map((a) => a.name).join('、') || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2：修改 `src/components/Toolbar.tsx`，讓分頁按鈕真正可切換**

修改頂部的 `tabs` 常數改為結構化資料（含對應的 view id）：

```tsx
const tabs: { id: 'dashboard' | 'board' | 'list' | 'gantt'; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'board', label: '議題看板' },
  { id: 'list', label: '列表視圖' },
  { id: 'gantt', label: '甘特圖' },
]
```

修改 `ToolbarProps` interface，新增 `activeView`/`onViewChange`：

```tsx
interface ToolbarProps {
  onAddTask: () => void
  doneCount?: number
  searchQuery: string
  onSearchChange: (value: string) => void
  selectedTagTypes: TagType[]
  onTagTypesChange: (tags: TagType[]) => void
  activeView: 'board' | 'list' | 'gantt'
  onViewChange: (view: 'board' | 'list' | 'gantt') => void
}
```

修改分頁渲染區塊（原本用 `i === 1` 寫死高亮「議題看板」，改為依 `activeView` 判斷；`Dashboard` 分頁點擊時維持無反應，範圍外）：

```tsx
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              if (tab.id === 'dashboard') return
              onViewChange(tab.id)
            }}
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
              activeView === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
```

（`Dashboard` 分頁本身不對應任何 `activeView` 值，因此永遠不會呈現 `activeView === tab.id` 為真的高亮狀態，符合 spec「維持無功能的靜態按鈕」的決策。）

- [ ] **Step 3：修改 `src/App.tsx`，新增 `activeView` state 與視圖切換渲染**

在 `selectedTagTypes` state 之後加入：

```tsx
  const [activeView, setActiveView] = useState<'board' | 'list' | 'gantt'>('board')
```

在 JSX 的 `<main>` 區塊內，把原本的看板渲染（`<DndContext>...</DndContext>`）包一層條件判斷，`activeView === 'board'` 時才渲染看板，`activeView === 'list'` 時渲染 `<ListView>`（`activeView === 'gantt'` 留給 Task 4 處理，本步驟先讓 `ListView` 可以正常顯示）：

```tsx
      <main className="flex-1 overflow-x-auto bg-slate-50 px-6 py-5">
        {activeView === 'board' && (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* ...既有看板 JSX 不變... */}
          </DndContext>
        )}
        {activeView === 'list' && (
          <ListView tasks={filteredTasks} onTaskClick={openEditDrawer} />
        )}
      </main>
```

在 import 區塊加入：

```tsx
import ListView from './components/ListView'
```

修改 `<Toolbar>` 呼叫處，傳入新 props：

```tsx
<Toolbar
  onAddTask={openCreateDrawer}
  doneCount={tasksByColumn.done.length}
  searchQuery={searchQuery}
  onSearchChange={setSearchQuery}
  selectedTagTypes={selectedTagTypes}
  onTagTypesChange={setSelectedTagTypes}
  activeView={activeView}
  onViewChange={setActiveView}
/>
```

- [ ] **Step 4：型別檢查**

```bash
npx tsc -b
```

- [ ] **Step 5：瀏覽器手動驗證**

啟動 `npm run dev`：
1. 點擊「列表視圖」分頁，確認畫面從看板切換成表格，顯示標題/欄位/優先級/負責人四欄。
2. 確認表格列數與目前任務總數（扣除 `done` 狀態，因為看板本來就不含已完成任務——注意：列表視圖顯示範圍是否含 `done` 任務需確認，若 `filteredTasks` 含全部欄位含 `done`，則列表視圖應該也顯示已完成任務，與看板範圍不同，這是預期行為，因為列表視圖是「攤平顯示全部任務」）。
3. 點擊任一列，確認 `TaskDrawer` 正確開啟顯示該任務。
4. 切回「議題看板」分頁，確認看板正常顯示、拖拉功能正常。
5. 在列表視圖下輸入搜尋字串／勾選標籤篩選，確認表格內容即時過濾（因為共用 `filteredTasks`）。

- [ ] **Step 6：Commit**

```bash
git add src/components/ListView.tsx src/components/Toolbar.tsx src/App.tsx
git commit -m "feat: add list view with table layout, wire up toolbar view switching"
```

---

### Task 4：甘特圖（含新增 `dueDate` 欄位）

**檔案：**
- 修改：`server/db.mjs`（新增 `due_date` 欄位 migration）
- 修改：`server/taskRepository.mjs`（`rowToTask`/`createTask`/`updateTask` 支援 `dueDate`）
- 修改：`server/index.mjs`（`CREATABLE_FIELDS` 加入 `dueDate`）
- 修改：`src/types/task.ts`（`Task` interface 加入 `dueDate?: string`）
- 修改：`src/components/TaskDrawer.tsx`（新增日期輸入欄位）
- 新增：`src/components/GanttView.tsx`
- 修改：`src/App.tsx`（掛載 `GanttView`）

**介面：**
- 產出：`GanttView` 元件，props `{ tasks: Task[]; onTaskClick: (task: Task) => void }`。
- 產出：`Task.dueDate?: string`（`YYYY-MM-DD` 格式）。

- [ ] **Step 1：`server/db.mjs` 新增 `due_date` 欄位 migration**

在既有的 `hasAutomationStatus` migration 區塊之後加入：

```js
  const hasDueDate = taskColumns.some((col) => col.name === 'due_date')
  if (!hasDueDate) {
    db.exec(`ALTER TABLE tasks ADD COLUMN due_date TEXT`)
  }
```

- [ ] **Step 2：`server/taskRepository.mjs` 支援 `dueDate` 讀寫**

`rowToTask` 函式內加入：

```js
    dueDate: row.due_date ?? undefined,
```

`createTask` 的 SQL 與參數物件加入 `due_date`/`dueDate`：

```js
  db.prepare(
    `INSERT INTO tasks (id, title, description, priority, tags, assignees, progress, comment_count, has_unread, column_id, created_at, updated_at, target_path, automation_status, due_date)
     VALUES (@id, @title, @description, @priority, @tags, @assignees, @progress, @commentCount, @hasUnread, @columnId, @createdAt, @updatedAt, @targetPath, @automationStatus, @dueDate)`,
  ).run({
    // ...既有欄位不變...
    dueDate: input.dueDate ?? null,
  })
```

`updateTask` 的 `merged` 物件與 SQL 加入 `dueDate`/`due_date`：

```js
  const merged = {
    // ...既有欄位不變...
    dueDate: patch.dueDate !== undefined ? patch.dueDate : existing.due_date,
  }

  db.prepare(
    `UPDATE tasks SET title=@title, description=@description, priority=@priority, tags=@tags, assignees=@assignees,
     progress=@progress, comment_count=@commentCount, has_unread=@hasUnread,
     column_id=@columnId, updated_at=@updatedAt, target_path=@targetPath, automation_status=@automationStatus, due_date=@dueDate WHERE id=@id`,
  ).run({ ...merged, id })
```

- [ ] **Step 3：`server/index.mjs` 的 `CREATABLE_FIELDS` 加入 `'dueDate'`**

```js
const CREATABLE_FIELDS = [
  'title',
  'priority',
  'tags',
  'assignees',
  'progress',
  'commentCount',
  'hasUnread',
  'columnId',
  'description',
  'targetPath',
  'automationStatus',
  'dueDate',
]
```

（依實際檔案現有陣列內容調整插入位置，維持既有欄位順序不變，只新增 `'dueDate'`。）

- [ ] **Step 4：後端驗證與資料庫 migration 手動測試**

```bash
node server/index.mjs &
sleep 1
curl -s -X POST http://localhost:3001/api/tasks -H 'Content-Type: application/json' \
  -d '{"title":"甘特圖測試","priority":"low","columnId":"todo","dueDate":"2026-09-30"}'
kill %1
```

確認回應的 `task.dueDate` 正確為 `"2026-09-30"`；用 `sqlite3` 或既有 db 檢查工具確認舊資料庫 migration 後既有任務的 `due_date` 為 `NULL`、不影響既有任務讀取。

- [ ] **Step 5：`src/types/task.ts` 新增 `dueDate` 欄位**

```ts
export interface Task {
  // ...既有欄位不變...
  dueDate?: string // 預計完成日期，YYYY-MM-DD 格式，選填
}
```

- [ ] **Step 6：`TaskDrawer.tsx` 新增「預計完成日期」輸入欄位**

在 `emptyFormState` 加入 `dueDate: ''`；`useEffect` 內的表單初始化加入 `dueDate: initialTask.dueDate ?? ''`；`buildPayload()` 回傳物件加入 `dueDate: form.dueDate || undefined`。

在「進度」欄位之後、「自動執行目錄」欄位之前，新增：

```tsx
        <label className="mb-6 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">預計完成日期（選填）</span>
          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
```

- [ ] **Step 7：建立 `src/components/GanttView.tsx`**

```tsx
import { useState, useMemo } from 'react'
import type { Task } from '../types/task'

interface GanttViewProps {
  tasks: Task[]
  onTaskClick: (task: Task) => void
}

type Granularity = 'week' | 'month'

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export default function GanttView({ tasks, onTaskClick }: GanttViewProps) {
  const [granularity, setGranularity] = useState<Granularity>('week')

  const tasksWithDueDate = useMemo(
    () => tasks.filter((t) => t.dueDate),
    [tasks],
  )

  const { rangeStart, rangeEnd, dayCount } = useMemo(() => {
    const now = new Date()
    const start = granularity === 'week' ? startOfWeek(now) : startOfMonth(now)
    const days = granularity === 'week' ? 7 : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const end = addDays(start, days - 1)
    return { rangeStart: start, rangeEnd: end, dayCount: days }
  }, [granularity])

  function dayOffset(dateStr: string): number {
    const d = new Date(dateStr)
    d.setHours(0, 0, 0, 0)
    const diffMs = d.getTime() - rangeStart.getTime()
    return Math.round(diffMs / (1000 * 60 * 60 * 24))
  }

  const dayLabels = useMemo(() => {
    return Array.from({ length: dayCount }, (_, i) => formatDate(addDays(rangeStart, i)))
  }, [rangeStart, dayCount])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 self-end rounded-lg bg-slate-100 p-1">
        {(['week', 'month'] as Granularity[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGranularity(g)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              granularity === g ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {g === 'week' ? '週檢視' : '月檢視'}
          </button>
        ))}
      </div>

      {tasksWithDueDate.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-16 text-sm text-slate-400">
          沒有設定「預計完成日期」的任務，甘特圖暫無內容可顯示
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <div className="grid" style={{ gridTemplateColumns: `160px repeat(${dayCount}, minmax(32px, 1fr))` }}>
            <div className="border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
              任務
            </div>
            {dayLabels.map((label, i) => (
              <div
                key={i}
                className="border-b border-slate-200 bg-slate-50 px-1 py-2 text-center text-[10px] text-slate-400"
              >
                {label}
              </div>
            ))}

            {tasksWithDueDate.map((task) => {
              const createdOffset = Math.max(0, dayOffset(task.createdAt))
              const dueOffset = Math.min(dayCount - 1, dayOffset(task.dueDate as string))
              const barStart = Math.max(0, createdOffset)
              const barLength = Math.max(1, dueOffset - barStart + 1)
              return (
                <>
                  <button
                    key={`${task.id}-label`}
                    type="button"
                    onClick={() => onTaskClick(task)}
                    className="truncate border-r border-slate-100 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                  >
                    {task.title}
                  </button>
                  <div
                    key={`${task.id}-bar`}
                    className="relative py-2"
                    style={{ gridColumn: `2 / span ${dayCount}` }}
                  >
                    {dueOffset >= 0 && barStart < dayCount && (
                      <button
                        type="button"
                        onClick={() => onTaskClick(task)}
                        className="absolute h-4 rounded bg-sky-400 hover:bg-sky-500"
                        style={{
                          left: `${(barStart / dayCount) * 100}%`,
                          width: `${(barLength / dayCount) * 100}%`,
                        }}
                        title={task.title}
                      />
                    )}
                  </div>
                </>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
```

（此為簡易 CSS Grid 手刻甘特圖，橫條用絕對定位在跨欄的容器內依比例呈現；若實作時發現 grid 版面與絕對定位混用有渲染問題，可改用固定寬度欄位 + flex 手動計算 px 寬度的做法，只要維持不引入第三方套件即可，實作時依實際渲染結果調整細節但不得改變「橫軸日期/縱軸任務」的呈現方式。）

- [ ] **Step 8：修改 `src/App.tsx`，掛載 `GanttView`**

在 import 區塊加入：

```tsx
import GanttView from './components/GanttView'
```

在 `<main>` 區塊內 `activeView === 'list'` 分支之後，加入：

```tsx
        {activeView === 'gantt' && (
          <GanttView tasks={filteredTasks} onTaskClick={openEditDrawer} />
        )}
```

- [ ] **Step 9：型別檢查**

```bash
npx tsc -b
```

- [ ] **Step 10：瀏覽器手動驗證**

啟動 `npm run dev`：
1. 建立至少 2 筆帶有不同 `dueDate` 的測試任務（用 `TaskDrawer` 手動填寫「預計完成日期」，一筆填今天+3天、一筆填今天+10天）。
2. 點擊「甘特圖」分頁，確認橫軸顯示日期刻度（預設週檢視顯示 7 天），縱軸列出這兩筆任務，各自畫出從建立日到預計完成日的橫條。
3. 點擊「月檢視」切換按鈕，確認日期軸改為顯示當月天數，橫條位置正確依比例重新計算。
4. 點擊某筆任務的橫條或標題，確認 `TaskDrawer` 正確開啟。
5. 建立一筆沒有填 `dueDate` 的任務，確認該任務不出現在甘特圖清單中（因 `tasksWithDueDate` 過濾邏輯排除）。
6. 清理所有測試任務。

- [ ] **Step 11：Commit**

```bash
git add server/db.mjs server/taskRepository.mjs server/index.mjs src/types/task.ts src/components/TaskDrawer.tsx src/components/GanttView.tsx src/App.tsx
git commit -m "feat: add due date field and gantt view with week/month granularity"
```

---

### Task 5：README 同步 + 最終整分支 review

**檔案：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-09-10-phase5-search-filter-views.md`（本檔案）

**介面：** 無（純文件任務）。

- [ ] **Step 1：更新 `README.md`**

新增章節說明：搜尋（只搜標題，前端即時過濾）、標籤篩選（複選、OR 邏輯、與搜尋 AND 組合）、列表視圖（表格呈現，點擊列開編輯）、甘特圖（需填寫「預計完成日期」才會顯示橫條，週/月檢視切換）。更新資料模型章節，補充 `Task.dueDate` 欄位說明；更新 API 端點/`CREATABLE_FIELDS` 說明。

- [ ] **Step 2：最終整分支 review**

- 確認 `src/` 沒有新增 `dangerouslySetInnerHTML`/`innerHTML`/`eval`。
- 執行 `npx tsc -b` 與 `npm run lint`，確認皆乾淨（無新增錯誤/警告；既有的 2 個 pre-existing warning 不算新增）。
- 確認既有拖拉、標記完成、路由切換功能都沒有被本次改動影響（手動測試一輪）。
- 確認 `/done` 頁面不受搜尋/標籤篩選/視圖切換影響（`/done` 是獨立元件樹，本次改動未觸碰 `DonePage.tsx`）。
- 確認搜尋、標籤篩選、視圖切換三者互相獨立正常運作、可同時使用（例如列表視圖 + 搜尋 + 標籤篩選同時生效）。
- 用舊資料庫檔案測試 `due_date` migration 不會遺失既有任務資料（比照先前欄位 migration 的驗證方式：記錄 migration 前後任務筆數一致）。
- 清理所有手動驗證過程中建立的測試卡片，確保種子資料筆數不變。

- [ ] **Step 3：Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-10-phase5-search-filter-views.md
git commit -m "docs: sync README with Phase 5 search, filter, and multi-view features, mark plan complete"
```

---

## 本計畫範圍外（依 spec 的「範圍外」章節）

- 不涉及搜尋描述/留言內容。
- 不涉及標籤以外的篩選維度（優先級、負責人）。
- 不涉及列表視圖表頭排序。
- 不涉及甘特圖橫條拖拉調整日期。
- 不涉及 `Dashboard` 分頁功能實作。
- 不涉及 `/done` 頁面套用搜尋/篩選條件。
- 不涉及引入第三方甘特圖套件。
