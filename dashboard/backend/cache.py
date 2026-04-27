"""
In-memory caching layer. Uses functools.lru_cache keyed by db_name.
All heavy SQL computation happens here, cached per database.
"""

from functools import lru_cache
from datetime import datetime, timedelta
from collections import Counter

from .database import query_db, query_one
from .classification import (
    classify_status, classify_prosecution_stage,
    PIPELINE_STAGES, PIPELINE_COLORS, SPLIT_STAGES, STAGE_GLOSSARY,
    BUCKET_COLORS,
)


@lru_cache(maxsize=8)
def get_overview_data(db_name: str) -> dict:
    total = query_one(db_name, "SELECT COUNT(*) FROM patents")[0]
    unique_applicants = query_one(db_name, "SELECT COUNT(DISTINCT first_applicant) FROM patents WHERE first_applicant IS NOT NULL AND first_applicant != ''")[0]
    unique_inventors = query_one(db_name, "SELECT COUNT(DISTINCT first_inventor) FROM patents WHERE first_inventor IS NOT NULL AND first_inventor != ''")[0]
    unique_examiners = query_one(db_name, "SELECT COUNT(DISTINCT examiner) FROM patents WHERE examiner IS NOT NULL AND examiner != ''")[0]

    type_rows = query_db(db_name, "SELECT app_type as name, COUNT(*) as cnt FROM patents GROUP BY app_type ORDER BY cnt DESC")
    for r in type_rows:
        r["pct"] = (r["cnt"] / total * 100) if total else 0

    applicant_rows = query_db(db_name, """
        SELECT first_applicant as name, COUNT(*) as cnt
        FROM patents WHERE first_applicant IS NOT NULL AND first_applicant != ''
        GROUP BY first_applicant ORDER BY cnt DESC LIMIT 20
    """)
    for r in applicant_rows:
        r["pct"] = (r["cnt"] / total * 100) if total else 0

    return {
        "total": total,
        "unique_applicants": unique_applicants,
        "unique_inventors": unique_inventors,
        "unique_examiners": unique_examiners,
        "type_rows": type_rows,
        "applicant_rows": applicant_rows,
    }


@lru_cache(maxsize=8)
def build_portfolio_outcome(db_name: str) -> list[dict]:
    rows = query_db(db_name, "SELECT app_status, COUNT(*) as cnt FROM patents GROUP BY app_status ORDER BY cnt DESC")
    total = sum(r["cnt"] for r in rows)

    buckets: dict[str, dict[str, int]] = {}
    for r in rows:
        bucket, sub = classify_status(r["app_status"])
        if bucket not in buckets:
            buckets[bucket] = {}
        buckets[bucket][sub] = buckets[bucket].get(sub, 0) + r["cnt"]

    bucket_order = sorted(buckets.keys(), key=lambda b: sum(buckets[b].values()), reverse=True)

    result = []
    for b in bucket_order:
        subs = buckets[b]
        bucket_total = sum(subs.values())
        sorted_subs = sorted(subs.items(), key=lambda x: x[1], reverse=True)
        result.append({
            "name": b,
            "total": bucket_total,
            "pct": (bucket_total / total * 100) if total else 0,
            "color": BUCKET_COLORS.get(b, "#8b949e"),
            "subs": [{"name": s, "cnt": c, "pct": (c / total * 100) if total else 0} for s, c in sorted_subs],
        })

    return result


