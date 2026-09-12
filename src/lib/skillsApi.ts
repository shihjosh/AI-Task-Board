async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  return res.json()
}

export async function fetchAvailableSkills(): Promise<string[]> {
  const res = await fetch('/api/skills')
  const data = await handle<{ skills: string[] }>(res)
  return data.skills
}
