import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import TaskCard from './TaskCard'
import TaskDrawer from './TaskDrawer'
import { fetchTasks } from '../lib/api'
import type { Task } from '../types/task'

export default function DonePage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  function reload() {
    setIsLoading(true)
    fetchTasks()
      .then(setTasks)
      .catch((err) => setLoadError(err.message))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doneTasks = tasks.filter((t) => t.columnId === 'done')

  function openEditDrawer(task: Task) {
    setEditingTask(task)
    setIsDrawerOpen(true)
  }

  function closeDrawer() {
    setIsDrawerOpen(false)
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-400 dark:bg-slate-900 dark:text-slate-500">
        載入任務中…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-red-500 dark:bg-slate-900 dark:text-red-400">
        載入失敗：{loadError}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-white p-6 dark:bg-slate-900">
      <Link
        to="/"
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft size={15} />
        返回看板
      </Link>
      <h1 className="mb-4 text-lg font-semibold text-slate-800 dark:text-slate-100">
        已完成任務（{doneTasks.length}）
      </h1>
      {doneTasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-16 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          目前沒有已完成的任務
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:max-w-2xl">
          {doneTasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => openEditDrawer(task)} />
          ))}
        </div>
      )}
      <TaskDrawer
        isOpen={isDrawerOpen}
        mode="edit"
        initialTask={editingTask ?? undefined}
        onClose={closeDrawer}
        onSaved={reload}
      />
    </div>
  )
}
