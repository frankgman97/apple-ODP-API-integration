export interface DatabaseInfo {
  name: string
  label: string
  count: number
  sizeBytes: number
}

export interface KPIs {
  total: number
  uniqueApplicants: number
  uniqueInventors: number
  uniqueExaminers: number
}

export interface SubCategory {
  name: string
  cnt: number
  pct: number
}

export interface PortfolioBucket {
  name: string
  total: number
  pct: number
  color: string
  subs: SubCategory[]
}

export interface CountRow {
  name: string | null
  cnt: number
  pct: number
}

export interface OverviewResponse {
  kpis: KPIs
  portfolioOutcome: PortfolioBucket[]
  topApplicants: CountRow[]
  appTypes: CountRow[]
}

export interface StageSub {
  name: string
  count: number
}

export interface PipelineStage {
  name: string
  count: number
  color: string
  subs: StageSub[]
}

export interface GlossaryEntry {
  name: string
  description: string
  color: string
}

export interface PipelineResponse {
  totalPending: number
  stages: PipelineStage[]
  glossary: GlossaryEntry[]
}

export interface TTGBucket {
  months: number
  count: number
}

export interface GrantYearRow {
  year: string
  filed: number
  granted: number
  rate: number
}

export interface GrantsResponse {
  granted: number
  totalUtility: number
  grantedUtility: number
  grantRate: number
  avgTimeToGrant: number
  ttgDistribution: TTGBucket[]
  grantRateByYear: GrantYearRow[]
}

export interface FeeYearRow {
  year: string
  count: number
}

export interface NextFee {
  patentNumber: string
  fee: string
  dueDate: string
  status: string
}

export interface MaintenanceResponse {
  activeGranted: number
  feesDueNow: number
  feesUpcoming: number
  expiredNonPayment: number
  feesByYear: FeeYearRow[]
  nextFees: NextFee[]
}

export interface TrendSeries {
  type: string
  data: number[]
}

export interface TrendsResponse {
  years: string[]
  series: TrendSeries[]
}

export interface PatentsResponse {
  total: number
  rows: Record<string, unknown>[]
}

export interface PatentFilters {
  appTypes: string[]
  statuses: string[]
}
