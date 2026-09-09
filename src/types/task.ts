export type Priority = 'high' | 'medium' | 'low'

export type TagType = 'github' | 'issue' | 'bug' | 'pr'

export type ColumnId = 'todo' | 'in_progress' | 'review'

export interface Tag {
  type: TagType
  label: string
}

export interface Assignee {
  id: string
  name: string
  avatarColor: string
  initials: string
}

export interface Task {
  id: string
  title: string
  priority: Priority
  tags: Tag[]
  assignees: Assignee[]
  progress?: number // 0-100, only meaningful for in_progress
  commentCount: number
  hasUnread?: boolean
  columnId: ColumnId
  description?: string // Markdown 原始文字，可為空字串或 undefined
  targetPath: string // Hermes agent 執行任務時的工作目錄（絕對路徑），空字串代表此卡不可自動執行
  automationStatus: 'idle' | 'running' | 'done' | 'failed'
}

export interface Comment {
  id: string
  taskId: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface AutomationRun {
  id: string
  taskId: string
  status: 'running' | 'done' | 'failed'
  prompt: string
  output: string
  error?: string
  startedAt: string
  finishedAt?: string
}

export interface Column {
  id: ColumnId
  title: string
  colorClass: string
}
