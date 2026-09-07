import { useMemo, useState } from 'react'
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
import { columns, mockTasks } from './data/mockTasks'
import type { ColumnId, Task } from './types/task'

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(mockTasks)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

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

    const activeTask = tasks.find((t) => t.id === active.id)
    if (!activeTask) return

    const overId = over.id as string
    const overColumnId = (columns.find((c) => c.id === overId)?.id ??
      tasks.find((t) => t.id === overId)?.columnId) as ColumnId | undefined

    if (!overColumnId) return

    setTasks((prev) => {
      const activeIndex = prev.findIndex((t) => t.id === active.id)
      if (activeIndex === -1) return prev

      if (activeTask.columnId === overColumnId) {
        const overIndex = prev.findIndex((t) => t.id === overId)
        if (overIndex === -1 || activeIndex === overIndex) return prev
        return arrayMove(prev, activeIndex, overIndex)
      }

      const updated = [...prev]
      updated[activeIndex] = { ...activeTask, columnId: overColumnId }
      return updated
    })
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
