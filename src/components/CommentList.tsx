import { useEffect, useState } from 'react'
import { Trash2, Pencil, X, Check } from 'lucide-react'
import type { Comment } from '../types/task'
import { fetchComments, createCommentApi, updateCommentApi, deleteCommentApi } from '../lib/commentsApi'

interface CommentListProps {
  taskId: string
}

const AUTHOR_NAME = 'Josh'

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', { hour12: false })
}

export default function CommentList({ taskId }: CommentListProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newContent, setNewContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')

  function reload() {
    setIsLoading(true)
    fetchComments(taskId)
      .then(setComments)
      .catch((err) => setError(err instanceof Error ? err.message : '載入留言失敗'))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  async function handleAdd() {
    const content = newContent.trim()
    if (!content) return
    setIsSubmitting(true)
    setError(null)
    try {
      await createCommentApi(taskId, content)
      setNewContent('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '新增留言失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  function startEdit(comment: Comment) {
    setEditingId(comment.id)
    setEditingContent(comment.content)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingContent('')
  }

  async function handleSaveEdit(id: string) {
    const content = editingContent.trim()
    if (!content) return
    setIsSubmitting(true)
    setError(null)
    try {
      await updateCommentApi(id, content)
      cancelEdit()
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '編輯留言失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('確定要刪除這則留言嗎？')) return
    setIsSubmitting(true)
    setError(null)
    try {
      await deleteCommentApi(id)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除留言失敗')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mb-6">
      <span className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">留言</span>

      {error && (
        <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">載入留言中…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">尚無留言</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
              {editingId === comment.id ? (
                <div>
                  <textarea
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    rows={3}
                    className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={isSubmitting}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                    >
                      <X size={13} /> 取消
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(comment.id)}
                      disabled={isSubmitting}
                      className="flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                    >
                      <Check size={13} /> 儲存
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{AUTHOR_NAME}</span>
                    <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                      <span>
                        {formatTimestamp(comment.createdAt)}
                        {comment.updatedAt !== comment.createdAt ? '（已編輯）' : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => startEdit(comment)}
                        className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                        aria-label="編輯留言"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(comment.id)}
                        className="text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400"
                        aria-label="刪除留言"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">{comment.content}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          rows={2}
          placeholder="新增留言…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-sky-500"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isSubmitting || !newContent.trim()}
          className="self-end rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          送出
        </button>
      </div>
    </div>
  )
}
