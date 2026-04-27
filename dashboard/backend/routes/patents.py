import csv
import io
import json
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from ..database import query_db, query_one, get_connection
from ..models import PatentsResponse, PatentFilters

router = APIRouter()

# Columns returned from the patents table (excludes raw_json for grid queries)
GRID_COLUMNS = [
    "application_number", "invention_title", "app_type", "app_status",
    "app_status_date", "filing_date", "patent_number", "grant_date",
    "first_applicant", "first_inventor", "examiner", "group_art_unit",
    "cpc_classifications", "docket_number", "pub_number", "pub_date",
    "customer_number",
]

# Allowed sort columns (whitelist to prevent SQL injection)
SORTABLE_COLUMNS = set(GRID_COLUMNS)


def _extract_correspondence(raw_json: str | None) -> str | None:
    """Extract correspondence address from raw_json."""
    if not raw_json:
        return None
    try:
        data = json.loads(raw_json)
        bag = data.get("correspondenceAddressBag", [])
        if not bag:
            return None
        addr = bag[0]
        parts = [
            addr.get("nameLineOneText", ""),
            addr.get("nameLineTwoText", ""),
            addr.get("addressLineOneText", ""),
            ", ".join(filter(None, [
                addr.get("cityName", ""),
                addr.get("geographicRegionCode", ""),
                addr.get("postalCode", ""),
            ])),
            addr.get("countryCode", ""),
        ]
        return " | ".join(p for p in parts if p)
    except (json.JSONDecodeError, KeyError, IndexError):
        return None


def _build_where(
    search: str | None,
    app_type: str | None,
    status: str | None,
    applicant: str | None,
    inventor: str | None,
    examiner: str | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[str, list]:
    """Build a WHERE clause and params from filter values."""
    clauses = []
    params = []

    if search:
        clauses.append("(invention_title LIKE ? OR application_number LIKE ? OR patent_number LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like, like])

    if app_type:
        clauses.append("app_type = ?")
        params.append(app_type)

    if status:
        clauses.append("app_status = ?")
        params.append(status)

    if applicant:
        clauses.append("first_applicant LIKE ?")
        params.append(f"%{applicant}%")

    if inventor:
        clauses.append("first_inventor LIKE ?")
        params.append(f"%{inventor}%")

    if examiner:
        clauses.append("examiner LIKE ?")
        params.append(f"%{examiner}%")

    if date_from:
        clauses.append("filing_date >= ?")
        params.append(date_from)

    if date_to:
        clauses.append("filing_date <= ?")
        params.append(date_to)

    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    return where, params


@router.get("/patents", response_model=PatentsResponse)
def list_patents(
    db: str = Query(...),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    sort: str = Query("filing_date"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    search: str | None = Query(None),
    type: str | None = Query(None),
    status: str | None = Query(None),
    applicant: str | None = Query(None),
    inventor: str | None = Query(None),
    examiner: str | None = Query(None),
    dateFrom: str | None = Query(None),
    dateTo: str | None = Query(None),
):
    where, params = _build_where(search, type, status, applicant, inventor, examiner, dateFrom, dateTo)

    # Validate sort column
    sort_col = sort if sort in SORTABLE_COLUMNS else "filing_date"
    order_dir = "ASC" if order == "asc" else "DESC"

    cols = ", ".join(GRID_COLUMNS)
    total_row = query_one(db, f"SELECT COUNT(*) FROM patents{where}", tuple(params))
    total = total_row[0] if total_row else 0

    rows = query_db(
        db,
        f"SELECT {cols}, raw_json FROM patents{where} ORDER BY {sort_col} {order_dir} LIMIT ? OFFSET ?",
        tuple(params + [limit, offset]),
    )

    # Extract correspondence address from raw_json
    for row in rows:
        row["correspondence_address"] = _extract_correspondence(row.pop("raw_json", None))

    return {"total": total, "rows": rows}


@router.get("/patents/filters", response_model=PatentFilters)
def patent_filters(db: str = Query(...)):
    type_rows = query_db(db, "SELECT DISTINCT app_type FROM patents WHERE app_type IS NOT NULL AND app_type != '' ORDER BY app_type")
    status_rows = query_db(db, "SELECT DISTINCT app_status FROM patents WHERE app_status IS NOT NULL AND app_status != '' ORDER BY app_status")

    return {
        "appTypes": [r["app_type"] for r in type_rows],
        "statuses": [r["app_status"] for r in status_rows],
    }


@router.get("/patents/export/csv")
def export_csv(
    db: str = Query(...),
    search: str | None = Query(None),
    type: str | None = Query(None),
    status: str | None = Query(None),
    applicant: str | None = Query(None),
    inventor: str | None = Query(None),
    examiner: str | None = Query(None),
    dateFrom: str | None = Query(None),
    dateTo: str | None = Query(None),
):
    """Stream filtered patents as CSV."""
    where, params = _build_where(search, type, status, applicant, inventor, examiner, dateFrom, dateTo)
    cols = ", ".join(GRID_COLUMNS)

    def generate():
        conn = get_connection(db)
        try:
            cursor = conn.execute(
                f"SELECT {cols} FROM patents{where} ORDER BY filing_date DESC",
                tuple(params),
            )

            # Header row
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(GRID_COLUMNS)
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

            # Data rows — stream in batches
            while True:
                batch = cursor.fetchmany(500)
                if not batch:
                    break
                for row in batch:
                    writer.writerow([row[col] for col in GRID_COLUMNS])
                yield output.getvalue()
                output.seek(0)
                output.truncate(0)
        finally:
            conn.close()

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={db}_patents.csv"},
    )
