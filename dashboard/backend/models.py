from pydantic import BaseModel


# ─── Database listing ─────────────────────────────────────

class DatabaseInfo(BaseModel):
    name: str
    label: str
    count: int
    sizeBytes: int


# ─── Overview ─────────────────────────────────────────────

class KPIs(BaseModel):
    total: int
    uniqueApplicants: int
    uniqueInventors: int
    uniqueExaminers: int


class SubCategory(BaseModel):
    name: str
    cnt: int
    pct: float


class PortfolioBucket(BaseModel):
    name: str
    total: int
    pct: float
    color: str
    subs: list[SubCategory]


class CountRow(BaseModel):
    name: str | None
    cnt: int
    pct: float


class OverviewResponse(BaseModel):
    kpis: KPIs
    portfolioOutcome: list[PortfolioBucket]
    topApplicants: list[CountRow]
    appTypes: list[CountRow]


# ─── Status: Pipeline ─────────────────────────────────────

class StageSub(BaseModel):
    name: str
    count: int


class PipelineStage(BaseModel):
    name: str
    count: int
    color: str
    subs: list[StageSub]


class GlossaryEntry(BaseModel):
    name: str
    description: str
    color: str


class PipelineResponse(BaseModel):
    totalPending: int
    stages: list[PipelineStage]
    glossary: list[GlossaryEntry]


# ─── Status: Grants ───────────────────────────────────────

class TTGBucket(BaseModel):
    months: int
    count: int


class GrantYearRow(BaseModel):
    year: str
    filed: int
    granted: int
    rate: float


class GrantsResponse(BaseModel):
    granted: int
    totalUtility: int
    grantedUtility: int
    grantRate: float
    avgTimeToGrant: float
    ttgDistribution: list[TTGBucket]
    grantRateByYear: list[GrantYearRow]


# ─── Status: Maintenance ──────────────────────────────────

class FeeYearRow(BaseModel):
    year: str
    count: int


class NextFee(BaseModel):
    patentNumber: str
    fee: str
    dueDate: str
    status: str


class MaintenanceResponse(BaseModel):
    activeGranted: int
    feesDueNow: int
    feesUpcoming: int
    expiredNonPayment: int
    feesByYear: list[FeeYearRow]
    nextFees: list[NextFee]


# ─── Status: Trends ───────────────────────────────────────

class TrendSeries(BaseModel):
    type: str
    data: list[int]


class TrendsResponse(BaseModel):
    years: list[str]
    series: list[TrendSeries]


# ─── Patents ──────────────────────────────────────────────

class PatentsResponse(BaseModel):
    total: int
    rows: list[dict]


class PatentFilters(BaseModel):
    appTypes: list[str]
    statuses: list[str]
