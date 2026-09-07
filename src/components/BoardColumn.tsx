import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import SortableTaskCard from './SortableTaskCard'
import type { Column, Task } from '../types/task'

interface BoardColumnProps {
  column: Column
  tasks: Task[]
}

export default function BoardColumn({ column, tasks }: BoardColumnProps) {
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
            <SortableTaskCard key={task.id} task={task} />
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
