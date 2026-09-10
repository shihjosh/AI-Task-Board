import { useState } from 'react'
import { Search, X } from 'lucide-react'

interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
}

export default function SearchBox({ value, onChange }: SearchBoxProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!isExpanded && !value) {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label="搜尋"
      >
        <Search size={16} />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1">
      <Search size={14} className="text-slate-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="搜尋任務標題…"
        autoFocus
        className="w-32 text-sm outline-none sm:w-48"
      />
      <button
        type="button"
        onClick={() => {
          onChange('')
          setIsExpanded(false)
        }}
        className="text-slate-400 hover:text-slate-600"
        aria-label="清除搜尋"
      >
        <X size={14} />
      </button>
    </div>
  )
}
