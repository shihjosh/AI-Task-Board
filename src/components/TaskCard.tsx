import { MessageSquare, AlertTriangle, GitPullRequest, Code2, CircleDot, Loader2 } from 'lucide-react'
import { columns } from '../data/columns'
import type { ColumnId, Task, TagType } from '../types/task'

const priorityStyles: Record<Task['priority'], string> = {
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  low: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
}

const priorityLabel: Record<Task['priority'], string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const tagIcon: Record<TagType, React.ReactNode> = {
  github: <Code2 size={12} />,
  issue: <CircleDot size={12} />,
  bug: <AlertTriangle size={12} />,
  pr: <GitPullRequest size={12} />,
}

const tagStyles: Record<TagType, string> = {
  github: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  issue: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300',
  bug: 'bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-300',
  pr: 'bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
}

interface TaskCardProps {
  task: Task
  dragHandleProps?: Record<string, unknown>
  isDragging?: boolean
  onClick?: () => void
  isMobile?: boolean
  onMoveToColumn?: (task: Task, targetColumnId: ColumnId) => void
}

export default function TaskCard({
  task,
  dragHandleProps,
  isDragging,
  onClick,
  isMobile = false,
  onMoveToColumn,
}: TaskCardProps) {
  return (
    <div
      {...dragHandleProps}
      onClick={onClick}
      className={`group relative rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md cursor-grab active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800 ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      {task.hasUnread && (
        <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-sky-500" />
      )}

      <div className="mb-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">{task.id}</div>

      <div className="mb-2 text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
        {task.title}
      </div>

      {task.automationStatus === 'running' && (
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-sky-600">
          <Loader2 size={12} className="animate-spin" />
          Hermes 執行中
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${priorityStyles[task.priority]}`}
        >
          優先級：{priorityLabel[task.priority]}
        </span>
        {task.tags.map((tag, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${tagStyles[tag.type]}`}
          >
            {tagIcon[tag.type]}
            {tag.label}
          </span>
        ))}
      </div>

      {typeof task.progress === 'number' && (
        <div className="mb-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>
      )}

      {isMobile && onMoveToColumn && (
        <div className="mb-2" onClick={(e) => e.stopPropagation()}>
          <select
            value=""
            onChange={(e) => {
              const targetColumnId = e.target.value as ColumnId
              if (targetColumnId) onMoveToColumn(task, targetColumnId)
            }}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
          >
            <option value="">移動到...</option>
            {columns
              .filter((c) => c.id !== task.columnId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </select>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex -space-x-2">
          {task.assignees.map((a) => (
            <div
              key={a.id}
              title={a.name}
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-white dark:ring-slate-800 ${a.avatarColor}`}
            >
              {a.initials}
            </div>
          ))}
        </div>
        {task.commentCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
            <MessageSquare size={13} />
            {task.commentCount}
          </div>
        )}
      </div>
    </div>
  )
}
