import { usePipeline, useGrants, useMaintenance, useTrends } from '../../hooks/useStatus'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { ProsecutionPipeline } from './ProsecutionPipeline'
import { GrantAnalysis } from './GrantAnalysis'
import { MaintenanceFees } from './MaintenanceFees'
import { FilingTrends } from './FilingTrends'

interface Props {
  db: string
}

export function StatusTab({ db }: Props) {
  const pipeline = usePipeline(db)
  const grants = useGrants(db)
  const maintenance = useMaintenance(db)
  const trends = useTrends(db)

  // Show spinner only if pipeline (the first section) is still loading
  if (pipeline.isLoading) return <LoadingSpinner />

  return (
    <div>
      {pipeline.data && <ProsecutionPipeline data={pipeline.data} />}
      {grants.isLoading ? <LoadingSpinner /> : grants.data && <GrantAnalysis data={grants.data} />}
      {maintenance.isLoading ? <LoadingSpinner /> : maintenance.data && <MaintenanceFees data={maintenance.data} />}
      {trends.isLoading ? <LoadingSpinner /> : trends.data && <FilingTrends data={trends.data} />}
    </div>
  )
}
