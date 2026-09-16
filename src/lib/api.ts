import type { Task } from '../types/task'

const BASE = '/api/tasks'

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch(BASE)
  const data = await handle<{ tasks: Task[] }>(res)
  return data.tasks
}

export async function createTaskApi(input: Omit<Task, 'id' | 'createdAt'>): Promise<Task> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await handle<{ task: Task }>(res)
  return data.task
}

export async function updateTaskApi(id: string, patch: Partial<Task>): Promise<Task> {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const data = await handle<{ task: Task }>(res)
  return data.task
}

export async function deleteTaskApi(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' })
  await handle<void>(res)
}

export async function retryAutomationApi(id: string): Promise<Task> {
  const res = await fetch(`${BASE}/${id}/retry-automation`, { method: 'POST' })
  const data = await handle<{ task: Task }>(res)
  return data.task
}
