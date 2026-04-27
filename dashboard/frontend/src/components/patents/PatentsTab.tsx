import { useState, useCallback } from 'react'
import { FilterBar, type PatentFilterValues } from './FilterBar'
import { PatentGrid } from './PatentGrid'
import { ColumnSelector } from './ColumnSelector'
import { columnDefs } from '../../lib/columns'

// Default visible = columns without hide: true
const defaultVisible = new Set(
  columnDefs.filter((c) => !c.hide).map((c) => c.field!)
)

interface PatentsTabProps {
  db: string
}

export function PatentsTab({ db }: PatentsTabProps) {
  const [filters, setFilters] = useState<PatentFilterValues>({
    search: '', type: '', status: '', applicant: '', inventor: '', examiner: '', dateFrom: '', dateTo: '',
  })
  const [total, setTotal] = useState(0)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(defaultVisible))

  const handleExport = () => {
    const params = new URLSearchParams({ db })
    if (filters.search) params.set('search', filters.search)
    if (filters.type) params.set('type', filters.type)
    if (filters.status) params.set('status', filters.status)
    if (filters.applicant) params.set('applicant', filters.applicant)
    if (filters.inventor) params.set('inventor', filters.inventor)
    if (filters.examiner) params.set('examiner', filters.examiner)
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
    if (filters.dateTo) params.set('dateTo', filters.dateTo)
    window.open(`/api/v1/patents/export/csv?${params}`, '_blank')
  }

  const handleTotalChange = useCallback((t: number) => setTotal(t), [])

  const handleColumnToggle = (field: string) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev)
      if (next.has(field)) {
        next.delete(field)
      } else {
        next.add(field)
      }
      return next
    })
  }

  return (
    <div>
      <FilterBar
        db={db}
        total={total}
        onFilterChange={setFilters}
        onExport={handleExport}
        columnSelector={<ColumnSelector visibleColumns={visibleColumns} onToggle={handleColumnToggle} />}
      />
      <PatentGrid db={db} filters={filters} onTotalChange={handleTotalChange} visibleColumns={visibleColumns} />
    </div>
  )
}
