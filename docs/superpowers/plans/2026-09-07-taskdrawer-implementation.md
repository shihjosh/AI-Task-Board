# Phase 2.1：新增/編輯任務 UI（TaskDrawer）實作計畫

> **給 agent 執行者：** 必要子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐一 Task 執行本計畫。步驟採用 checkbox（`- [ ]`）語法追蹤進度。

**目標：** 在既有的 AI Task Board 前端加上「新增任務」與「點擊卡片編輯」的 UI 互動，透過共用的側邊抽屜（Drawer）元件呼叫既有的 `createTaskApi`/`updateTaskApi`/`deleteTaskApi`，讓使用者無需直接呼叫 API 就能管理任務。

**架構：** 新增 `TaskDrawer.tsx` 元件，從右側滑出的固定面板，透過 `mode: 'create' | 'edit'` 切換新增/編輯行為。`App.tsx` 管理 Drawer 開關狀態與目前編輯中的任務；`Toolbar` 的「新增任務」按鈕與 `TaskCard` 的點擊事件都會開啟同一個 Drawer。表單提交後呼叫對應 API，成功後重新 `fetchTasks()` 更新畫面。

**技術棧：** 沿用現有 React + TypeScript + Tailwind CSS，不新增任何套件。

## 全域限制

- 不新增任何 npm 套件（不用額外表單庫、不用動畫庫，Tailwind + useState 手刻）
- tags 與 assignees 皆為**固定選單**，不開放自由輸入新增選項
  - tags 固定選項（4 種，對應 `TagType`）：`github`（標籤文字 "GitHub"）、`issue`（"Issue"）、`bug`（"BUG"）、`pr`（"PR"）
  - assignees 固定選項（3 位，對應現有 seed 資料）：
    - `{ id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' }`
    - `{ id: 'u2', name: 'Amy', avatarColor: 'bg-orange-500', initials: 'AM' }`
    - `{ id: 'u3', name: 'Ken', avatarColor: 'bg-blue-500', initials: 'KN' }`
- 儲存/刪除成功後一律重新呼叫 `fetchTasks()` 更新列表（不做樂觀本地更新）
- `TaskCard` 的點擊開啟編輯，需與既有 dnd-kit 拖拉手勢（`activationConstraint: { distance: 5 }`）共存，不能互相干擾
- 編輯模式下的刪除需要 `window.confirm()` 二次確認
- 既有元件的既有 props 與行為不可破壞（拖拉換欄位功能必須維持正常）

> **注意（Task 3 執行中發現）：** 根目錄 `tsconfig.json` 是 solution-style project references，直接執行裸的 `npx tsc --noEmit` 會 exit 0、看不到任何型別錯誤（不會實際檢查 `src/` 底下的檔案）。後續所有 Task 的型別驗證步驟，請改用 `npx tsc -b` 才能看到真實的編譯錯誤。

---

### Task 1：固定選單常數與型別擴充

**檔案：**
- 新增：`src/data/options.ts`

**介面：**
- 產出：
  - `TAG_OPTIONS: { type: TagType; label: string }[]`（4 筆固定選項）
  - `ASSIGNEE_OPTIONS: Assignee[]`（3 筆固定選項，型別來自 `src/types/task.ts`）

- [x] **Step 1：撰寫 `src/data/options.ts`**

```typescript
import type { Assignee, Tag, TagType } from '../types/task'

export const TAG_OPTIONS: Tag[] = [
  { type: 'github', label: 'GitHub' },
  { type: 'issue', label: 'Issue' },
  { type: 'bug', label: 'BUG' },
  { type: 'pr', label: 'PR' },
]

export const ASSIGNEE_OPTIONS: Assignee[] = [
  { id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' },
  { id: 'u2', name: 'Amy', avatarColor: 'bg-orange-500', initials: 'AM' },
  { id: 'u3', name: 'Ken', avatarColor: 'bg-blue-500', initials: 'KN' },
]

export const PRIORITY_OPTIONS: { value: 'high' | 'medium' | 'low'; label: string }[] = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

export const COLUMN_OPTIONS: { value: 'todo' | 'in_progress' | 'review'; label: string }[] = [
  { value: 'todo', label: '等待認領' },
  { value: 'in_progress', label: '處理中' },
  { value: 'review', label: '等你確認' },
]
```

（`TagType` 目前未被此檔案直接使用作為獨立型別標註，若 `tsc` 提示未使用的 import，移除 `TagType` import 即可，只留 `Assignee`、`Tag`。）

