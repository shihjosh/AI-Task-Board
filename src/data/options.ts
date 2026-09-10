import type { Assignee, Tag } from '../types/task'

export const TAG_OPTIONS: Tag[] = [
  { type: 'github', label: 'GitHub' },
  { type: 'issue', label: 'Issue' },
  { type: 'bug', label: 'BUG' },
  { type: 'pr', label: 'PR' },
]

export const ASSIGNEE_OPTIONS: Assignee[] = [
  { id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' },
  { id: 'u2', name: 'Amy', avatarColor: 'bg-orange-500', initials: 'AM' },
  { id: 'u3', name: 'Ken', avatarColor: 'bg-blue-500', initials: 'KN' },
]

export const PRIORITY_OPTIONS: { value: 'high' | 'medium' | 'low'; label: string }[] = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

export const COLUMN_OPTIONS: { value: 'todo' | 'in_progress' | 'review' | 'done'; label: string }[] = [
  { value: 'todo', label: '等待認領' },
  { value: 'in_progress', label: '處理中' },
  { value: 'review', label: '等你確認' },
  { value: 'done', label: '已完成' },
]
