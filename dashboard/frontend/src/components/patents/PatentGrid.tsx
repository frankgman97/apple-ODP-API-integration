import { useCallback, useRef, useEffect, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ModuleRegistry, InfiniteRowModelModule, type GridApi, type IGetRowsParams, type SortModelItem } from 'ag-grid-community'
import { columnDefs } from '../../lib/columns'
import type { PatentFilterValues } from './FilterBar'

ModuleRegistry.registerModules([InfiniteRowModelModule])

interface PatentGridProps {
  db: string
  filters: PatentFilterValues
  onTotalChange: (total: number) => void
  visibleColumns: Set<string>
}

export function PatentGrid({ db, filters, onTotalChange, visibleColumns }: PatentGridProps) {
  const gridRef = useRef<AgGridReact>(null)
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  // Derive column defs with hide based on visibleColumns
  const activeColumnDefs = useMemo(
    () => columnDefs.map((col) => ({
      ...col,
      hide: !visibleColumns.has(col.field!),
    })),
    [visibleColumns]
  )

  const datasource = useCallback(() => ({
    getRows: async (params: IGetRowsParams) => {
      const f = filtersRef.current
      const sortModel: SortModelItem[] = params.sortModel as SortModelItem[]
      const sort = sortModel[0]?.colId || 'filing_date'
      const order = sortModel[0]?.sort || 'desc'

      const urlParams = new URLSearchParams({
        db,
        offset: String(params.startRow),
        limit: String(params.endRow - params.startRow),
        sort,
        order,
      })

      if (f.search) urlParams.set('search', f.search)
      if (f.type) urlParams.set('type', f.type)
      if (f.status) urlParams.set('status', f.status)
      if (f.applicant) urlParams.set('applicant', f.applicant)
      if (f.inventor) urlParams.set('inventor', f.inventor)
      if (f.examiner) urlParams.set('examiner', f.examiner)
      if (f.dateFrom) urlParams.set('dateFrom', f.dateFrom)
      if (f.dateTo) urlParams.set('dateTo', f.dateTo)

      try {
        const res = await fetch(`/api/v1/patents?${urlParams}`)
        const data = await res.json()
        onTotalChange(data.total)
        params.successCallback(data.rows, data.total)
      } catch {
        params.failCallback()
      }
    },
  }), [db, onTotalChange])

  // Refresh the grid when filters change
  useEffect(() => {
    const api: GridApi | undefined = gridRef.current?.api
    if (api) {
      api.setGridOption('datasource', datasource())
    }
  }, [filters, datasource])

  return (
    <div className="ag-theme-quartz-dark" style={{ height: 'calc(100vh - 240px)', width: '100%' }}>
      <AgGridReact
        ref={gridRef}
        columnDefs={activeColumnDefs}
        rowModelType="infinite"
        datasource={datasource()}
        cacheBlockSize={100}
        maxBlocksInCache={10}
        defaultColDef={{
          sortable: true,
          resizable: true,
        }}
      />
    </div>
  )
}