- [x] **Step 2：用 `tsc` 驗證**

執行：`npx tsc --noEmit`
預期：無錯誤（若有「未使用的 import」錯誤，依照上一步的備註移除多餘 import）

- [x] **Step 3：Commit**

```bash
git add src/data/options.ts
git commit -m "feat: add fixed option lists for tags/assignees/priority/column"
```

---

### Task 2：TaskDrawer 元件（表單本體）

**檔案：**
- 新增：`src/components/TaskDrawer.tsx`

**介面：**
- 消費：
  - `src/types/task.ts` 的 `Task`、`Priority`、`ColumnId`、`Tag`、`Assignee`
  - `src/data/options.ts` 的 `TAG_OPTIONS`、`ASSIGNEE_OPTIONS`、`PRIORITY_OPTIONS`、`COLUMN_OPTIONS`
  - `src/lib/api.ts` 的 `createTaskApi`、`updateTaskApi`、`deleteTaskApi`
- Props：
  ```typescript
  interface TaskDrawerProps {
    isOpen: boolean
    mode: 'create' | 'edit'
    initialTask?: Task // mode === 'edit' 時提供
    onClose: () => void
    onSaved: () => void // 新增/儲存/刪除成功後呼叫，通知外部重新載入任務列表
  }
  ```
- 元件內部用 `useState` 管理表單欄位（title, priority, columnId, tags 選取狀態, assignees 選取狀態, progress），`useEffect` 在 `initialTask`/`isOpen` 改變時重置表單。

- [x] **Step 1：撰寫 `src/components/TaskDrawer.tsx`**

```typescript
import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import type { Task, Priority, ColumnId, TagType } from '../types/task'
import { TAG_OPTIONS, ASSIGNEE_OPTIONS, PRIORITY_OPTIONS, COLUMN_OPTIONS } from '../data/options'
import { createTaskApi, updateTaskApi, deleteTaskApi } from '../lib/api'

interface TaskDrawerProps {
  isOpen: boolean
  mode: 'create' | 'edit'
  initialTask?: Task
  onClose: () => void
  onSaved: () => void
}

const emptyFormState = {
  title: '',
  priority: 'medium' as Priority,
  columnId: 'todo' as ColumnId,
  tagTypes: [] as TagType[],
  assigneeIds: [] as string[],
  progress: '' as string,
}

export default function TaskDrawer({ isOpen, mode, initialTask, onClose, onSaved }: TaskDrawerProps) {
  const [form, setForm] = useState(emptyFormState)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (mode === 'edit' && initialTask) {
      setForm({
        title: initialTask.title,
        priority: initialTask.priority,
        columnId: initialTask.columnId,
        tagTypes: initialTask.tags.map((t) => t.type),
        assigneeIds: initialTask.assignees.map((a) => a.id),
        progress: typeof initialTask.progress === 'number' ? String(initialTask.progress) : '',
      })
    } else {
      setForm(emptyFormState)
    }
    setError(null)
  }, [isOpen, mode, initialTask])

  if (!isOpen) return null

  function toggleTag(type: TagType) {
    setForm((prev) => ({
      ...prev,
      tagTypes: prev.tagTypes.includes(type)
        ? prev.tagTypes.filter((t) => t !== type)
        : [...prev.tagTypes, type],
    }))
  }

  function toggleAssignee(id: string) {
    setForm((prev) => ({
      ...prev,
      assigneeIds: prev.assigneeIds.includes(id)
        ? prev.assigneeIds.filter((a) => a !== id)
        : [...prev.assigneeIds, id],
    }))
  }

  function buildPayload() {
    const tags = TAG_OPTIONS.filter((t) => form.tagTypes.includes(t.type))
    const assignees = ASSIGNEE_OPTIONS.filter((a) => form.assigneeIds.includes(a.id))
    const progress = form.progress.trim() === '' ? undefined : Number(form.progress)
    return {
      title: form.title.trim(),
      priority: form.priority,
      columnId: form.columnId,
      tags,
      assignees,
      progress,
      commentCount: initialTask?.commentCount ?? 0,
      hasUnread: initialTask?.hasUnread ?? false,
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) {
      setError('標題為必填')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createTaskApi(buildPayload())
      } else if (initialTask) {
        await updateTaskApi(initialTask.id, buildPayload())
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!initialTask) return
    if (!window.confirm(`確定要刪除任務「${initialTask.title}」嗎？`)) return
    setIsSubmitting(true)
    setError(null)
    try {
      await deleteTaskApi(initialTask.id)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">
            {mode === 'create' ? '新增任務' : '編輯任務'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        )}

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">標題 *</span>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">優先級</span>
          <select
            value={form.priority}
            onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value as Priority }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">欄位</span>
          <select
            value={form.columnId}
            onChange={(e) => setForm((p) => ({ ...p, columnId: e.target.value as ColumnId }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {COLUMN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-3 text-sm">
          <span className="mb-1 block font-medium text-slate-600">標籤</span>
          <div className="flex flex-wrap gap-2">
            {TAG_OPTIONS.map((tag) => (
              <label key={tag.type} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={form.tagTypes.includes(tag.type)}
                  onChange={() => toggleTag(tag.type)}
                />
                {tag.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mb-3 text-sm">
          <span className="mb-1 block font-medium text-slate-600">負責人</span>
          <div className="flex flex-wrap gap-2">
            {ASSIGNEE_OPTIONS.map((a) => (
              <label key={a.id} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={form.assigneeIds.includes(a.id)}
                  onChange={() => toggleAssignee(a.id)}
                />
                {a.name}
              </label>
            ))}
          </div>
        </div>

        <label className="mb-6 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">進度（0-100，可留空）</span>
          <input
            type="number"
            min={0}
            max={100}
            value={form.progress}
            onChange={(e) => setForm((p) => ({ ...p, progress: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="mt-auto flex items-center justify-between gap-2">
          {mode === 'edit' && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <Trash2 size={15} />
              刪除
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {mode === 'create' ? '建立' : '儲存'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
```

