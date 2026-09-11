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
          ? 'border-emerald-400 bg-emerald-100 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-900/40 dark:text-emerald-300'
          : isDragActive
            ? 'border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400'
            : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
      }`}
    >
      <CheckCircle2 size={16} />
      拖曳到這裡標記為已完成
    </div>
  )
}
