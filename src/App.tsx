import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import Toolbar from './components/Toolbar'
import BoardColumn from './components/BoardColumn'
import TaskCard from './components/TaskCard'
import DonePage from './components/DonePage'

// TaskDrawer 拉入了 react-markdown + remark-gfm，是目前 bundle 中最重的部分，
// 但只有使用者實際點開任務卡片時才需要，故改用 lazy import 拆成獨立 chunk，
// 讓看板首屏不用等 markdown parser 一起載入。
const TaskDrawer = lazy(() => import('./components/TaskDrawer'))
import DoneDropZone from './components/DoneDropZone'
import ListView from './components/ListView'
import GanttView from './components/GanttView'
import { BOARD_COLUMNS } from './data/columns'
import { fetchTasks, updateTaskApi } from './lib/api'
import type { ColumnId, Task, TagType } from './types/task'

function Board() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [activeTaskWidth, setActiveTaskWidth] = useState<number | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const [mobileActiveColumnId, setMobileActiveColumnId] = useState<ColumnId>(BOARD_COLUMNS[0].id)

  const [searchQuery, setSearchQuery] = useState('')

  const [selectedTagTypes, setSelectedTagTypes] = useState<TagType[]>([])

  const [activeView, setActiveView] = useState<'board' | 'list' | 'gantt'>('board')

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

  useEffect(() => {
    fetchTasks()
      .then(setTasks)
      .catch((err) => setLoadError(err.message))
      .finally(() => setIsLoading(false))
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  // 自訂碰撞偵測：優先用 pointerWithin 判斷指標是否真的落在「拖放標記完成」長條內
  // （closestCorners 對窄長條 vs 大面積欄位的角點距離比較天生不利於窄長條，
  // 會導致拖到長條上仍被判定為鄰近的欄位）；其餘情況維持原本的 closestCorners 行為，
  // 確保欄位間的拖放邏輯不受影響。
  const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args)
    if (pointerCollisions.some((c) => c.id === 'done-drop-zone')) {
      return pointerCollisions.filter((c) => c.id === 'done-drop-zone')
    }
    if (pointerCollisions.length > 0) {
      return pointerCollisions
    }
    return closestCorners(args)
  }

  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return tasks.filter((t) => {
      const matchesQuery = !query || t.title.toLowerCase().includes(query)
      const matchesTags =
        selectedTagTypes.length === 0 || t.tags.some((tag) => selectedTagTypes.includes(tag.type))
      return matchesQuery && matchesTags
    })
  }, [tasks, searchQuery, selectedTagTypes])

  const tasksByColumn = useMemo(() => {
    const map: Record<ColumnId, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
    for (const task of filteredTasks) {
      map[task.columnId].push(task)
    }
    return map
  }, [filteredTasks])

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id)
    setActiveTask(task ?? null)
    // 優先從實際 DOM 節點量測寬度（拖曳當下的真實畫面狀態），比 dnd-kit 內部快取的
    // rect.current.initial 更可靠——後者在某些時序下（尤其拖曳剛觸發、layout 尚未穩定時）
    // 可能量到 0，導致 DragOverlay 內容被壓縮成 0 寬，中文標題逐字換行成一長條。
    const sourceEl = document.querySelector<HTMLElement>(`[data-task-id="${event.active.id}"]`)
    const measuredWidth = sourceEl?.getBoundingClientRect().width
    const fallbackWidth = event.active.rect.current.initial?.width
    const resolvedWidth = measuredWidth && measuredWidth > 0 ? measuredWidth : fallbackWidth
    setActiveTaskWidth(resolvedWidth && resolvedWidth > 0 ? resolvedWidth : null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)
    setActiveTaskWidth(null)
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

    if (!overColumnId) return

    const columnChanged = draggedTask.columnId !== overColumnId

    setTasks((prev) => {
      const activeIndex = prev.findIndex((t) => t.id === active.id)
      if (activeIndex === -1) return prev

      if (!columnChanged) {
        const overIndex = prev.findIndex((t) => t.id === overId)
        if (overIndex === -1 || activeIndex === overIndex) return prev
        return arrayMove(prev, activeIndex, overIndex)
      }

      const updated = [...prev]
      updated[activeIndex] = { ...draggedTask, columnId: overColumnId }
      return updated
    })

    if (columnChanged) {
      updateTaskApi(draggedTask.id, { columnId: overColumnId }).catch((err) => {
        console.error('Failed to persist column change', err)
      })
    }
  }

  function handleMoveToColumn(task: Task, targetColumnId: ColumnId) {
    if (task.columnId === targetColumnId) return
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, columnId: targetColumnId } : t)),
    )
    updateTaskApi(task.id, { columnId: targetColumnId }).catch((err) => {
      console.error('Failed to persist column change', err)
    })
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-400 dark:bg-slate-900">
        載入任務中…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-red-500 dark:bg-slate-900">
        載入失敗：{loadError}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-slate-900">
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
      <main className="flex-1 overflow-x-auto bg-slate-50 px-6 py-5 dark:bg-slate-900">
        {activeView === 'board' && (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* 桌面版：多欄橫向排列（sm 以上顯示） */}
            <div className="hidden w-full justify-center gap-4 sm:flex">
              {BOARD_COLUMNS.map((column) => (
                <BoardColumn
                  key={column.id}
                  column={column}
                  tasks={tasksByColumn[column.id]}
                  onTaskClick={openEditDrawer}
                />
              ))}
            </div>

            {/* 手機版：單欄 + 標籤切換（sm 以下顯示） */}
            <div className="flex w-full flex-col gap-3 sm:hidden">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {BOARD_COLUMNS.map((column) => (
                  <button
                    key={column.id}
                    type="button"
                    onClick={() => setMobileActiveColumnId(column.id)}
                    className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
                      mobileActiveColumnId === column.id
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {column.title} ({tasksByColumn[column.id].length})
                  </button>
                ))}
              </div>
              {BOARD_COLUMNS
                .filter((column) => column.id === mobileActiveColumnId)
                .map((column) => (
                  <BoardColumn
                    key={column.id}
                    column={column}
                    tasks={tasksByColumn[column.id]}
                    onTaskClick={openEditDrawer}
                    isMobile
                    onMoveToColumn={handleMoveToColumn}
                  />
                ))}
            </div>
            <DoneDropZone isDragActive={activeTask !== null} />
            <DragOverlay>
              {activeTask ? (
                <div style={{ width: activeTaskWidth ?? undefined }}>
                  <TaskCard task={activeTask} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
        {activeView === 'list' && (
          <ListView tasks={filteredTasks} onTaskClick={openEditDrawer} />
        )}
        {activeView === 'gantt' && (
          <GanttView tasks={filteredTasks} onTaskClick={openEditDrawer} />
        )}
      </main>
      {isDrawerOpen && (
        <Suspense fallback={null}>
          <TaskDrawer
            isOpen={isDrawerOpen}
            mode={drawerMode}
            initialTask={editingTask ?? undefined}
            onClose={closeDrawer}
            onSaved={reloadTasks}
          />
        </Suspense>
      )}
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Board />} />
      <Route path="/done" element={<DonePage />} />
    </Routes>
  )
}
