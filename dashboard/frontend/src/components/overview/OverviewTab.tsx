import { useOverview } from '../../hooks/useOverview'
import { KpiCard } from '../shared/KpiCard'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { PortfolioOutcome } from './PortfolioOutcome'
import { TopApplicants } from './TopApplicants'
import { AppTypeBreakdown } from './AppTypeBreakdown'

interface Props {
  db: string
}

export function OverviewTab({ db }: Props) {
  const { data, isLoading, error } = useOverview(db)

  if (isLoading) return <LoadingSpinner />
  if (error) return <div className="text-red-400 p-10">Error: {error.message}</div>
  if (!data) return null

  const { kpis, portfolioOutcome, topApplicants, appTypes } = data

  return (
    <div>
      {/* KPI cards */}
      <div className="flex gap-4 flex-wrap mb-6">
        <KpiCard title="Total Patents" value={kpis.total} subtitle={`All applications in ${db}`} />
        <KpiCard title="Unique Applicants" value={kpis.uniqueApplicants} subtitle="Distinct companies/entities that filed" />
        <KpiCard title="Unique Inventors" value={kpis.uniqueInventors} subtitle="Distinct first-named inventors" />
        <KpiCard title="Unique Examiners" value={kpis.uniqueExaminers} subtitle="USPTO examiners assigned to these cases" />
      </div>

      {/* Portfolio Outcome */}
      <div className="mb-6">
        <PortfolioOutcome data={portfolioOutcome} />
      </div>

      {/* Top Applicants + App Type side by side */}
      <div className="flex gap-4 flex-wrap items-start">
        <TopApplicants data={topApplicants} />
        <AppTypeBreakdown data={appTypes} />
      </div>
    </div>
  )
}
