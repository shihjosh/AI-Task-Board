import { useEffect, useMemo, useState } from 'react'
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
import { columns } from './data/columns'
import { fetchTasks, updateTaskApi } from './lib/api'
import type { ColumnId, Task } from './types/task'

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

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
    const map: Record<ColumnId, Task[]> = { todo: [], in_progress: [], review: [] }
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
    const overColumnId = (columns.find((c) => c.id === overId)?.id ??
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
      <Toolbar />
      <main className="flex-1 overflow-x-auto bg-slate-50 px-6 py-5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4">
            {columns.map((column) => (
              <BoardColumn key={column.id} column={column} tasks={tasksByColumn[column.id]} />
            ))}
          </div>
          <DragOverlay>{activeTask ? <TaskCard task={activeTask} /> : null}</DragOverlay>
        </DndContext>
      </main>
    </div>
  )
}
