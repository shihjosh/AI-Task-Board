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

  // 手機版簡易清單：依到期日由近到遠排序，複用既有 tasksWithDueDate（已過濾出有 dueDate 的任務）
  const sortedTasksForMobile = useMemo(
    () =>
      [...tasksWithDueDate].sort(
        (a, b) => new Date(a.dueDate as string).getTime() - new Date(b.dueDate as string).getTime(),
      ),
    [tasksWithDueDate],
  )

  function formatDueLabel(dueDateStr: string): { text: string; isOverdue: boolean } {
    const due = new Date(dueDateStr)
    due.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return { text: '今天到期', isOverdue: false }
    if (diffDays < 0) return { text: `已逾期 ${Math.abs(diffDays)} 天`, isOverdue: true }
    return { text: `還有 ${diffDays} 天`, isOverdue: false }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 self-end rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
        {(['week', 'month'] as Granularity[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGranularity(g)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              granularity === g
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {g === 'week' ? '週檢視' : '月檢視'}
          </button>
        ))}
      </div>

      {tasksWithDueDate.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-16 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          沒有設定「預計完成日期」的任務，甘特圖暫無內容可顯示
        </div>
      ) : (
        <>
          {/* 桌面版：時間軸格線（sm 以上顯示） */}
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 sm:block dark:border-slate-700">
            <div
              className="grid"
              style={{ gridTemplateColumns: `160px repeat(${dayCount}, minmax(32px, 1fr))` }}
            >
              <div className="border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                任務
              </div>
              {dayLabels.map((label, i) => (
                <div
                  key={i}
                  className="border-b border-slate-200 bg-slate-50 px-1 py-2 text-center text-[10px] text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
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
                      className="truncate border-r border-slate-100 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
                          className="absolute h-4 rounded bg-sky-400 hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
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

          {/* 手機版：依到期日排序的簡易清單（sm 以下顯示），時間軸格線在窄螢幕上不可讀 */}
          <div className="flex flex-col gap-2 sm:hidden">
            {sortedTasksForMobile.map((task) => {
              const dueLabel = formatDueLabel(task.dueDate as string)
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onTaskClick(task)}
                  className="flex min-h-[40px] items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/60"
                >
                  <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {task.title}
                  </span>
                  <span
                    className={`shrink-0 text-xs font-medium ${
                      dueLabel.isOverdue
                        ? 'text-red-500 dark:text-red-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {dueLabel.text}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
