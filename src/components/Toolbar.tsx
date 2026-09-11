import { Plus, LayoutGrid } from 'lucide-react'
import { Link } from 'react-router-dom'
import SearchBox from './SearchBox'
import TagFilterPanel from './TagFilterPanel'
import type { TagType } from '../types/task'

const tabs: { id: 'dashboard' | 'board' | 'list' | 'gantt'; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'board', label: '議題看板' },
  { id: 'list', label: '列表視圖' },
  { id: 'gantt', label: '甘特圖' },
]

interface ToolbarProps {
  onAddTask: () => void
  doneCount?: number
  searchQuery: string
  onSearchChange: (value: string) => void
  selectedTagTypes: TagType[]
  onTagTypesChange: (tags: TagType[]) => void
  activeView: 'board' | 'list' | 'gantt'
  onViewChange: (view: 'board' | 'list' | 'gantt') => void
}

export default function Toolbar({
  onAddTask,
  doneCount = 0,
  searchQuery,
  onSearchChange,
  selectedTagTypes,
  onTagTypesChange,
  activeView,
  onViewChange,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <LayoutGrid size={18} className="text-slate-400" />
        <span className="text-sm font-medium text-slate-500">AI Task Board</span>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-semibold text-slate-800">my-taskboard</span>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              if (tab.id === 'dashboard') return
              onViewChange(tab.id)
            }}
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
              activeView === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Link
          to="/done"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          已完成 ({doneCount})
        </Link>
        <SearchBox value={searchQuery} onChange={onSearchChange} />
        <TagFilterPanel selected={selectedTagTypes} onChange={onTagTypesChange} />
        <button
          onClick={onAddTask}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus size={15} />
          新增任務
        </button>
      </div>
    </div>
  )
}
