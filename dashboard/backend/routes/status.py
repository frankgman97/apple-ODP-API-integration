from fastapi import APIRouter, Query
from ..cache import get_pipeline_data, get_grants_data, get_maintenance_data, get_trends_data
from ..models import PipelineResponse, GrantsResponse, MaintenanceResponse, TrendsResponse

router = APIRouter()


@router.get("/status/pipeline", response_model=PipelineResponse)
def pipeline(db: str = Query(..., description="Database name without .db extension")):
    return get_pipeline_data(db)


@router.get("/status/grants", response_model=GrantsResponse)
def grants(db: str = Query(..., description="Database name without .db extension")):
    return get_grants_data(db)


@router.get("/status/maintenance", response_model=MaintenanceResponse)
def maintenance(db: str = Query(..., description="Database name without .db extension")):
    return get_maintenance_data(db)


@router.get("/status/trends", response_model=TrendsResponse)
def trends(db: str = Query(..., description="Database name without .db extension")):
    return get_trends_data(db)