@lru_cache(maxsize=8)
def get_pipeline_data(db_name: str) -> dict:
    pending_rows = query_db(db_name, """
        SELECT app_status, COUNT(*) as cnt FROM patents
        WHERE app_status NOT LIKE '%Patented%'
        AND app_status NOT LIKE '%Abandoned%'
        AND app_status NOT LIKE '%Expired%'
        AND app_status NOT LIKE '%Provisional Application Expired%'
        AND app_status NOT LIKE '%RO PROCESSING COMPLETED%'
        AND app_status NOT LIKE '%International Search Report%'
        AND app_status NOT LIKE '%IPER%'
        AND app_status NOT LIKE '%ISA Form%'
        AND app_status NOT LIKE '%Dispatch to TC%'
        AND app_status NOT LIKE '%Formal Demand%'
        AND app_status NOT LIKE '%Withdrawn%'
        AND app_status NOT LIKE '%Reexam%'
        AND app_status NOT LIKE '%reexam%'
        AND app_status NOT LIKE '%Supplemental Exam%'
        AND app_status NOT LIKE '%NonPayment%'
        GROUP BY app_status ORDER BY cnt DESC
    """)

    stage_counts = {s: 0 for s in PIPELINE_STAGES}
    sub_counts: dict[str, dict[str, int]] = {s: {} for s in SPLIT_STAGES}

    for r in pending_rows:
        stage, sub = classify_prosecution_stage(r["app_status"])
        if stage and stage in stage_counts:
            stage_counts[stage] += r["cnt"]
            if stage in sub_counts and sub:
                sub_counts[stage][sub] = sub_counts[stage].get(sub, 0) + r["cnt"]

    total_pending = sum(stage_counts.values())

    stages = []
    for s in PIPELINE_STAGES:
        subs = []
        if s in SPLIT_STAGES:
            for sub_name in SPLIT_STAGES[s]:
                cnt = sub_counts.get(s, {}).get(sub_name, 0)
                if cnt > 0:
                    subs.append({"name": sub_name, "count": cnt})
        stages.append({
            "name": s,
            "count": stage_counts[s],
            "color": PIPELINE_COLORS[s],
            "subs": subs,
        })

    glossary = [
        {"name": name, "description": desc, "color": PIPELINE_COLORS[name]}
        for name, desc in STAGE_GLOSSARY
        if stage_counts.get(name, 0) > 0
    ]

    return {"totalPending": total_pending, "stages": stages, "glossary": glossary}


@lru_cache(maxsize=8)
def get_grants_data(db_name: str) -> dict:
    granted = query_one(db_name, "SELECT COUNT(*) FROM patents WHERE app_status = 'Patented Case'")[0]
    total_utility = query_one(db_name, "SELECT COUNT(*) FROM patents WHERE app_type = 'Utility'")[0]
    granted_utility = query_one(db_name, "SELECT COUNT(*) FROM patents WHERE app_status = 'Patented Case' AND app_type = 'Utility'")[0]
    grant_rate = (granted_utility / total_utility * 100) if total_utility else 0

    ttg_rows = query_db(db_name, """
        SELECT filing_date, grant_date FROM patents
        WHERE grant_date IS NOT NULL AND filing_date IS NOT NULL
        AND grant_date != '' AND filing_date != ''
    """)

    ttg_months_list: list[int] = []
    for r in ttg_rows:
        try:
            fd = datetime.strptime(r["filing_date"][:10], "%Y-%m-%d")
            gd = datetime.strptime(r["grant_date"][:10], "%Y-%m-%d")
            months = (gd - fd).days / 30.44
            if 0 < months < 200:
                ttg_months_list.append(round(months))
        except (ValueError, TypeError):
            pass

    avg_ttg = sum(ttg_months_list) / len(ttg_months_list) if ttg_months_list else 0

    # Bin into 6-month buckets for histogram
    ttg_counter = Counter(ttg_months_list)
    ttg_distribution = [{"months": m, "count": c} for m, c in sorted(ttg_counter.items())]

    grant_by_year = query_db(db_name, """
        SELECT SUBSTR(filing_date, 1, 4) as yr,
               COUNT(*) as filed,
               SUM(CASE WHEN app_status = 'Patented Case' THEN 1 ELSE 0 END) as granted
        FROM patents WHERE app_type = 'Utility' AND filing_date IS NOT NULL AND filing_date != ''
        GROUP BY yr HAVING filed >= 5 ORDER BY yr
    """)

    grant_rate_by_year = [
        {"year": r["yr"], "filed": r["filed"], "granted": r["granted"],
         "rate": (r["granted"] / r["filed"] * 100) if r["filed"] else 0}
        for r in grant_by_year
    ]

    return {
        "granted": granted,
        "totalUtility": total_utility,
        "grantedUtility": granted_utility,
        "grantRate": round(grant_rate, 1),
        "avgTimeToGrant": round(avg_ttg, 1),
        "ttgDistribution": ttg_distribution,
        "grantRateByYear": grant_rate_by_year,
    }


