import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { AutomationRun } from '../types/task'
import { fetchAutomationRuns } from '../lib/automationRunsApi'

interface AutomationRunListProps {
  taskId: string
}

function formatTimestamp(iso?: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('zh-TW', { hour12: false })
}

const statusConfig = {
  running: { icon: Loader2, label: '執行中', className: 'text-sky-600 dark:text-sky-400', spin: true },
  done: { icon: CheckCircle2, label: '已完成', className: 'text-emerald-600 dark:text-emerald-400', spin: false },
  failed: { icon: XCircle, label: '失敗', className: 'text-red-600 dark:text-red-400', spin: false },
} as const

export default function AutomationRunList({ taskId }: AutomationRunListProps) {
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  function load() {
    setIsLoading(true)
    fetchAutomationRuns(taskId)
      .then(setRuns)
      .catch((err) => setError(err instanceof Error ? err.message : '載入執行紀錄失敗'))
      .finally(() => setIsLoading(false))
  }

  if (isLoading) {
    return <p className="text-sm text-slate-400 dark:text-slate-500">載入執行紀錄中…</p>
  }

  if (error) {
    return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</div>
  }

  if (runs.length === 0) {
    return <p className="text-sm text-slate-400 dark:text-slate-500">尚無執行紀錄</p>
  }

  return (
    <ul className="space-y-2">
      {runs.map((run) => {
        const config = statusConfig[run.status]
        const Icon = config.icon
        return (
          <li key={run.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <div className="mb-1 flex items-center justify-between">
              <span className={`flex items-center gap-1.5 font-medium ${config.className}`}>
                <Icon size={14} className={config.spin ? 'animate-spin' : ''} />
                {config.label}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {formatTimestamp(run.startedAt)}
                {run.finishedAt ? ` ～ ${formatTimestamp(run.finishedAt)}` : ''}
              </span>
            </div>
            {run.error && <p className="whitespace-pre-wrap text-red-600 dark:text-red-400">{run.error}</p>}
            {run.output && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400">查看輸出內容</summary>
                <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{run.output}</p>
              </details>
            )}
          </li>
        )
      })}
    </ul>
  )
}
