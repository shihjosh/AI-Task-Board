import { Search, SlidersHorizontal, Plus, LayoutGrid } from 'lucide-react'

const tabs = ['Dashboard', '議題看板', '列表視圖', '甘特圖']

export default function Toolbar() {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <LayoutGrid size={18} className="text-slate-400" />
        <span className="text-sm font-medium text-slate-500">AI Task Board</span>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-semibold text-slate-800">codex-taskboard</span>
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
        {tabs.map((tab, i) => (
          <button
            key={tab}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              i === 1 ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <Search size={16} />
        </button>
        <button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <SlidersHorizontal size={16} />
        </button>
        <button className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
          <Plus size={15} />
          新增任務
        </button>
      </div>
    </div>
  )
}
