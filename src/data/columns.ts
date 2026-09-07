import type { Column } from '../types/task'

export const columns: Column[] = [
  { id: 'todo', title: '等待認領', colorClass: 'bg-slate-100 text-slate-600 border-slate-200' },
  { id: 'in_progress', title: '處理中', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'review', title: '等你確認', colorClass: 'bg-sky-50 text-sky-700 border-sky-200' },
]
