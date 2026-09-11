import { columns } from '../data/columns'
import type { Task } from '../types/task'

interface ListViewProps {
  tasks: Task[]
  onTaskClick: (task: Task) => void
}

const priorityLabel: Record<Task['priority'], string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export default function ListView({ tasks, onTaskClick }: ListViewProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-16 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
        沒有符合條件的任務
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <tr>
            <th className="px-4 py-2.5">標題</th>
            <th className="px-4 py-2.5">欄位</th>
            <th className="px-4 py-2.5">優先級</th>
            <th className="px-4 py-2.5">負責人</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {tasks.map((task) => {
            const column = columns.find((c) => c.id === task.columnId)
            return (
              <tr
                key={task.id}
                onClick={() => onTaskClick(task)}
                className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">{task.title}</td>
                <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{column?.title ?? task.columnId}</td>
                <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{priorityLabel[task.priority]}</td>
                <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                  {task.assignees.map((a) => a.name).join('、') || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
