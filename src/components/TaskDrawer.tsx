import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Task, Priority, ColumnId, TagType } from '../types/task'
import { TAG_OPTIONS, ASSIGNEE_OPTIONS, PRIORITY_OPTIONS, COLUMN_OPTIONS } from '../data/options'
import { createTaskApi, updateTaskApi, deleteTaskApi, retryAutomationApi } from '../lib/api'
import { fetchAvailableSkills } from '../lib/skillsApi'
import CommentList from './CommentList'
import AutomationRunList from './AutomationRunList'

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
  description: '',
  targetPath: '',
  dueDate: '',
  automationSkill: '' as string,
}

export default function TaskDrawer({ isOpen, mode, initialTask, onClose, onSaved }: TaskDrawerProps) {
  const [form, setForm] = useState(emptyFormState)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [descriptionTab, setDescriptionTab] = useState<'edit' | 'preview'>('edit')
  const [bottomTab, setBottomTab] = useState<'comments' | 'automation'>('comments')
  const [availableSkills, setAvailableSkills] = useState<string[]>([])

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
        description: initialTask.description ?? '',
        targetPath: initialTask.targetPath ?? '',
        dueDate: initialTask.dueDate ?? '',
        automationSkill: initialTask.automationSkill ?? '',
      })
    } else {
      setForm(emptyFormState)
    }
    setError(null)
    setDescriptionTab('edit')
    setBottomTab('comments')
  }, [isOpen, mode, initialTask])

  useEffect(() => {
    fetchAvailableSkills().then(setAvailableSkills).catch(() => setAvailableSkills([]))
  }, [])

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
      description: form.description,
      targetPath: form.targetPath.trim(),
      automationStatus: initialTask?.automationStatus ?? 'idle',
      commentCount: initialTask?.commentCount ?? 0,
      hasUnread: initialTask?.hasUnread ?? false,
      dueDate: form.dueDate || undefined,
      automationSkill: form.automationSkill || undefined,
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

  async function handleRetryAutomation() {
    if (!initialTask) return
    setIsSubmitting(true)
    setError(null)
    try {
      await retryAutomationApi(initialTask.id)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新執行失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleAbandonAutomation() {
    if (!initialTask) return
    setIsSubmitting(true)
    setError(null)
    try {
      await updateTaskApi(initialTask.id, { automationStatus: 'failed' })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative flex h-full w-full max-w-3xl flex-col overflow-y-auto bg-white p-6 shadow-xl dark:bg-slate-800"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {mode === 'create' ? '新增任務' : '編輯任務'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</div>
        )}

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">標題 *</span>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
          />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">優先級</span>
          <select
            value={form.priority}
            onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value as Priority }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">欄位</span>
          <select
            value={form.columnId}
            onChange={(e) => setForm((p) => ({ ...p, columnId: e.target.value as ColumnId }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
          >
            {COLUMN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-3 text-sm">
          <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">標籤</span>
          <div className="flex flex-wrap gap-2">
            {TAG_OPTIONS.map((tag) => (
              <label key={tag.type} className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={form.tagTypes.includes(tag.type)}
                  onChange={() => toggleTag(tag.type)}
                  className="dark:accent-sky-500"
                />
                {tag.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mb-3 text-sm">
          <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">負責人</span>
          <div className="flex flex-wrap gap-2">
            {ASSIGNEE_OPTIONS.map((a) => (
              <label key={a.id} className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={form.assigneeIds.includes(a.id)}
                  onChange={() => toggleAssignee(a.id)}
                  className="dark:accent-sky-500"
                />
                {a.name}
              </label>
            ))}
          </div>
        </div>

        <label className="mb-6 block text-sm">
          <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">進度（0-100，可留空）</span>
          <input
            type="number"
            min={0}
            max={100}
            value={form.progress}
            onChange={(e) => setForm((p) => ({ ...p, progress: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
          />
        </label>

        <label className="mb-6 block text-sm">
          <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">預計完成日期（選填，甘特圖使用）</span>
          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:[color-scheme:dark] dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
          />
        </label>

        <label className="mb-6 block text-sm">
          <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">
            自動執行目錄（選填，絕對路徑；填寫後拖到「處理中」會觸發 Hermes 自動執行）
          </span>
          <input
            type="text"
            value={form.targetPath}
            onChange={(e) => setForm((p) => ({ ...p, targetPath: e.target.value }))}
            placeholder="/home/ubuntu/some-project"
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
          />
          {mode === 'edit' && initialTask?.automationStatus && initialTask.automationStatus !== 'idle' && (
            <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
              目前自動執行狀態：
              {initialTask.automationStatus === 'running' && '執行中'}
              {initialTask.automationStatus === 'done' && '已完成'}
              {initialTask.automationStatus === 'failed' && '失敗'}
              {initialTask.automationStatus === 'interrupted' && '執行中斷'}
            </span>
          )}
          {mode === 'edit' && initialTask?.automationStatus === 'interrupted' && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleRetryAutomation}
                disabled={isSubmitting}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                重新執行
              </button>
              <button
                type="button"
                onClick={handleAbandonAutomation}
                disabled={isSubmitting}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                放棄
              </button>
            </div>
          )}
        </label>

        <label className="mb-6 block text-sm">
          <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">
            自動執行使用的 Skill（選填，未選則由 Hermes 自行判斷）
          </span>
          <select
            value={form.automationSkill}
            onChange={(e) => setForm((p) => ({ ...p, automationSkill: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
          >
            <option value="">（不指定）</option>
            {availableSkills.map((skill) => (
              <option key={skill} value={skill}>
                {skill}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-6">
          <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">描述（Markdown）</span>
          <div className="mb-2 flex gap-1 border-b border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setDescriptionTab('edit')}
              className={`px-3 py-1.5 text-sm font-medium ${
                descriptionTab === 'edit'
                  ? 'border-b-2 border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100'
                  : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
              }`}
            >
              編輯
            </button>
            <button
              type="button"
              onClick={() => setDescriptionTab('preview')}
              className={`px-3 py-1.5 text-sm font-medium ${
                descriptionTab === 'preview'
                  ? 'border-b-2 border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100'
                  : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
              }`}
            >
              預覽
            </button>
          </div>
          {descriptionTab === 'edit' ? (
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={8}
              placeholder="支援 Markdown 語法（標題、清單、表格、程式碼區塊等）"
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
            />
          ) : (
            <div className="prose prose-sm prose-slate dark:prose-invert min-h-[12rem] max-w-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 overflow-y-auto text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              {form.description.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.description}</ReactMarkdown>
              ) : (
                <span className="text-slate-400 dark:text-slate-500">預覽區（尚無內容）</span>
              )}
            </div>
          )}
        </div>

        {mode === 'edit' && initialTask && (
          <div className="mb-6">
            <div className="mb-2 flex gap-1 border-b border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setBottomTab('comments')}
                className={`px-3 py-1.5 text-sm font-medium ${
                  bottomTab === 'comments'
                    ? 'border-b-2 border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100'
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                }`}
              >
                留言
              </button>
              <button
                type="button"
                onClick={() => setBottomTab('automation')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${
                  bottomTab === 'automation'
                    ? 'border-b-2 border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100'
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                }`}
              >
                執行紀錄
                {initialTask.automationStatus === 'running' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400" />
                )}
                {initialTask.automationStatus === 'interrupted' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                )}
              </button>
            </div>
            {bottomTab === 'comments' ? (
              <CommentList taskId={initialTask.id} />
            ) : (
              <AutomationRunList taskId={initialTask.id} />
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2">
          {mode === 'edit' && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
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
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              {mode === 'create' ? '建立' : '儲存'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
