import { useState, useRef, useEffect } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { TAG_OPTIONS } from '../data/options'
import type { TagType } from '../types/task'

interface TagFilterPanelProps {
  selected: TagType[]
  onChange: (tags: TagType[]) => void
}

export default function TagFilterPanel({ selected, onChange }: TagFilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleTag(type: TagType) {
    onChange(selected.includes(type) ? selected.filter((t) => t !== type) : [...selected, type])
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        aria-label="篩選標籤"
      >
        <SlidersHorizontal size={16} />
        {selected.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900 text-[9px] font-medium text-white dark:bg-slate-100 dark:text-slate-900">
            {selected.length}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {TAG_OPTIONS.map((tag) => (
            <label key={tag.type} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700">
              <input
                type="checkbox"
                checked={selected.includes(tag.type)}
                onChange={() => toggleTag(tag.type)}
                className="dark:accent-sky-500"
              />
              {tag.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
