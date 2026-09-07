import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import type { Task, Priority, ColumnId, TagType } from '../types/task'
import { TAG_OPTIONS, ASSIGNEE_OPTIONS, PRIORITY_OPTIONS, COLUMN_OPTIONS } from '../data/options'
import { createTaskApi, updateTaskApi, deleteTaskApi } from '../lib/api'

interface TaskDrawerProps {
  isOpen: boolean
  mode: 'create' | 'edit'
  initialTask?: Task
  onClose: () => void
  onSaved: () => void
}

const emptyFormState = {
  title: '',
  priority: 'medium' as Priority,
  columnId: 'todo' as ColumnId,
  tagTypes: [] as TagType[],
  assigneeIds: [] as string[],
  progress: '' as string,
}

export default function TaskDrawer({ isOpen, mode, initialTask, onClose, onSaved }: TaskDrawerProps) {
  const [form, setForm] = useState(emptyFormState)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (mode === 'edit' && initialTask) {
      setForm({
        title: initialTask.title,
        priority: initialTask.priority,
        columnId: initialTask.columnId,
        tagTypes: initialTask.tags.map((t) => t.type),
        assigneeIds: initialTask.assignees.map((a) => a.id),
        progress: typeof initialTask.progress === 'number' ? String(initialTask.progress) : '',
      })
    } else {
      setForm(emptyFormState)
    }
    setError(null)
  }, [isOpen, mode, initialTask])

  if (!isOpen) return null

  function toggleTag(type: TagType) {
    setForm((prev) => ({
      ...prev,
      tagTypes: prev.tagTypes.includes(type)
        ? prev.tagTypes.filter((t) => t !== type)
        : [...prev.tagTypes, type],
    }))
  }

  function toggleAssignee(id: string) {
    setForm((prev) => ({
      ...prev,
      assigneeIds: prev.assigneeIds.includes(id)
        ? prev.assigneeIds.filter((a) => a !== id)
        : [...prev.assigneeIds, id],
    }))
  }

  function buildPayload() {
    const tags = TAG_OPTIONS.filter((t) => form.tagTypes.includes(t.type))
    const assignees = ASSIGNEE_OPTIONS.filter((a) => form.assigneeIds.includes(a.id))
    const progress =
      form.progress.trim() === '' ? undefined : Math.min(100, Math.max(0, Number(form.progress)))
    return {
      title: form.title.trim(),
      priority: form.priority,
      columnId: form.columnId,
      tags,
      assignees,
      progress,
      commentCount: initialTask?.commentCount ?? 0,
      hasUnread: initialTask?.hasUnread ?? false,
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) {
      setError('標題為必填')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createTaskApi(buildPayload())
      } else if (initialTask) {
        await updateTaskApi(initialTask.id, buildPayload())
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!initialTask) return
    if (!window.confirm(`確定要刪除任務「${initialTask.title}」嗎？`)) return
    setIsSubmitting(true)
    setError(null)
    try {
      await deleteTaskApi(initialTask.id)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">
            {mode === 'create' ? '新增任務' : '編輯任務'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        )}

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">標題 *</span>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">優先級</span>
          <select
            value={form.priority}
            onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value as Priority }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">欄位</span>
          <select
            value={form.columnId}
            onChange={(e) => setForm((p) => ({ ...p, columnId: e.target.value as ColumnId }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {COLUMN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-3 text-sm">
          <span className="mb-1 block font-medium text-slate-600">標籤</span>
          <div className="flex flex-wrap gap-2">
            {TAG_OPTIONS.map((tag) => (
              <label key={tag.type} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={form.tagTypes.includes(tag.type)}
                  onChange={() => toggleTag(tag.type)}
                />
                {tag.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mb-3 text-sm">
          <span className="mb-1 block font-medium text-slate-600">負責人</span>
          <div className="flex flex-wrap gap-2">
            {ASSIGNEE_OPTIONS.map((a) => (
              <label key={a.id} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={form.assigneeIds.includes(a.id)}
                  onChange={() => toggleAssignee(a.id)}
                />
                {a.name}
              </label>
            ))}
          </div>
        </div>

        <label className="mb-6 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">進度（0-100，可留空）</span>
          <input
            type="number"
            min={0}
            max={100}
            value={form.progress}
            onChange={(e) => setForm((p) => ({ ...p, progress: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="mt-auto flex items-center justify-between gap-2">
          {mode === 'edit' && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <Trash2 size={15} />
              刪除
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {mode === 'create' ? '建立' : '儲存'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
