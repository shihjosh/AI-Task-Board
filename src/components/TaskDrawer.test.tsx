import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TaskDrawer from './TaskDrawer'
import * as skillsApi from '../lib/skillsApi'
import type { Task } from '../types/task'

vi.mock('../lib/skillsApi')
vi.mock('./CommentList', () => ({ default: () => null }))
vi.mock('./AutomationRunList', () => ({ default: () => null }))

const interruptedTask: Task = {
  id: 'task-1',
  title: '測試任務',
  priority: 'medium',
  tags: [],
  assignees: [],
  commentCount: 0,
  columnId: 'in_progress',
  targetPath: '/tmp/repo',
  automationStatus: 'interrupted',
  createdAt: '2026-09-16T00:00:00.000Z',
}

describe('TaskDrawer interrupted state', () => {
  beforeEach(() => {
    vi.mocked(skillsApi.fetchAvailableSkills).mockResolvedValue([])
  })

  it('shows retry and abandon buttons when automation is interrupted', async () => {
    render(
      <TaskDrawer
        isOpen={true}
        mode="edit"
        initialTask={interruptedTask}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(
      await screen.findByText((_, element) => element?.textContent === '目前自動執行狀態：執行中斷'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新執行' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放棄' })).toBeInTheDocument()
  })

  it('does not show retry/abandon buttons for idle tasks', async () => {
    render(
      <TaskDrawer
        isOpen={true}
        mode="edit"
        initialTask={{ ...interruptedTask, automationStatus: 'idle' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '重新執行' })).not.toBeInTheDocument()
  })
})
