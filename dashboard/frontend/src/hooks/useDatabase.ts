import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/api'
import type { DatabaseInfo } from '../types/api'

export function useDatabases() {
  return useQuery({
    queryKey: ['databases'],
    queryFn: () => fetchApi<DatabaseInfo[]>('/databases'),
    staleTime: 5 * 60 * 1000,
  })
}