@lru_cache(maxsize=8)
def get_maintenance_data(db_name: str) -> dict:
    expired_maint = query_one(db_name, "SELECT COUNT(*) FROM patents WHERE app_status LIKE '%NonPayment of Maintenance%'")[0]

    maint_rows = query_db(db_name, """
        SELECT patent_number, grant_date FROM patents
        WHERE app_status = 'Patented Case' AND grant_date IS NOT NULL AND grant_date != ''
        AND patent_number IS NOT NULL AND patent_number != ''
    """)

    now = datetime.now()
    fees_due_now = 0
    fees_upcoming = 0
    fees_by_year: dict[str, int] = {}
    next_fees: list[tuple] = []

    fee_windows = [(3.5, "1st (3.5 yr)"), (7.5, "2nd (7.5 yr)"), (11.5, "3rd (11.5 yr)")]

    for r in maint_rows:
        try:
            gd = datetime.strptime(r["grant_date"][:10], "%Y-%m-%d")
        except (ValueError, TypeError):
            continue
        for years, label in fee_windows:
            due = gd + timedelta(days=years * 365.25)
            window_open = due - timedelta(days=182)
            window_close = due + timedelta(days=182)

            if window_open <= now <= window_close:
                fees_due_now += 1
                next_fees.append((r["patent_number"], label, due.strftime("%Y-%m-%d"), "DUE NOW"))
            elif now < window_open and (window_open - now).days <= 365:
                fees_upcoming += 1
                yr = str(due.year)
                fees_by_year[yr] = fees_by_year.get(yr, 0) + 1
                next_fees.append((r["patent_number"], label, due.strftime("%Y-%m-%d"), "UPCOMING"))

    next_fees.sort(key=lambda x: x[2])
    next_fees = next_fees[:20]

    return {
        "activeGranted": len(maint_rows),
        "feesDueNow": fees_due_now,
        "feesUpcoming": fees_upcoming,
        "expiredNonPayment": expired_maint,
        "feesByYear": [{"year": y, "count": c} for y, c in sorted(fees_by_year.items())],
        "nextFees": [
            {"patentNumber": f[0], "fee": f[1], "dueDate": f[2], "status": f[3]}
            for f in next_fees
        ],
    }


@lru_cache(maxsize=8)
def get_trends_data(db_name: str) -> dict:
    trend_rows = query_db(db_name, """
        SELECT SUBSTR(filing_date, 1, 4) as yr, app_type, COUNT(*) as cnt
        FROM patents WHERE filing_date IS NOT NULL AND filing_date != ''
        GROUP BY yr, app_type ORDER BY yr
    """)

    years_set = sorted(set(r["yr"] for r in trend_rows))
    trend_by_type: dict[str, dict[str, int]] = {}
    for r in trend_rows:
        t = r["app_type"]
        if t not in trend_by_type:
            trend_by_type[t] = {}
        trend_by_type[t][r["yr"]] = r["cnt"]

    # Ordered types: known types first, then any others
    known_types = ["Utility", "PCT", "Provisional", "Design"]
    all_types = known_types + [t for t in trend_by_type if t not in known_types]

    series = []
    for t in all_types:
        if t in trend_by_type:
            data = [trend_by_type[t].get(y, 0) for y in years_set]
            series.append({"type": t, "data": data})

    return {"years": years_set, "series": series}


def invalidate_cache(db_name: str):
    """Clear all caches. Called when user requests a refresh."""
    get_overview_data.cache_clear()
    build_portfolio_outcome.cache_clear()
    get_pipeline_data.cache_clear()
    get_grants_data.cache_clear()
    get_maintenance_data.cache_clear()
    get_trends_data.cache_clear()