- [x] **Step 2：用 `tsc` 驗證**

執行：`npx tsc --noEmit`
預期：無錯誤

- [x] **Step 3：Commit**

```bash
git add src/components/TaskDrawer.tsx
git commit -m "feat: add TaskDrawer component for create/edit task form"
```

---

### Task 3：Toolbar 新增任務按鈕串接

**檔案：**
- 修改：`src/components/Toolbar.tsx`

**介面：**
- Props 新增：`onAddTask: () => void`

- [x] **Step 1：修改 `src/components/Toolbar.tsx`**

在檔案開頭的 import 之後，修改元件簽名與按鈕：

```typescript
interface ToolbarProps {
  onAddTask: () => void
}

export default function Toolbar({ onAddTask }: ToolbarProps) {
```

（原本 `export default function Toolbar() {` 改為上面這行）

把「新增任務」按鈕改為：

```typescript
        <button
          onClick={onAddTask}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus size={15} />
          新增任務
        </button>
```

（僅新增 `onClick={onAddTask}`，其餘 className 與內容不變）

- [x] **Step 2：用 `tsc` 驗證**

執行：`npx tsc -b`
預期：會出現 `App.tsx` 呼叫 `<Toolbar />` 缺少必要 prop `onAddTask` 的錯誤——這是預期的，因為 Task 5 才會修改 `App.tsx` 補上這個 prop。此步驟先確認 `Toolbar.tsx` 本身語法正確、型別定義正確即可，`App.tsx` 的錯誤留到 Task 5 解決。

- [x] **Step 3：Commit**

```bash
git add src/components/Toolbar.tsx
git commit -m "feat: add onAddTask prop to Toolbar for opening TaskDrawer"
```

---

### Task 4：TaskCard 點擊開啟編輯（與拖拉共存）

**檔案：**
- 修改：`src/components/TaskCard.tsx`
- 修改：`src/components/SortableTaskCard.tsx`
- 修改：`src/components/BoardColumn.tsx`

**介面：**
- `TaskCard` Props 新增：`onClick?: () => void`
- `SortableTaskCard` Props 新增：`onTaskClick?: (task: Task) => void`
- `BoardColumn` Props 新增：`onTaskClick?: (task: Task) => void`

- [x] **Step 1：修改 `src/components/TaskCard.tsx`**

修改 `TaskCardProps` 介面與元件簽名：

```typescript
interface TaskCardProps {
  task: Task
  dragHandleProps?: Record<string, unknown>
  isDragging?: boolean
  onClick?: () => void
}

export default function TaskCard({ task, dragHandleProps, isDragging, onClick }: TaskCardProps) {
```

把最外層的 `<div>` 加上 `onClick={onClick}`：

```typescript
    <div
      {...dragHandleProps}
      onClick={onClick}
      className={`group relative rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
