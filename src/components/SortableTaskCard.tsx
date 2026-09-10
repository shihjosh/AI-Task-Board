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
    <div ref={setNodeRef} data-task-id={task.id} style={style}>
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
