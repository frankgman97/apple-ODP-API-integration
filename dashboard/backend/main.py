from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import get_databases, ensure_indexes
from .routes import databases, overview, status, patents
from .cache import invalidate_cache


@asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup: create performance indexes for all databases
    for db_info in get_databases():
        ensure_indexes(db_info["name"])
    yield


app = FastAPI(title="Patent Explorer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount route modules
app.include_router(databases.router, prefix="/api/v1")
app.include_router(overview.router, prefix="/api/v1")
app.include_router(status.router, prefix="/api/v1")
app.include_router(patents.router, prefix="/api/v1")


@app.post("/api/v1/cache/invalidate")
def clear_cache(db: str):
    """Clear cached data for a database. Called when user clicks Refresh."""
    invalidate_cache(db)
    return {"status": "ok"}
