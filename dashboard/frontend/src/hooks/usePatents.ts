import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/api'
import type { PatentFilters } from '../types/api'

export function usePatentFilters(db: string) {
  return useQuery({
    queryKey: ['patentFilters', db],
    queryFn: () => fetchApi<PatentFilters>('/patents/filters', { db }),
    staleTime: 5 * 60 * 1000,
    enabled: !!db,
  })
}
