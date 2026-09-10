import { useState, useMemo, Fragment } from 'react'
import type { Task } from '../types/task'

interface GanttViewProps {
  tasks: Task[]
  onTaskClick: (task: Task) => void
}

type Granularity = 'week' | 'month'

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export default function GanttView({ tasks, onTaskClick }: GanttViewProps) {
  const [granularity, setGranularity] = useState<Granularity>('week')

  const tasksWithDueDate = useMemo(() => tasks.filter((t) => t.dueDate), [tasks])

  const { rangeStart, dayCount } = useMemo(() => {
    const now = new Date()
    const start = granularity === 'week' ? startOfWeek(now) : startOfMonth(now)
    const days =
      granularity === 'week' ? 7 : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    return { rangeStart: start, dayCount: days }
  }, [granularity])

  function dayOffset(dateStr: string): number {
    const d = new Date(dateStr)
    d.setHours(0, 0, 0, 0)
    const diffMs = d.getTime() - rangeStart.getTime()
    return Math.round(diffMs / (1000 * 60 * 60 * 24))
  }

  const dayLabels = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => formatDate(addDays(rangeStart, i))),
    [rangeStart, dayCount],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 self-end rounded-lg bg-slate-100 p-1">
        {(['week', 'month'] as Granularity[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGranularity(g)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              granularity === g ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {g === 'week' ? '週檢視' : '月檢視'}
          </button>
        ))}
      </div>

      {tasksWithDueDate.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-16 text-sm text-slate-400">
          沒有設定「預計完成日期」的任務，甘特圖暫無內容可顯示
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <div
            className="grid"
            style={{ gridTemplateColumns: `160px repeat(${dayCount}, minmax(32px, 1fr))` }}
          >
            <div className="border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
              任務
            </div>
            {dayLabels.map((label, i) => (
              <div
                key={i}
                className="border-b border-slate-200 bg-slate-50 px-1 py-2 text-center text-[10px] text-slate-400"
              >
                {label}
              </div>
            ))}

            {tasksWithDueDate.map((task) => {
              const createdOffset = Math.max(0, dayOffset(task.createdAt))
              const dueOffset = Math.min(dayCount - 1, dayOffset(task.dueDate as string))
              const barStart = Math.max(0, createdOffset)
              const barLength = Math.max(1, dueOffset - barStart + 1)
              return (
                <Fragment key={task.id}>
                  <button
                    type="button"
                    onClick={() => onTaskClick(task)}
                    className="truncate border-r border-slate-100 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                  >
                    {task.title}
                  </button>
                  <div
                    className="relative py-2"
                    style={{ gridColumn: `2 / span ${dayCount}` }}
                  >
                    {dueOffset >= 0 && barStart < dayCount && (
                      <button
                        type="button"
                        onClick={() => onTaskClick(task)}
                        className="absolute h-4 rounded bg-sky-400 hover:bg-sky-500"
                        style={{
                          left: `${(barStart / dayCount) * 100}%`,
                          width: `${(barLength / dayCount) * 100}%`,
                        }}
                        title={task.title}
                      />
                    )}
                  </div>
                </Fragment>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
