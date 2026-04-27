import { useState, useRef, useEffect } from 'react'
import { columnDefs } from '../../lib/columns'

interface ColumnSelectorProps {
  visibleColumns: Set<string>
  onToggle: (field: string) => void
}

export function ColumnSelector({ visibleColumns, onToggle }: ColumnSelectorProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="text-[12px] text-[#8b949e] bg-transparent border border-[#30363d] rounded px-3 py-1 cursor-pointer hover:bg-[#30363d] hover:text-[#c9d1d9]"
      >
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 bg-[#161b22] border border-[#30363d] rounded-lg p-3 w-[220px] shadow-lg">
          <div className="text-[11px] text-[#8b949e] uppercase tracking-wide mb-2">Show / Hide Columns</div>
          {columnDefs.map((col) => {
            const field = col.field!
            const checked = visibleColumns.has(field)
            return (
              <label
                key={field}
                className="flex items-center gap-2 py-1 px-1 rounded cursor-pointer hover:bg-[#1c2128] text-[13px]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(field)}
                  className="accent-[#58a6ff]"
                />
                <span className={checked ? 'text-[#c9d1d9]' : 'text-[#8b949e]'}>
                  {col.headerName}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
