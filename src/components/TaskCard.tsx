import { MessageSquare, AlertTriangle, GitPullRequest, Code2, CircleDot } from 'lucide-react'
import type { Task, TagType } from '../types/task'

const priorityStyles: Record<Task['priority'], string> = {
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-slate-100 text-slate-500',
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
  github: 'bg-slate-100 text-slate-600',
  issue: 'bg-indigo-50 text-indigo-600',
  bug: 'bg-red-50 text-red-600',
  pr: 'bg-violet-50 text-violet-600',
}

interface TaskCardProps {
  task: Task
  dragHandleProps?: Record<string, unknown>
  isDragging?: boolean
}

export default function TaskCard({ task, dragHandleProps, isDragging }: TaskCardProps) {
  return (
    <div
      {...dragHandleProps}
      className={`group relative rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      {task.hasUnread && (
        <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-sky-500" />
      )}

      <div className="mb-1.5 text-xs font-medium text-slate-400">{task.id}</div>

      <div className="mb-2 text-sm font-semibold leading-snug text-slate-800">
        {task.title}
      </div>

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
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex -space-x-2">
          {task.assignees.map((a) => (
            <div
              key={a.id}
              title={a.name}
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-white ${a.avatarColor}`}
            >
              {a.initials}
            </div>
          ))}
        </div>
        {task.commentCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <MessageSquare size={13} />
            {task.commentCount}
          </div>
        )}
      </div>
    </div>
  )
}
