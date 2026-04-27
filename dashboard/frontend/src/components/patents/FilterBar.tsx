import { useState, useEffect, type ReactNode } from 'react'
import { usePatentFilters } from '../../hooks/usePatents'

export interface PatentFilterValues {
  search: string
  type: string
  status: string
  applicant: string
  inventor: string
  examiner: string
  dateFrom: string
  dateTo: string
}

const EMPTY_FILTERS: PatentFilterValues = {
  search: '', type: '', status: '', applicant: '', inventor: '', examiner: '', dateFrom: '', dateTo: '',
}

interface FilterBarProps {
  db: string
  total: number
  onFilterChange: (filters: PatentFilterValues) => void
  onExport: () => void
  columnSelector?: ReactNode
}

const inputClass = 'w-full bg-[#161b22] border border-[#30363d] rounded-md px-2.5 py-1.5 text-[13px] text-[#c9d1d9] outline-none focus:border-[#58a6ff]'
const selectClass = inputClass

export function FilterBar({ db, total, onFilterChange, onExport, columnSelector }: FilterBarProps) {
  const [filters, setFilters] = useState<PatentFilterValues>(EMPTY_FILTERS)
  const { data: filterOptions } = usePatentFilters(db)

  // Reset filters when database changes
  useEffect(() => {
    setFilters(EMPTY_FILTERS)
    onFilterChange(EMPTY_FILTERS)
  }, [db]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: keyof PatentFilterValues, value: string) => {
    const next = { ...filters, [key]: value }
    setFilters(next)
    onFilterChange(next)
  }

  const clear = () => {
    setFilters(EMPTY_FILTERS)
    onFilterChange(EMPTY_FILTERS)
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold uppercase tracking-wide">Filters</span>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-[#8b949e]">{total.toLocaleString()} patents</span>
          <button
            onClick={clear}
            className="text-[12px] text-[#8b949e] bg-transparent border-none cursor-pointer hover:text-[#c9d1d9]"
          >
            Clear
          </button>
          {columnSelector}
          <button
            onClick={onExport}
            className="text-[12px] text-[#58a6ff] bg-transparent border border-[#30363d] rounded px-3 py-1 cursor-pointer hover:bg-[#30363d]"
          >
            Export CSV
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <input
          type="text"
          placeholder="Search title, app #, patent #..."
          value={filters.search}
          onChange={(e) => update('search', e.target.value)}
          className={inputClass}
        />
        <select value={filters.type} onChange={(e) => update('type', e.target.value)} className={selectClass}>
          <option value="">All Types</option>
          {filterOptions?.appTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => update('status', e.target.value)} className={selectClass}>
          <option value="">All Statuses</option>
          {filterOptions?.statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Applicant..."
          value={filters.applicant}
          onChange={(e) => update('applicant', e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Inventor..."
          value={filters.inventor}
          onChange={(e) => update('inventor', e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Examiner..."
          value={filters.examiner}
          onChange={(e) => update('examiner', e.target.value)}
          className={inputClass}
        />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => update('dateFrom', e.target.value)}
          className={inputClass}
          title="Filing date from"
        />
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => update('dateTo', e.target.value)}
          className={inputClass}
          title="Filing date to"
        />
      </div>
    </div>
  )
}
