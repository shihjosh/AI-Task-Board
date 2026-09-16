import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AutomationRunList from './AutomationRunList'
import * as automationRunsApi from '../lib/automationRunsApi'
import type { AutomationRun } from '../types/task'

vi.mock('../lib/automationRunsApi')

const interruptedRun: AutomationRun = {
  id: 'run-1',
  taskId: 'task-1',
  status: 'interrupted',
  prompt: 'do something',
  output: '',
  error: '伺服器重啟或程序中斷，執行狀態不明（原本狀態：running）',
  startedAt: '2026-09-16T00:00:00.000Z',
  finishedAt: '2026-09-16T00:01:00.000Z',
}

describe('AutomationRunList', () => {
  beforeEach(() => {
    vi.mocked(automationRunsApi.fetchAutomationRuns).mockResolvedValue([interruptedRun])
  })

  it('renders interrupted status without throwing', async () => {
    render(<AutomationRunList taskId="task-1" />)
    expect(await screen.findByText('已中斷')).toBeInTheDocument()
  })
})
