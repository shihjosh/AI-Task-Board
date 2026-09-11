import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ChevronDown, ChevronUp } from 'lucide-react'
import SortableTaskCard from './SortableTaskCard'
import type { Column, Task } from '../types/task'

interface BoardColumnProps {
  column: Column
  tasks: Task[]
  onTaskClick?: (task: Task) => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  isMobile?: boolean
  onMoveToColumn?: (task: Task, targetColumnId: Task['columnId']) => void
}

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
    <div className={`flex shrink-0 flex-col rounded-xl bg-slate-50/60 dark:bg-slate-800/60 ${isMobile ? 'w-full' : 'w-80'}`}>
      <div className={`flex items-center justify-between rounded-t-xl border-b px-3 py-2.5 ${column.colorClass}`}>
        <span className="text-sm font-semibold">{column.title}</span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium dark:bg-slate-900/50">
            {tasks.length}
          </span>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={isCollapsed ? '展開欄位' : '折疊欄位'}
              className="rounded p-0.5 hover:bg-white/50 dark:hover:bg-slate-900/50"
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
            isOver ? 'bg-slate-100 dark:bg-slate-700/60' : ''
          }`}
        >
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
          {tasks.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-8 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
              拖曳任務到這裡
            </div>
          )}
        </div>
      )}
    </div>
  )
}