```

（因為 dnd-kit 的 `activationConstraint: { distance: 5 }` 已經確保「單純點擊」不會觸發拖拉手勢，`onClick` 只有在滑鼠沒有移動超過 5px 時才會被觸發，兩者可以正常共存，不需要額外的事件阻擋邏輯）

- [x] **Step 2：修改 `src/components/SortableTaskCard.tsx`**

```typescript
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import TaskCard from './TaskCard'
import type { Task } from '../types/task'

interface SortableTaskCardProps {
  task: Task
  onTaskClick?: (task: Task) => void
}

export default function SortableTaskCard({ task, onTaskClick }: SortableTaskCardProps) {
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
      />
    </div>
  )
}
```

- [x] **Step 3：修改 `src/components/BoardColumn.tsx`**

```typescript
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import SortableTaskCard from './SortableTaskCard'
import type { Column, Task } from '../types/task'

interface BoardColumnProps {
  column: Column
  tasks: Task[]
  onTaskClick?: (task: Task) => void
}

export default function BoardColumn({ column, tasks, onTaskClick }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <div className="flex w-80 shrink-0 flex-col rounded-xl bg-slate-50/60">
      <div className={`flex items-center justify-between rounded-t-xl border-b px-3 py-2.5 ${column.colorClass}`}>
        <span className="text-sm font-semibold">{column.title}</span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium">
          {tasks.length}
        </span>
      </div>
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
    </div>
  )
}
```

- [x] **Step 4：用 `tsc` 驗證**

執行：`npx tsc -b`
預期：會出現 `App.tsx` 呼叫 `<BoardColumn />` 未傳入 `onTaskClick` 的情況——因為 `onTaskClick` 是 optional prop（`?:`），這不會是型別錯誤，只會在執行期沒有點擊反應，屬預期中，留到 Task 5 補上呼叫端。確認沒有其他型別錯誤。

- [x] **Step 5：Commit**

```bash
git add src/components/TaskCard.tsx src/components/SortableTaskCard.tsx src/components/BoardColumn.tsx
git commit -m "feat: propagate onTaskClick through BoardColumn/SortableTaskCard/TaskCard"
```

---

### Task 5：App.tsx 整合 TaskDrawer（開關狀態與資料重新載入）

**檔案：**
- 修改：`src/App.tsx`

**介面：**
- 消費：`src/components/TaskDrawer.tsx`（Task 2）、`Toolbar` 的 `onAddTask`（Task 3）、`BoardColumn` 的 `onTaskClick`（Task 4）
- 產出：`App.tsx` 管理 `isDrawerOpen`、`drawerMode`、`editingTask` 三個狀態，控制 `TaskDrawer` 的顯示與行為

- [ ] **Step 1：修改 `src/App.tsx`**

在既有的 import 區塊新增：

```typescript
import TaskDrawer from './components/TaskDrawer'
```

在 `App` 元件內，既有的 `const [activeTask, setActiveTask] = useState<Task | null>(null)` 之後新增：

```typescript
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  function openCreateDrawer() {
    setDrawerMode('create')
    setEditingTask(null)
    setIsDrawerOpen(true)
  }

  function openEditDrawer(task: Task) {
    setDrawerMode('edit')
    setEditingTask(task)
    setIsDrawerOpen(true)
  }

  function closeDrawer() {
    setIsDrawerOpen(false)
  }

  function reloadTasks() {
    fetchTasks()
      .then(setTasks)
      .catch((err) => setLoadError(err.message))
  }
```

修改 `<Toolbar />` 呼叫，加上 prop：

```typescript
      <Toolbar onAddTask={openCreateDrawer} />
```

修改 `<BoardColumn />` 呼叫，加上 prop：

```typescript
            {columns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                tasks={tasksByColumn[column.id]}
                onTaskClick={openEditDrawer}
              />
            ))}
```

在 `</DndContext>` 與 `</main>` 之間的最外層（`return` 的最後，`</div>` 閉合之前）加上 `<TaskDrawer />`：

```typescript
      </main>
      <TaskDrawer
        isOpen={isDrawerOpen}
        mode={drawerMode}
        initialTask={editingTask ?? undefined}
        onClose={closeDrawer}
        onSaved={reloadTasks}
      />
    </div>
  )
}
```

（即：原本檔案結尾的
```
      </main>
    </div>
  )
}
```
改為上面那段，`<TaskDrawer />` 插入在 `</main>` 之後、最外層 `</div>` 之前）

- [ ] **Step 2：用 `tsc` 驗證**

執行：`npx tsc -b`
預期：無錯誤

- [ ] **Step 3：`npm run build` 驗證**

執行：`npm run build`
預期：build 成功，無錯誤

- [ ] **Step 4：Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate TaskDrawer into App for create/edit task flow"
```

