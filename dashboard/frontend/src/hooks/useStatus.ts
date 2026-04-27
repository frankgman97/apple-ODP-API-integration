import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/api'
import type { PipelineResponse, GrantsResponse, MaintenanceResponse, TrendsResponse } from '../types/api'

export function usePipeline(db: string) {
  return useQuery({
    queryKey: ['pipeline', db],
    queryFn: () => fetchApi<PipelineResponse>('/status/pipeline', { db }),
    staleTime: 5 * 60 * 1000,
    enabled: !!db,
  })
}

export function useGrants(db: string) {
  return useQuery({
    queryKey: ['grants', db],
    queryFn: () => fetchApi<GrantsResponse>('/status/grants', { db }),
    staleTime: 5 * 60 * 1000,
    enabled: !!db,
  })
}

export function useMaintenance(db: string) {
  return useQuery({
    queryKey: ['maintenance', db],
    queryFn: () => fetchApi<MaintenanceResponse>('/status/maintenance', { db }),
    staleTime: 5 * 60 * 1000,
    enabled: !!db,
  })
}

export function useTrends(db: string) {
  return useQuery({
    queryKey: ['trends', db],
    queryFn: () => fetchApi<TrendsResponse>('/status/trends', { db }),
    staleTime: 5 * 60 * 1000,
    enabled: !!db,
  })
}
