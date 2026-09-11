import type { Column } from '../types/task'

export const columns: Column[] = [
  { id: 'todo', title: '等待認領', colorClass: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
  { id: 'in_progress', title: '處理中', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' },
  { id: 'review', title: '等你確認', colorClass: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800' },
  { id: 'done', title: '已完成', colorClass: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800' },
]

// 看板主頁面只顯示前三欄；「已完成」欄位改在獨立的 /done 頁面呈現，
// 避免四欄總寬度超出常見桌面視窗寬度造成裁切（見 spec 文件背景說明）。
export const BOARD_COLUMNS: Column[] = columns.filter((c) => c.id !== 'done')