---

### Task 6：端到端功能驗證

**檔案：** 無新增/修改檔案，純驗證任務。

**介面：** 無。

- [ ] **Step 1：啟動開發環境**

```bash
npm run db:seed
npm run dev
```

（`npm run dev` 會同時啟動 Vite 前端與 Express 後端）

- [ ] **Step 2：用 curl 驗證新增流程對應的 API 呼叫正確**

由於此環境可能無法操作圖形瀏覽器，改用 curl 直接驗證 `TaskDrawer` 送出時會呼叫的 API 端點行為（等同於驗證「若使用者填完表單按下建立/儲存/刪除，後端會如何回應」）：

```bash
# 模擬「新增任務」送出（title, priority, columnId, tags, assignees, progress 皆有值）
curl -s -X POST http://localhost:8088/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"UI 新增測試","priority":"medium","columnId":"todo","tags":[{"type":"issue","label":"Issue"}],"assignees":[{"id":"u1","name":"Josh","avatarColor":"bg-purple-500","initials":"JS"}],"commentCount":0,"hasUnread":false}'
```
預期：`201`，回傳的 `task` 包含剛剛送出的欄位

```bash
# 取得剛剛建立的任務 id，模擬「編輯儲存」
curl -s http://localhost:8088/api/tasks | head -c 2000
```

```bash
# 模擬「編輯儲存」（PATCH 修改 title 與 progress）
curl -s -X PATCH http://localhost:8088/api/tasks/<上面取得的 id> \
  -H 'Content-Type: application/json' \
  -d '{"title":"UI 編輯測試","progress":50}'
```
預期：`200`，`task.title` 為 "UI 編輯測試"，`task.progress` 為 `50`

```bash
# 模擬「刪除」
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:8088/api/tasks/<上面的 id>
```
預期：`204`

- [ ] **Step 3：若環境支援瀏覽器操作，做一次真實互動驗證**

若可以使用瀏覽器工具（如 browser_navigate 等），實際打開 `http://localhost:8088`（或 dev 模式的對應 port），執行：
1. 點擊「新增任務」→ 確認 Drawer 從右側滑出
2. 填寫標題「瀏覽器測試任務」，選擇優先級、欄位、至少一個標籤與一位負責人 → 點擊「建立」
3. 確認 Drawer 關閉，新任務出現在對應欄位
4. 點擊該任務卡片 → 確認 Drawer 以編輯模式開啟，欄位已帶入正確資料
5. 修改標題 → 點擊「儲存」→ 確認卡片標題已更新
6. 再次點擊該卡片 → 點擊「刪除」→ 確認彈出瀏覽器原生 confirm 對話框 → 確認 → 確認卡片從畫面消失

若環境不支援瀏覽器操作，Step 2 的 curl 驗證已足以證明 API 串接邏輯正確，可在報告中註明此限制。

- [ ] **Step 4：停止 dev server，清理測試資料**

停掉 `npm run dev`（兩個 process）。若 Step 2/3 有殘留測試任務未清乾淨，用 DELETE API 或直接檢查 `docker exec`/本機 SQLite 清除，確保不留測試髒資料在種子資料集中。

- [ ] **Step 5：不需要 commit**（此 Task 純驗證，無程式碼變更）

---

### Task 7：更新 README 反映新功能

**檔案：**
- 修改：`README.md`

**介面：** 無（純文件更新）。

- [ ] **Step 1：更新 `README.md`**

在「看板設計」章節之後（或適當位置）新增一小節說明新增/編輯功能：

```markdown
## 新增與編輯任務

- 點擊右上角「新增任務」按鈕，從右側滑出表單，填寫標題（必填）、優先級、欄位、標籤（可複選）、負責人（可複選）、進度後建立
- 點擊任一任務卡片，開啟同一個表單進行編輯，可修改欄位或刪除該任務（刪除前會有確認提示）
- 標籤與負責人皆為固定選單（不開放自由輸入新增選項）
```

- [ ] **Step 2：Commit 並 push**

```bash
git add README.md
git commit -m "docs: document add/edit task UI in README"
git push origin <當前分支>
```
