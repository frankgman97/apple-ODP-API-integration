from fastapi import APIRouter, Query
from ..cache import get_overview_data, build_portfolio_outcome
from ..models import OverviewResponse

router = APIRouter()


@router.get("/overview", response_model=OverviewResponse)
def overview(db: str = Query(..., description="Database name without .db extension")):
    data = get_overview_data(db)
    portfolio = build_portfolio_outcome(db)

    return {
        "kpis": {
            "total": data["total"],
            "uniqueApplicants": data["unique_applicants"],
            "uniqueInventors": data["unique_inventors"],
            "uniqueExaminers": data["unique_examiners"],
        },
        "portfolioOutcome": portfolio,
        "topApplicants": data["applicant_rows"],
        "appTypes": data["type_rows"],
    }
