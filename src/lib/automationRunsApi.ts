import type { AutomationRun } from '../types/task'

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  return res.json()
}

export async function fetchAutomationRuns(taskId: string): Promise<AutomationRun[]> {
  const res = await fetch(`/api/tasks/${taskId}/automation-runs`)
  const data = await handle<{ runs: AutomationRun[] }>(res)
  return data.runs
}
