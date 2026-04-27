import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/api'
import type { OverviewResponse } from '../types/api'

export function useOverview(db: string) {
  return useQuery({
    queryKey: ['overview', db],
    queryFn: () => fetchApi<OverviewResponse>('/overview', { db }),
    staleTime: 5 * 60 * 1000,
    enabled: !!db,
  })
}
