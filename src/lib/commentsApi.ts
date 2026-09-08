import type { Comment } from '../types/task'

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export async function fetchComments(taskId: string): Promise<Comment[]> {
  const res = await fetch(`/api/tasks/${taskId}/comments`)
  const data = await handle<{ comments: Comment[] }>(res)
  return data.comments
}

export async function createCommentApi(taskId: string, content: string): Promise<Comment> {
  const res = await fetch(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  const data = await handle<{ comment: Comment }>(res)
  return data.comment
}

export async function updateCommentApi(id: string, content: string): Promise<Comment> {
  const res = await fetch(`/api/comments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  const data = await handle<{ comment: Comment }>(res)
  return data.comment
}

export async function deleteCommentApi(id: string): Promise<void> {
  const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' })
  await handle<void>(res)
}
