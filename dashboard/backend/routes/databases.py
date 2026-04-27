from fastapi import APIRouter
from ..database import get_databases
from ..models import DatabaseInfo

router = APIRouter()


@router.get("/databases", response_model=list[DatabaseInfo])
def list_databases():
    return get_databases()
