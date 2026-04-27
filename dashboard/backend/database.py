import sqlite3
from .config import DATA_DIR


def get_connection(db_name: str) -> sqlite3.Connection:
    """Open a read-only SQLite connection for the given database name."""
    db_path = DATA_DIR / f"{db_name}.db"
    if not db_path.exists():
        raise FileNotFoundError(f"Database not found: {db_path}")
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def query_db(db_name: str, sql: str, params: tuple = ()) -> list[dict]:
    conn = get_connection(db_name)
    try:
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def query_one(db_name: str, sql: str, params: tuple = ()):
    conn = get_connection(db_name)
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def get_databases() -> list[dict]:
    """Scan data/ for .db files, return list with name, label, count, size."""
    dbs = []
    for f in sorted(DATA_DIR.glob("*.db")):
        entry = {"name": f.stem, "sizeBytes": f.stat().st_size}
        try:
            conn = sqlite3.connect(f"file:{f}?mode=ro", uri=True)
            count = conn.execute("SELECT COUNT(*) FROM patents").fetchone()[0]
            conn.close()
            entry["count"] = count
            entry["label"] = f"{f.stem}  ({count:,} patents)"
        except Exception:
            entry["count"] = 0
            entry["label"] = f.stem
        dbs.append(entry)
    return dbs


def ensure_indexes(db_name: str):
    """Create performance indexes if they don't exist. Requires writable connection."""
    db_path = DATA_DIR / f"{db_name}.db"
    if not db_path.exists():
        return
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_patents_app_status ON patents(app_status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_patents_first_applicant ON patents(first_applicant)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_patents_grant_date ON patents(grant_date)")
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()
