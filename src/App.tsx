import { useEffect, useMemo, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import Toolbar from './components/Toolbar'
import BoardColumn from './components/BoardColumn'
import TaskCard from './components/TaskCard'
import TaskDrawer from './components/TaskDrawer'
import DonePage from './components/DonePage'
import { BOARD_COLUMNS } from './data/columns'
import { fetchTasks, updateTaskApi } from './lib/api'
import type { ColumnId, Task } from './types/task'

function Board() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const [mobileActiveColumnId, setMobileActiveColumnId] = useState<ColumnId>(BOARD_COLUMNS[0].id)

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

  const tasksByColumn = useMemo(() => {
    const map: Record<ColumnId, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
    for (const task of tasks) {
      map[task.columnId].push(task)
    }
    return map
  }, [tasks])

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id)
    setActiveTask(task ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)
    if (!over) return

    const draggedTask = tasks.find((t) => t.id === active.id)
    if (!draggedTask) return

    const overId = over.id as string
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
    <div className="flex min-h-screen flex-col bg-white">
      <Toolbar onAddTask={openCreateDrawer} />
      <main className="flex-1 overflow-x-auto bg-slate-50 px-6 py-5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
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
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-500'
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
          <DragOverlay>{activeTask ? <TaskCard task={activeTask} /> : null}</DragOverlay>
        </DndContext>
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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Board />} />
      <Route path="/done" element={<DonePage />} />
    </Routes>
  )
}
