import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import TaskCard from './TaskCard'
import type { Task } from '../types/task'

const baseTask: Task = {
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

describe('TaskCard', () => {
  it('shows interrupted badge when automationStatus is interrupted', () => {
    render(<TaskCard task={baseTask} />)
    expect(screen.getByText('執行中斷')).toBeInTheDocument()
  })

  it('does not show interrupted badge for idle tasks', () => {
    render(<TaskCard task={{ ...baseTask, automationStatus: 'idle' }} />)
    expect(screen.queryByText('執行中斷')).not.toBeInTheDocument()
  })
})
