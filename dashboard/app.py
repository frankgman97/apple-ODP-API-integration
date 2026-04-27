"""
Patent Dashboard — Dash app for browsing USPTO patent SQLite databases.
Run: source venv/bin/activate && python app.py
"""

import sqlite3
import os
from pathlib import Path
from functools import lru_cache
from datetime import datetime, timedelta

import dash
from dash import html, dcc, dash_table, Input, Output, State, callback
import plotly.graph_objects as go

# ─── Config ──────────────────────────────────────────────
DATA_DIR = Path(__file__).parent.parent / "data"

def get_databases():
    """Scan data/ for .db files, return list of {label, value} for dropdown."""
    dbs = []
    for f in sorted(DATA_DIR.glob("*.db")):
        try:
            conn = sqlite3.connect(f"file:{f}?mode=ro", uri=True)
            count = conn.execute("SELECT COUNT(*) FROM patents").fetchone()[0]
            conn.close()
            dbs.append({"label": f"{f.stem}  ({count:,} patents)", "value": str(f)})
        except Exception:
            dbs.append({"label": f.stem, "value": str(f)})
    return dbs


def query_db(db_path, sql, params=()):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def query_one(db_path, sql, params=()):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    result = conn.execute(sql, params).fetchone()
    conn.close()
    return result


# ─── Cached Data Layer ──────────────────────────────────
# All heavy computation goes here. Cached per db_path so tab
# switches are instant after first load.

@lru_cache(maxsize=8)
def get_overview_data(db_path):
    """Cache all overview computations."""
    total = query_one(db_path, "SELECT COUNT(*) FROM patents")[0]
    unique_applicants = query_one(db_path, "SELECT COUNT(DISTINCT first_applicant) FROM patents WHERE first_applicant IS NOT NULL AND first_applicant != ''")[0]
    unique_inventors = query_one(db_path, "SELECT COUNT(DISTINCT first_inventor) FROM patents WHERE first_inventor IS NOT NULL AND first_inventor != ''")[0]
    unique_examiners = query_one(db_path, "SELECT COUNT(DISTINCT examiner) FROM patents WHERE examiner IS NOT NULL AND examiner != ''")[0]

    type_rows = query_db(db_path, "SELECT app_type as name, COUNT(*) as cnt FROM patents GROUP BY app_type ORDER BY cnt DESC")
    for r in type_rows:
        r["pct"] = (r["cnt"] / total * 100) if total else 0

    applicant_rows = query_db(db_path, """
        SELECT first_applicant as name, COUNT(*) as cnt
        FROM patents WHERE first_applicant IS NOT NULL AND first_applicant != ''
        GROUP BY first_applicant ORDER BY cnt DESC LIMIT 20
    """)
    for r in applicant_rows:
        r["pct"] = (r["cnt"] / total * 100) if total else 0

    return {
        "total": total, "unique_applicants": unique_applicants,
        "unique_inventors": unique_inventors, "unique_examiners": unique_examiners,
        "type_rows": type_rows, "applicant_rows": applicant_rows,
    }


@lru_cache(maxsize=8)
def get_status_data(db_path):
    """Cache all status tab computations (the expensive ones)."""
    total = query_one(db_path, "SELECT COUNT(*) FROM patents")[0]

    # Prosecution pipeline
    pending_rows = query_db(db_path, """
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

    stage_order = PIPELINE_STAGES
    stage_counts = {s: 0 for s in stage_order}
    # sub_counts: {stage: {sub_segment: count}} for split stages
    sub_counts = {s: {} for s in SPLIT_STAGES}
    for r in pending_rows:
        stage, sub = classify_prosecution_stage(r["app_status"])
        if stage and stage in stage_counts:
            stage_counts[stage] += r["cnt"]
            if stage in sub_counts and sub:
                sub_counts[stage][sub] = sub_counts[stage].get(sub, 0) + r["cnt"]

    # Grant analysis
    granted = query_one(db_path, "SELECT COUNT(*) FROM patents WHERE app_status = 'Patented Case'")[0]
    total_utility = query_one(db_path, "SELECT COUNT(*) FROM patents WHERE app_type = 'Utility'")[0]
    granted_utility = query_one(db_path, "SELECT COUNT(*) FROM patents WHERE app_status = 'Patented Case' AND app_type = 'Utility'")[0]
    grant_rate = (granted_utility / total_utility * 100) if total_utility else 0

    # Time to grant
    ttg_rows = query_db(db_path, """
        SELECT filing_date, grant_date FROM patents
        WHERE grant_date IS NOT NULL AND filing_date IS NOT NULL
        AND grant_date != '' AND filing_date != ''
    """)
    ttg_months = []
    for r in ttg_rows:
        try:
            fd = datetime.strptime(r["filing_date"][:10], "%Y-%m-%d")
            gd = datetime.strptime(r["grant_date"][:10], "%Y-%m-%d")
            months = (gd - fd).days / 30.44
            if 0 < months < 200:
                ttg_months.append(round(months))
        except (ValueError, TypeError):
            pass
    avg_ttg = sum(ttg_months) / len(ttg_months) if ttg_months else 0

    # Grant rate by year
    grant_by_year = query_db(db_path, """
        SELECT SUBSTR(filing_date, 1, 4) as yr,
               COUNT(*) as filed,
               SUM(CASE WHEN app_status = 'Patented Case' THEN 1 ELSE 0 END) as granted
        FROM patents WHERE app_type = 'Utility' AND filing_date IS NOT NULL AND filing_date != ''
        GROUP BY yr HAVING filed >= 5 ORDER BY yr
    """)

    # Maintenance fees — computed via SQL aggregation instead of Python loop
    expired_maint = query_one(db_path, "SELECT COUNT(*) FROM patents WHERE app_status LIKE '%NonPayment of Maintenance%'")[0]

    maint_rows = query_db(db_path, """
        SELECT patent_number, grant_date FROM patents
        WHERE app_status = 'Patented Case' AND grant_date IS NOT NULL AND grant_date != ''
        AND patent_number IS NOT NULL AND patent_number != ''
    """)

    now = datetime.now()
    fees_due_now = 0
    fees_upcoming = 0
    fees_by_year = {}
    next_fees = []

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

    # Filing trends
    trend_rows = query_db(db_path, """
        SELECT SUBSTR(filing_date, 1, 4) as yr, app_type, COUNT(*) as cnt
        FROM patents WHERE filing_date IS NOT NULL AND filing_date != ''
        GROUP BY yr, app_type ORDER BY yr
    """)

    return {
        "total": total, "stage_counts": stage_counts, "sub_counts": sub_counts, "stage_order": stage_order,
        "granted": granted, "total_utility": total_utility, "granted_utility": granted_utility,
        "grant_rate": grant_rate, "ttg_months": ttg_months, "avg_ttg": avg_ttg,
        "grant_by_year": grant_by_year, "expired_maint": expired_maint,
        "maint_count": len(maint_rows), "fees_due_now": fees_due_now,
        "fees_upcoming": fees_upcoming, "fees_by_year": fees_by_year,
        "next_fees": next_fees, "trend_rows": trend_rows,
    }


# ─── Status Grouping ────────────────────────────────────
def classify_status(status):
    """Map a raw app_status string to (bucket, sub_category)."""
    if not status:
        return ("Unknown", "No status recorded")
    s = status.strip()

    # Granted
    if s == "Patented Case":
        return ("Granted", "Active patents")
    if "Expired Due to NonPayment" in s or "Maintenance Fees" in s:
        return ("Granted", "Expired — maintenance fees not paid")

    # Abandoned
    if "Failure to Respond" in s:
        return ("Abandoned", "Failed to respond to office action")
    if "Failure to Pay Issue Fee" in s:
        return ("Abandoned", "Failed to pay issue fee")
    if "Expressly Abandoned" in s:
        return ("Abandoned", "Expressly abandoned")
    if "After Examiner" in s or "After Board" in s or "after BPAI" in s:
        return ("Abandoned", "After appeal/board decision")
    if "Incomplete" in s and "Abandon" in s:
        return ("Abandoned", "Incomplete application")
    if "Abandoned" in s:
        return ("Abandoned", "Other abandonment")

    # Provisional
    if "Provisional Application Expired" in s:
        return ("Provisional", "Expired")

    # PCT
    if "RO PROCESSING COMPLETED" in s:
        return ("PCT", "Completed — in storage")
    if "International Search Report" in s or "ISA Form 203" in s:
        return ("PCT", "Search report mailed")
    if "IPER" in s or "International Preliminary" in s:
        return ("PCT", "Preliminary examination report mailed")
    if "Dispatch to TC" in s or "Formal Demand" in s:
        return ("PCT", "Active — processing")
    if "International Application Withdrawn" in s or "Demand Withdrawn" in s:
        return ("PCT", "Withdrawn")
    if s.startswith("PCT"):
        return ("PCT", "Other PCT")

    # Pending — Allowed / near issuance
    if "Notice of Allowance" in s or "Allowed" in s:
        return ("Pending", "Allowed — awaiting issue fee")
    if "Issue Fee Payment" in s:
        return ("Pending", "Issue fee paid — awaiting publication")
    if "Awaiting TC" in s:
        return ("Pending", "Awaiting issue processing")

    # Pending — Examination
    if "Docketed" in s or "Ready for Examination" in s:
        return ("Pending", "Docketed — ready for examination")
    if "Non Final Action" in s or "Non-Final Action" in s or "non-final action" in s:
        return ("Pending", "Non-final office action")
    if "Response to Non-Final" in s or "Response after Non-Final" in s or "response after nonfinal" in s:
        return ("Pending", "Response to non-final action")
    if "Final Rejection" in s:
        return ("Pending", "Final rejection")
    if "Response after Final" in s or "after action closing" in s:
        return ("Pending", "Response after final rejection")
    if "Advisory Action" in s:
        return ("Pending", "Advisory action")
    if "Ex parte Quayle" in s:
        return ("Pending", "Ex parte Quayle action")
    if "Preexam" in s or "preexam" in s or "INFORMALITY" in s:
        return ("Pending", "Pre-examination processing")
    if "Classification" in s:
        return ("Pending", "Classification")

    # Pending — Appeal
    if "Appeal" in s or "appeal" in s:
        return ("Pending", "On appeal")
    if "Board of Appeals" in s:
        return ("Pending", "On appeal")

    # Pending — Other
    if "Prosecution Suspended" in s:
        return ("Pending", "Prosecution suspended")
    if "Withdraw from issue" in s:
        return ("Pending", "Withdrawn from issue")
    if "Court Proceedings" in s:
        return ("Pending", "Court proceedings")

    # Reexamination
    if "Reexam" in s or "reexam" in s or "Supplemental Exam" in s:
        return ("Reexamination", "Reexamination/supplemental")

    return ("Other", s)


@lru_cache(maxsize=8)
def build_portfolio_outcome(db_path):
    """Query all statuses and group into buckets with sub-breakdowns."""
    rows = query_db(db_path, "SELECT app_status, COUNT(*) as cnt FROM patents GROUP BY app_status ORDER BY cnt DESC")
    total = sum(r["cnt"] for r in rows)

    buckets = {}  # {bucket_name: {sub_name: count}}
    for r in rows:
        bucket, sub = classify_status(r["app_status"])
        if bucket not in buckets:
            buckets[bucket] = {}
        buckets[bucket][sub] = buckets[bucket].get(sub, 0) + r["cnt"]

    # Order buckets by total size
    bucket_order = sorted(buckets.keys(), key=lambda b: sum(buckets[b].values()), reverse=True)

    result = []
    for b in bucket_order:
        subs = buckets[b]
        bucket_total = sum(subs.values())
        # Sort sub-categories by count
        sorted_subs = sorted(subs.items(), key=lambda x: x[1], reverse=True)
        result.append({
            "name": b,
            "total": bucket_total,
            "pct": (bucket_total / total * 100) if total else 0,
            "subs": [{"name": s, "cnt": c, "pct": (c / total * 100) if total else 0} for s, c in sorted_subs],
        })

    return result, total


# ─── Colors ──────────────────────────────────────────────
BG = "#0d1117"
CARD_BG = "#161b22"
BORDER = "#30363d"
TEXT = "#c9d1d9"
TEXT_DIM = "#8b949e"
ACCENT = "#58a6ff"

BUCKET_COLORS = {
    "Granted": "#3fb950",
    "Abandoned": "#f85149",
    "Provisional": "#d29922",
    "PCT": "#a371f7",
    "Pending": "#58a6ff",
    "Reexamination": "#79c0ff",
    "Other": "#8b949e",
    "Unknown": "#6e7681",
}

TAB_STYLE = {"backgroundColor": BG, "color": TEXT_DIM, "border": "none", "padding": "12px 20px"}
TAB_SELECTED = {"backgroundColor": BG, "color": TEXT, "borderBottom": f"2px solid {ACCENT}", "padding": "12px 20px"}
MINI_TAB = {"backgroundColor": "transparent", "color": TEXT_DIM, "border": "none", "padding": "4px 12px",
            "cursor": "pointer", "fontSize": "12px", "borderRadius": "4px"}
MINI_TAB_ACTIVE = {**MINI_TAB, "backgroundColor": BORDER, "color": TEXT}


# ─── App ─────────────────────────────────────────────────
app = dash.Dash(__name__, suppress_callback_exceptions=True)

app.layout = html.Div(
    style={"backgroundColor": BG, "minHeight": "100vh", "color": TEXT, "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"},
    children=[
        # ── Header ──
        html.Div(
            style={"padding": "20px 32px", "borderBottom": f"1px solid {BORDER}", "display": "flex", "alignItems": "center", "gap": "24px"},
            children=[
                html.H1("Patent Explorer", style={"margin": 0, "fontSize": "20px", "fontWeight": 600}),
                dcc.Dropdown(
                    id="db-selector",
                    options=get_databases(),
                    value=str(DATA_DIR / "foley-lardner.db"),
                    clearable=False,
                    style={"width": "360px", "backgroundColor": CARD_BG, "color": TEXT},
                ),
            ],
        ),

        # ── Tabs ──
        dcc.Tabs(
            id="main-tabs",
            value="overview",
            style={"padding": "0 32px", "borderBottom": f"1px solid {BORDER}"},
            children=[
                dcc.Tab(label="Overview", value="overview", style=TAB_STYLE, selected_style=TAB_SELECTED),
                dcc.Tab(label="Status", value="status", style=TAB_STYLE, selected_style=TAB_SELECTED),
                dcc.Tab(label="Patents", value="patents", style=TAB_STYLE, selected_style=TAB_SELECTED),
            ],
        ),

        # ── Content ──
        dcc.Loading(
            id="loading",
            type="circle",
            color=ACCENT,
            children=html.Div(id="tab-content", style={"padding": "24px 32px"}),
        ),
    ],
)


# ─── Helpers ─────────────────────────────────────────────
def make_card(title, value, subtitle=None):
    return html.Div(
        style={"backgroundColor": CARD_BG, "border": f"1px solid {BORDER}", "borderRadius": "8px", "padding": "20px", "flex": "1", "minWidth": "180px"},
        children=[
            html.Div(title, style={"fontSize": "13px", "color": TEXT_DIM, "marginBottom": "8px", "textTransform": "uppercase", "letterSpacing": "0.5px"}),
            html.Div(f"{value:,}" if isinstance(value, int) else value, style={"fontSize": "28px", "fontWeight": 600, "color": TEXT}),
            html.Div(subtitle, style={"fontSize": "12px", "color": TEXT_DIM, "marginTop": "4px"}) if subtitle else None,
        ],
    )


def make_count_table_rows(rows, col_label="Category"):
    """Just the HTML table element (no card wrapper)."""
    return html.Table(
        style={"width": "100%", "borderCollapse": "collapse"},
        children=[
            html.Thead(html.Tr([
                html.Th(col_label, style={"textAlign": "left", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "color": TEXT_DIM, "fontSize": "12px"}),
                html.Th("Count", style={"textAlign": "right", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "color": TEXT_DIM, "fontSize": "12px"}),
                html.Th("%", style={"textAlign": "right", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "color": TEXT_DIM, "fontSize": "12px"}),
            ])),
            html.Tbody([
                html.Tr([
                    html.Td(r["name"] or "(blank)", style={"padding": "6px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "13px"}),
                    html.Td(f"{r['cnt']:,}", style={"textAlign": "right", "padding": "6px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "13px"}),
                    html.Td(f"{r['pct']:.1f}%", style={"textAlign": "right", "padding": "6px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "13px", "color": TEXT_DIM}),
                ]) for r in rows
            ]),
        ],
    )


def make_pie_chart(rows, label_key="name"):
    """Plotly pie/donut chart from rows with name/cnt keys."""
    labels = [r[label_key] or "(blank)" for r in rows]
    values = [r["cnt"] for r in rows]
    fig = go.Figure(go.Pie(
        labels=labels, values=values, hole=0.45,
        textinfo="label+percent", textposition="outside",
        textfont=dict(size=11, color=TEXT),
        marker=dict(line=dict(color=BG, width=2)),
        outsidetextfont=dict(size=10),
    ))
    fig.update_layout(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=TEXT), margin=dict(t=10, b=10, l=10, r=10),
        showlegend=False, height=350,
    )
    return dcc.Graph(figure=fig, config={"displayModeBar": False})


def make_horizontal_bar(rows, label_key="name", color=ACCENT):
    """Plotly horizontal bar chart from rows."""
    # Reverse so largest is on top
    labels = [r[label_key] or "(blank)" for r in reversed(rows)]
    values = [r["cnt"] for r in reversed(rows)]
    fig = go.Figure(go.Bar(
        x=values, y=labels, orientation="h",
        marker_color=color, text=[f"{v:,}" for v in values],
        textposition="outside", textfont=dict(size=11, color=TEXT),
    ))
    fig.update_layout(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=TEXT), margin=dict(t=10, b=10, l=10, r=140),
        xaxis=dict(showgrid=False, showticklabels=False, zeroline=False),
        yaxis=dict(showgrid=False, tickfont=dict(size=11)),
        height=max(300, len(rows) * 28),
    )
    return dcc.Graph(figure=fig, config={"displayModeBar": False})


def make_toggleable_card(card_id, title, table_content, chart_content):
    """A card with Table | Chart mini-tabs."""
    return html.Div(
        style={"backgroundColor": CARD_BG, "border": f"1px solid {BORDER}", "borderRadius": "8px", "padding": "20px", "flex": "1", "minWidth": "300px"},
        children=[
            # Header row with title and toggle
            html.Div(
                style={"display": "flex", "justifyContent": "space-between", "alignItems": "center", "marginBottom": "16px"},
                children=[
                    html.H3(title, style={"margin": 0, "fontSize": "15px", "fontWeight": 600}),
                    html.Div(
                        style={"display": "flex", "gap": "4px", "backgroundColor": BG, "borderRadius": "6px", "padding": "2px"},
                        children=[
                            html.Button("Table", id=f"{card_id}-btn-table",
                                        style=MINI_TAB_ACTIVE, n_clicks=0),
                            html.Button("Chart", id=f"{card_id}-btn-chart",
                                        style=MINI_TAB, n_clicks=0),
                        ],
                    ),
                ],
            ),
            # Content areas
            html.Div(id=f"{card_id}-table", children=table_content),
            html.Div(id=f"{card_id}-chart", children=chart_content, style={"display": "none"}),
        ],
    )


def register_toggle_callback(card_id):
    """Register a callback for a toggleable card's Table/Chart buttons."""
    @callback(
        Output(f"{card_id}-table", "style"),
        Output(f"{card_id}-chart", "style"),
        Output(f"{card_id}-btn-table", "style"),
        Output(f"{card_id}-btn-chart", "style"),
        Input(f"{card_id}-btn-table", "n_clicks"),
        Input(f"{card_id}-btn-chart", "n_clicks"),
        prevent_initial_call=True,
    )
    def toggle(table_clicks, chart_clicks):
        ctx = dash.callback_context
        if not ctx.triggered:
            return {}, {"display": "none"}, MINI_TAB_ACTIVE, MINI_TAB
        trigger = ctx.triggered[0]["prop_id"]
        if "btn-chart" in trigger:
            return {"display": "none"}, {}, MINI_TAB, MINI_TAB_ACTIVE
        return {}, {"display": "none"}, MINI_TAB_ACTIVE, MINI_TAB


# Register toggles for our 3 cards
for cid in ["portfolio", "applicants", "app-type"]:
    register_toggle_callback(cid)


# ─── Tab Rendering Callback ─────────────────────────────
@callback(
    Output("tab-content", "children"),
    Input("main-tabs", "value"),
    Input("db-selector", "value"),
)
def render_tab(tab, db_path):
    if not db_path or not os.path.exists(db_path):
        return html.Div("Select a database", style={"color": TEXT_DIM, "padding": "40px"})

    if tab == "overview":
        return render_overview(db_path)
    elif tab == "status":
        return render_status_tab(db_path)
    elif tab == "patents":
        return render_patents_table(db_path)
    return html.Div()


# ─── Overview Tab ────────────────────────────────────────
def render_overview(db_path):
    data = get_overview_data(db_path)
    total = data["total"]
    unique_applicants = data["unique_applicants"]
    unique_inventors = data["unique_inventors"]
    unique_examiners = data["unique_examiners"]
    type_rows = data["type_rows"]
    applicant_rows = data["applicant_rows"]

    # Portfolio outcome (also cached)
    portfolio, _ = build_portfolio_outcome(db_path)

    db_name = Path(db_path).stem

    # ── Portfolio outcome table ──
    portfolio_table_rows = []
    for b in portfolio:
        # Bucket header row
        color = BUCKET_COLORS.get(b["name"], TEXT_DIM)
        portfolio_table_rows.append(
            html.Tr(style={"backgroundColor": "#1c2128"}, children=[
                html.Td(
                    html.Span([
                        html.Span("\u25CF ", style={"color": color, "fontSize": "16px"}),
                        html.Strong(b["name"]),
                    ]),
                    style={"padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "13px"},
                ),
                html.Td(f"{b['total']:,}", style={"textAlign": "right", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "13px", "fontWeight": 600}),
                html.Td(f"{b['pct']:.1f}%", style={"textAlign": "right", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "13px", "color": color, "fontWeight": 600}),
            ])
        )
        # Sub-rows
        for sub in b["subs"]:
            portfolio_table_rows.append(
                html.Tr(children=[
                    html.Td(sub["name"], style={"padding": "4px 12px 4px 28px", "borderBottom": f"1px solid {BORDER}", "fontSize": "12px", "color": TEXT_DIM}),
                    html.Td(f"{sub['cnt']:,}", style={"textAlign": "right", "padding": "4px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "12px"}),
                    html.Td(f"{sub['pct']:.1f}%", style={"textAlign": "right", "padding": "4px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "12px", "color": TEXT_DIM}),
                ])
            )

    portfolio_table = html.Table(
        style={"width": "100%", "borderCollapse": "collapse"},
        children=[
            html.Thead(html.Tr([
                html.Th("Outcome", style={"textAlign": "left", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "color": TEXT_DIM, "fontSize": "12px"}),
                html.Th("Count", style={"textAlign": "right", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "color": TEXT_DIM, "fontSize": "12px"}),
                html.Th("%", style={"textAlign": "right", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "color": TEXT_DIM, "fontSize": "12px"}),
            ])),
            html.Tbody(portfolio_table_rows),
        ],
    )

    # Portfolio chart — donut of top-level buckets
    portfolio_chart_data = [{"name": b["name"], "cnt": b["total"]} for b in portfolio]
    colors = [BUCKET_COLORS.get(b["name"], TEXT_DIM) for b in portfolio]
    fig_portfolio = go.Figure(go.Pie(
        labels=[b["name"] for b in portfolio],
        values=[b["total"] for b in portfolio],
        hole=0.5, textinfo="label+percent", textposition="outside",
        textfont=dict(size=11, color=TEXT),
        marker=dict(colors=colors, line=dict(color=BG, width=2)),
    ))
    fig_portfolio.update_layout(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=TEXT), margin=dict(t=10, b=10, l=10, r=10),
        showlegend=False, height=380,
    )

    return html.Div([
        # 1. KPI cards
        html.Div(
            style={"display": "flex", "gap": "16px", "flexWrap": "wrap", "marginBottom": "24px"},
            children=[
                make_card("Total Patents", total, f"All applications in {db_name}"),
                make_card("Unique Applicants", unique_applicants, "Distinct companies/entities that filed"),
                make_card("Unique Inventors", unique_inventors, "Distinct first-named inventors across all filings"),
                make_card("Unique Examiners", unique_examiners, "USPTO examiners assigned to these cases"),
            ],
        ),

        # 2. Portfolio Outcome
        html.Div(
            style={"marginBottom": "24px"},
            children=[
                make_toggleable_card(
                    "portfolio", "Portfolio Outcome",
                    table_content=portfolio_table,
                    chart_content=dcc.Graph(figure=fig_portfolio, config={"displayModeBar": False}),
                ),
            ],
        ),

        # 3. Top 20 Applicants + By Application Type (side by side)
        html.Div(
            style={"display": "flex", "gap": "16px", "flexWrap": "wrap", "alignItems": "flex-start"},
            children=[
                make_toggleable_card(
                    "applicants", "Top 20 Applicants",
                    table_content=make_count_table_rows(applicant_rows, "Applicant"),
                    chart_content=make_horizontal_bar(applicant_rows, color="#58a6ff"),
                ),
                make_toggleable_card(
                    "app-type", "By Application Type",
                    table_content=make_count_table_rows(type_rows, "Type"),
                    chart_content=make_pie_chart(type_rows),
                ),
            ],
        ),
    ])


# ─── Prosecution Stage Mapping ───────────────────────────
PIPELINE_STAGES = [
    "Pre-Exam",
    "Awaiting First Action",
    "Non-Final Rejection",
    "Applicant Responded",
    "Final Rejection",
    "After Final Response",
    "On Appeal",
    "Allowed",
    "Issue Fee / Publication",
    "Suspended / Other",
]

PIPELINE_COLORS = {
    "Pre-Exam": "#6e7681",
    "Awaiting First Action": "#58a6ff",
    "Non-Final Rejection": "#d29922",
    "Applicant Responded": "#79c0ff",
    "Final Rejection": "#f85149",
    "After Final Response": "#f0883e",
    "On Appeal": "#a371f7",
    "Allowed": "#3fb950",
    "Issue Fee / Publication": "#2ea043",
    "Suspended / Other": "#8b949e",
}

# Stages that get split bars: stage -> list of sub-segment names
SPLIT_STAGES = {
    "Non-Final Rejection": ["Mailed", "Pending"],
    "Final Rejection": ["Mailed", "Pending", "Advisory Action"],
    "On Appeal": ["Filed / Brief", "Awaiting Decision", "Decision / Other"],
    "Allowed": ["Notice Mailed", "Not Yet Mailed"],
}

STAGE_GLOSSARY = [
    ("Pre-Exam", "Application filed but not yet assigned to a patent examiner. Includes cases awaiting formality review or classification."),
    ("Awaiting First Action", "Assigned to an examiner, waiting for their first review of the claims. This is the initial examination queue."),
    ("Non-Final Rejection", "Examiner rejected one or more claims; applicant can amend and respond.\n- Mailed: Rejection letter sent to applicant\n- Pending: Examiner completed rejection, letter not yet sent"),
    ("Applicant Responded", "Applicant filed amendments or arguments in response to a non-final rejection. Case returned to examiner for further review."),
    ("Final Rejection", "Examiner rejected claims again after applicant's response. Harder to overcome \u2014 options are appeal, request for continued examination (RCE), or abandon.\n- Mailed: Final rejection letter sent\n- Pending: Decided but letter not yet sent\n- Advisory Action: Examiner's response to applicant's post-final arguments"),
    ("After Final Response", "Applicant responded to a final rejection, attempting to overcome the rejection without filing an appeal or RCE."),
    ("On Appeal", "Applicant disagreed with examiner's rejection and escalated to the Patent Trial and Appeal Board (PTAB).\n- Filed / Brief: Appeal initiated, brief submitted\n- Awaiting Decision: Board is reviewing the case\n- Decision / Other: Board rendered a decision or other appeal activity"),
    ("Allowed", "USPTO approved the patent claims. Applicant must now pay the issue fee to receive the patent.\n- Notice Mailed: Allowance notice sent to applicant\n- Not Yet Mailed: Examiner approved, notice pending"),
    ("Issue Fee / Publication", "Applicant paid the issue fee. Patent is being processed for publication and grant. Nearly done."),
    ("Suspended / Other", "Prosecution paused due to external factors such as court proceedings, USPTO suspension, or other administrative holds."),
]


def classify_prosecution_stage(status):
    """Map an active/pending status to (stage, sub_segment)."""
    if not status:
        return None, None
    s = status.strip()

    # Pre-Exam
    if "Preexam" in s or "preexam" in s or "Dispatched from Preexam" in s or "Classification contractor" in s or "INFORMALITY" in s or "Application Undergoing" in s:
        return "Pre-Exam", None

    # Awaiting First Action
    if "Docketed" in s or "Ready for Examination" in s:
        return "Awaiting First Action", None

    # Non-Final Rejection
    if ("Non Final Action" in s or "Non-Final Action" in s) and ("Counted" in s or "Not Yet Mailed" in s):
        return "Non-Final Rejection", "Pending"
    if "Non Final Action" in s or "Non-Final Action" in s or "non-final action" in s:
        return "Non-Final Rejection", "Mailed"

    # Applicant Responded (to non-final)
    if "Response to Non-Final" in s or "Response after Non-Final" in s:
        return "Applicant Responded", None
    if "Response after non-final" in s or "response after nonfinal" in s or "Ready for examiner action after response" in s:
        return "Applicant Responded", None

    # Advisory Action (part of Final Rejection)
    if "Advisory Action" in s:
        return "Final Rejection", "Advisory Action"

    # Final Rejection
    if "Final Rejection" in s and ("Counted" in s or "Not Yet Mailed" in s):
        return "Final Rejection", "Pending"
    if "Final Rejection" in s:
        return "Final Rejection", "Mailed"

    # After Final Response
    if "Response after Final" in s or "after action closing" in s:
        return "After Final Response", None
    if "Ex parte Quayle" in s:
        return "After Final Response", None
    if "Withdraw from issue" in s:
        return "After Final Response", None

    # On Appeal
    if "Notice of Appeal" in s or "Appeal Brief" in s or "Amendment after" in s:
        return "On Appeal", "Filed / Brief"
    if "Awaiting Decision by the Board" in s:
        return "On Appeal", "Awaiting Decision"
    if "Board of Appeals Decision" in s or "Examiner's Answer" in s or "TC Return" in s or "Oral hearing" in s or "Respondent brief" in s:
        return "On Appeal", "Decision / Other"
    if "appeal" in s.lower():
        return "On Appeal", "Filed / Brief"

    # Allowed
    if "Allowed" in s and "Not Yet Mailed" in s:
        return "Allowed", "Not Yet Mailed"
    if "Notice of Allowance" in s:
        return "Allowed", "Notice Mailed"

    # Issue Fee / Publication
    if "Issue Fee" in s or "Awaiting TC" in s or "Pubs Processing" in s:
        return "Issue Fee / Publication", None

    # Suspended / Other
    if "Prosecution Suspended" in s or "Court" in s:
        return "Suspended / Other", None
    if "Abandonment for Failure to Correct" in s:
        return "Suspended / Other", None

    return None, None


# ─── Status Tab ──────────────────────────────────────────
def render_status_tab(db_path):
    # Pull everything from cache (instant after first load)
    d = get_status_data(db_path)
    total = d["total"]
    stage_counts = d["stage_counts"]
    stage_order = d["stage_order"]
    total_pending = sum(stage_counts.values())
    granted = d["granted"]
    total_utility = d["total_utility"]
    granted_utility = d["granted_utility"]
    grant_rate = d["grant_rate"]
    ttg_months = d["ttg_months"]
    avg_ttg = d["avg_ttg"]
    grant_by_year = d["grant_by_year"]
    expired_maint = d["expired_maint"]
    fees_due_now = d["fees_due_now"]
    fees_upcoming = d["fees_upcoming"]
    fees_by_year = d["fees_by_year"]
    next_fees = d["next_fees"]
    trend_rows = d["trend_rows"]

    sub_counts = d["sub_counts"]

    # Build stacked horizontal bar chart
    active_stages = [s for s in stage_order if stage_counts[s] > 0]
    # Reverse so largest is on top
    active_stages_rev = list(reversed(active_stages))

    fig_pipeline = go.Figure()

    # For split stages, add one trace per sub-segment; for others, one solid trace
    # Collect all unique sub-segment names across split stages for the legend
    all_sub_names = set()
    for stage, subs in SPLIT_STAGES.items():
        all_sub_names.update(subs)

    # First pass: add traces for non-split stages (single bar)
    non_split_y = []
    non_split_x = []
    non_split_colors = []
    non_split_hover = []
    for s in active_stages_rev:
        if s not in SPLIT_STAGES:
            non_split_y.append(s)
            non_split_x.append(stage_counts[s])
            non_split_colors.append(PIPELINE_COLORS[s])
            pct = (stage_counts[s] / total_pending * 100) if total_pending else 0
            non_split_hover.append(f"{s}<br>{stage_counts[s]:,} cases ({pct:.1f}% of pending)")

    if non_split_y:
        fig_pipeline.add_trace(go.Bar(
            y=non_split_y, x=non_split_x, orientation="h",
            marker_color=non_split_colors, name="",
            text=[f"{v:,}" for v in non_split_x], textposition="inside",
            textfont=dict(size=11, color="white"),
            hovertext=non_split_hover, hoverinfo="text",
            showlegend=False,
        ))

    # Second pass: add traces for split stages
    # We need to add separate traces per sub-segment so they stack
    for stage in SPLIT_STAGES:
        if stage not in active_stages or stage_counts[stage] == 0:
            continue
        subs = SPLIT_STAGES[stage]
        base_color = PIPELINE_COLORS[stage]
        # Create lighter/darker shades using rgba
        def hex_to_rgba(hex_color, alpha=1.0):
            h = hex_color.lstrip("#")
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            return f"rgba({r},{g},{b},{alpha})"

        shade_map = {}
        if len(subs) == 2:
            shade_map = {subs[0]: base_color, subs[1]: hex_to_rgba(base_color, 0.55)}
        elif len(subs) == 3:
            shade_map = {subs[0]: base_color, subs[1]: hex_to_rgba(base_color, 0.7), subs[2]: hex_to_rgba(base_color, 0.4)}

        for sub_name in subs:
            cnt = sub_counts.get(stage, {}).get(sub_name, 0)
            if cnt == 0:
                continue
            pct_stage = (cnt / stage_counts[stage] * 100) if stage_counts[stage] else 0
            pct_total = (cnt / total_pending * 100) if total_pending else 0

            # Build y-values: only this stage gets a value, others are 0
            y_vals = []
            x_vals = []
            for s in active_stages_rev:
                if s == stage:
                    y_vals.append(s)
                    x_vals.append(cnt)
                else:
                    y_vals.append(s)
                    x_vals.append(0)

            fig_pipeline.add_trace(go.Bar(
                y=y_vals, x=x_vals, orientation="h",
                marker_color=shade_map.get(sub_name, base_color),
                name=f"{sub_name}",
                text=[f"{cnt:,}" if v > 0 else "" for v in x_vals],
                textposition="inside", textfont=dict(size=10, color="white"),
                hovertext=[f"{stage}: {sub_name}<br>{cnt:,} ({pct_stage:.0f}% of stage, {pct_total:.1f}% of pending)" if v > 0 else "" for v in x_vals],
                hoverinfo="text",
                showlegend=True,
                legendgroup=stage,
            ))

    fig_pipeline.update_layout(
        barmode="stack",
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=TEXT, size=12),
        margin=dict(t=10, b=10, l=10, r=10),
        xaxis=dict(showgrid=False, showticklabels=False, zeroline=False),
        yaxis=dict(showgrid=False, tickfont=dict(size=12)),
        legend=dict(orientation="h", y=-0.05, x=0.5, xanchor="center", font=dict(size=10)),
        height=max(300, len(active_stages) * 40 + 60),
    )

    grant_years = [r["yr"] for r in grant_by_year]
    grant_rates = [(r["granted"] / r["filed"] * 100) if r["filed"] else 0 for r in grant_by_year]

    fig_grant_rate = go.Figure(go.Scatter(
        x=grant_years, y=grant_rates, mode="lines+markers",
        line=dict(color="#3fb950", width=2), marker=dict(size=6, color="#3fb950"),
        hovertemplate="%{x}: %{y:.1f}%<extra></extra>",
    ))
    fig_grant_rate.update_layout(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=TEXT), margin=dict(t=30, b=40, l=50, r=20),
        xaxis=dict(showgrid=False, title="Filing Year", dtick=2),
        yaxis=dict(showgrid=True, gridcolor=BORDER, title="Grant Rate %", range=[0, 100]), height=300,
    )

    fig_ttg = go.Figure(go.Histogram(
        x=ttg_months, xbins=dict(size=6), marker_color="#79c0ff",
        hovertemplate="%{x} months: %{y} patents<extra></extra>",
    ))
    fig_ttg.update_layout(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=TEXT), margin=dict(t=30, b=40, l=50, r=20),
        xaxis=dict(showgrid=False, title="Months from Filing to Grant"),
        yaxis=dict(showgrid=True, gridcolor=BORDER, title="Patents"), height=300,
    )

    fee_years = sorted(fees_by_year.keys())
    fee_counts = [fees_by_year[y] for y in fee_years]

    fig_fees = go.Figure(go.Bar(
        x=fee_years, y=fee_counts, marker_color="#d29922",
        text=[f"{c:,}" for c in fee_counts], textposition="outside", textfont=dict(color=TEXT, size=11),
        hovertemplate="%{x}: %{y:,} fees<extra></extra>",
    ))
    fig_fees.update_layout(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=TEXT), margin=dict(t=10, b=40, l=50, r=20),
        xaxis=dict(showgrid=False, title="Year"),
        yaxis=dict(showgrid=True, gridcolor=BORDER, title="Fee Events"), height=280,
    )

    years_set = sorted(set(r["yr"] for r in trend_rows))
    type_colors = {"Utility": "#58a6ff", "PCT": "#3fb950", "Provisional": "#d29922", "Design": "#a371f7"}
    trend_by_type = {}
    for r in trend_rows:
        t = r["app_type"]
        if t not in trend_by_type:
            trend_by_type[t] = {}
        trend_by_type[t][r["yr"]] = r["cnt"]

    fig_trends = go.Figure()
    for t in ["Utility", "PCT", "Provisional", "Design"]:
        if t in trend_by_type:
            values = [trend_by_type[t].get(y, 0) for y in years_set]
            fig_trends.add_trace(go.Bar(x=years_set, y=values, name=t, marker_color=type_colors.get(t, TEXT_DIM)))
    for t in trend_by_type:
        if t not in type_colors:
            values = [trend_by_type[t].get(y, 0) for y in years_set]
            fig_trends.add_trace(go.Bar(x=years_set, y=values, name=t, marker_color=TEXT_DIM))

    fig_trends.update_layout(
        barmode="stack", paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=TEXT), margin=dict(t=10, b=40, l=50, r=20),
        xaxis=dict(showgrid=False, title="Filing Year", dtick=2),
        yaxis=dict(showgrid=True, gridcolor=BORDER, title="Applications Filed"),
        legend=dict(orientation="h", y=1.12, x=0.5, xanchor="center"), height=350,
    )

    # ── Build the layout ──
    SECTION = {"backgroundColor": CARD_BG, "border": f"1px solid {BORDER}", "borderRadius": "8px", "padding": "20px", "marginBottom": "24px"}
    SECTION_TITLE = {"margin": "0 0 16px 0", "fontSize": "15px", "fontWeight": 600}

    return html.Div([
        # ── Section 1: Prosecution Pipeline ──
        html.Div(style=SECTION, children=[
            html.H3("Prosecution Pipeline", style=SECTION_TITLE),
            html.Div(f"{total_pending:,} active cases in examination", style={"fontSize": "12px", "color": TEXT_DIM, "marginBottom": "16px"}),
            # Stage KPI cards (two rows of 5)
            html.Div(
                style={"display": "flex", "gap": "10px", "flexWrap": "wrap", "marginBottom": "8px"},
                children=[
                    html.Div(
                        style={"flex": "1", "minWidth": "110px", "padding": "10px 14px", "borderRadius": "6px",
                               "backgroundColor": BG, "borderLeft": f"3px solid {PIPELINE_COLORS[s]}"},
                        children=[
                            html.Div(s, style={"fontSize": "10px", "color": TEXT_DIM, "marginBottom": "2px"}),
                            html.Div(f"{stage_counts[s]:,}", style={"fontSize": "18px", "fontWeight": 600}),
                        ],
                    ) for s in stage_order[:5] if stage_counts[s] > 0
                ],
            ),
            html.Div(
                style={"display": "flex", "gap": "10px", "flexWrap": "wrap", "marginBottom": "20px"},
                children=[
                    html.Div(
                        style={"flex": "1", "minWidth": "110px", "padding": "10px 14px", "borderRadius": "6px",
                               "backgroundColor": BG, "borderLeft": f"3px solid {PIPELINE_COLORS[s]}"},
                        children=[
                            html.Div(s, style={"fontSize": "10px", "color": TEXT_DIM, "marginBottom": "2px"}),
                            html.Div(f"{stage_counts[s]:,}", style={"fontSize": "18px", "fontWeight": 600}),
                        ],
                    ) for s in stage_order[5:] if stage_counts[s] > 0
                ],
            ),
            # Stacked bar chart
            dcc.Graph(figure=fig_pipeline, config={"displayModeBar": False}),
            # Glossary
            html.Details(
                open=False,
                style={"marginTop": "16px", "borderTop": f"1px solid {BORDER}", "paddingTop": "12px"},
                children=[
                    html.Summary("Stage Definitions", style={"fontSize": "13px", "fontWeight": 600, "cursor": "pointer", "color": TEXT_DIM, "marginBottom": "12px"}),
                    html.Div(
                        style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "12px"},
                        children=[
                            html.Div(
                                style={"padding": "10px 14px", "borderRadius": "6px", "backgroundColor": BG, "borderLeft": f"3px solid {PIPELINE_COLORS[name]}"},
                                children=[
                                    html.Div(name, style={"fontSize": "12px", "fontWeight": 600, "color": PIPELINE_COLORS[name], "marginBottom": "4px"}),
                                    *[html.Div(line, style={"fontSize": "11px", "color": TEXT_DIM, "lineHeight": "1.5"})
                                      for line in desc.split("\n")],
                                ],
                            ) for name, desc in STAGE_GLOSSARY if stage_counts.get(name, 0) > 0
                        ],
                    ),
                ],
            ),
        ]),

        # ── Section 2: Grant Analysis ──
        html.Div(style=SECTION, children=[
            html.H3("Grant Analysis", style=SECTION_TITLE),
            # KPI cards
            html.Div(
                style={"display": "flex", "gap": "16px", "flexWrap": "wrap", "marginBottom": "20px"},
                children=[
                    make_card("Grant Rate (Utility)", f"{grant_rate:.1f}%", f"{granted_utility:,} granted of {total_utility:,} utility filed"),
                    make_card("Avg Time to Grant", f"{avg_ttg:.1f} mo", f"Based on {len(ttg_months):,} granted patents"),
                    make_card("Total Granted", granted, "All types (Utility + Design + Plant + etc.)"),
                ],
            ),
            # Charts side by side
            html.Div(
                style={"display": "flex", "gap": "16px", "flexWrap": "wrap"},
                children=[
                    html.Div(style={"flex": "1", "minWidth": "400px"}, children=[
                        html.Div("Grant Rate by Filing Year (Utility)", style={"fontSize": "13px", "color": TEXT_DIM, "marginBottom": "8px"}),
                        dcc.Graph(figure=fig_grant_rate, config={"displayModeBar": False}),
                    ]),
                    html.Div(style={"flex": "1", "minWidth": "400px"}, children=[
                        html.Div(f"Time to Grant Distribution (avg {avg_ttg:.1f} months)", style={"fontSize": "13px", "color": TEXT_DIM, "marginBottom": "8px"}),
                        dcc.Graph(figure=fig_ttg, config={"displayModeBar": False}),
                    ]),
                ],
            ),
        ]),

        # ── Section 3: Maintenance Fees ──
        html.Div(style=SECTION, children=[
            html.H3("Maintenance Fees", style=SECTION_TITLE),
            html.Div("Estimated fee windows — verify with USPTO PAIR for actual payment status",
                      style={"fontSize": "11px", "color": TEXT_DIM, "marginBottom": "16px", "fontStyle": "italic"}),
            # KPI cards
            html.Div(
                style={"display": "flex", "gap": "16px", "flexWrap": "wrap", "marginBottom": "20px"},
                children=[
                    make_card("Active Granted", d["maint_count"], "Patents with grant date"),
                    html.Div(
                        style={"backgroundColor": CARD_BG, "border": f"1px solid {'#f85149' if fees_due_now else BORDER}",
                               "borderRadius": "8px", "padding": "20px", "flex": "1", "minWidth": "180px"},
                        children=[
                            html.Div("FEES DUE NOW", style={"fontSize": "13px", "color": "#f85149" if fees_due_now else TEXT_DIM, "marginBottom": "8px", "textTransform": "uppercase", "letterSpacing": "0.5px"}),
                            html.Div(f"{fees_due_now:,}", style={"fontSize": "28px", "fontWeight": 600, "color": "#f85149" if fees_due_now else TEXT}),
                            html.Div("Within 6-month payment window", style={"fontSize": "12px", "color": TEXT_DIM, "marginTop": "4px"}),
                        ],
                    ),
                    html.Div(
                        style={"backgroundColor": CARD_BG, "border": f"1px solid {'#d29922' if fees_upcoming else BORDER}",
                               "borderRadius": "8px", "padding": "20px", "flex": "1", "minWidth": "180px"},
                        children=[
                            html.Div("FEES NEXT 12 MONTHS", style={"fontSize": "13px", "color": "#d29922" if fees_upcoming else TEXT_DIM, "marginBottom": "8px", "textTransform": "uppercase", "letterSpacing": "0.5px"}),
                            html.Div(f"{fees_upcoming:,}", style={"fontSize": "28px", "fontWeight": 600, "color": "#d29922" if fees_upcoming else TEXT}),
                            html.Div("Due within next year", style={"fontSize": "12px", "color": TEXT_DIM, "marginTop": "4px"}),
                        ],
                    ),
                    make_card("Expired (Non-Payment)", expired_maint, "Lost due to maintenance fee lapse"),
                ],
            ),
            # Charts side by side
            html.Div(
                style={"display": "flex", "gap": "16px", "flexWrap": "wrap"},
                children=[
                    html.Div(style={"flex": "1", "minWidth": "400px"}, children=[
                        html.Div("Upcoming Maintenance Fees by Year", style={"fontSize": "13px", "color": TEXT_DIM, "marginBottom": "8px"}),
                        dcc.Graph(figure=fig_fees, config={"displayModeBar": False}) if fee_years else
                        html.Div("No upcoming fees in the next 12 months", style={"color": TEXT_DIM, "padding": "40px", "textAlign": "center"}),
                    ]),
                    html.Div(style={"flex": "1", "minWidth": "400px"}, children=[
                        html.Div("Next Maintenance Fees Due (Soonest First)", style={"fontSize": "13px", "color": TEXT_DIM, "marginBottom": "8px"}),
                        html.Table(
                            style={"width": "100%", "borderCollapse": "collapse"},
                            children=[
                                html.Thead(html.Tr([
                                    html.Th("Patent #", style={"textAlign": "left", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "color": TEXT_DIM, "fontSize": "12px"}),
                                    html.Th("Fee", style={"textAlign": "left", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "color": TEXT_DIM, "fontSize": "12px"}),
                                    html.Th("Due Date", style={"textAlign": "left", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "color": TEXT_DIM, "fontSize": "12px"}),
                                    html.Th("Status", style={"textAlign": "center", "padding": "8px 12px", "borderBottom": f"1px solid {BORDER}", "color": TEXT_DIM, "fontSize": "12px"}),
                                ])),
                                html.Tbody([
                                    html.Tr([
                                        html.Td(f[0], style={"padding": "6px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "13px"}),
                                        html.Td(f[1], style={"padding": "6px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "13px"}),
                                        html.Td(f[2], style={"padding": "6px 12px", "borderBottom": f"1px solid {BORDER}", "fontSize": "13px"}),
                                        html.Td(
                                            html.Span(f[3], style={
                                                "fontSize": "11px", "fontWeight": 600, "padding": "2px 8px", "borderRadius": "4px",
                                                "backgroundColor": "#f8514933" if f[3] == "DUE NOW" else "#d2992233",
                                                "color": "#f85149" if f[3] == "DUE NOW" else "#d29922",
                                            }),
                                            style={"textAlign": "center", "padding": "6px 12px", "borderBottom": f"1px solid {BORDER}"},
                                        ),
                                    ]) for f in next_fees
                                ]) if next_fees else html.Tbody([html.Tr(html.Td("No fees due soon", colSpan=4, style={"color": TEXT_DIM, "padding": "20px", "textAlign": "center"}))]),
                            ],
                        ) if next_fees else html.Div("No fees due in the near term", style={"color": TEXT_DIM, "padding": "40px", "textAlign": "center"}),
                    ]),
                ],
            ),
        ]),

        # ── Section 4: Filing Trends ──
        html.Div(style=SECTION, children=[
            html.H3("Filing Trends", style=SECTION_TITLE),
            html.Div("Applications filed by year, broken down by type", style={"fontSize": "12px", "color": TEXT_DIM, "marginBottom": "12px"}),
            dcc.Graph(figure=fig_trends, config={"displayModeBar": False}),
        ]),
    ])


# ─── Patents Tab ─────────────────────────────────────────
ALL_COLUMNS = [
    {"name": "App Number",  "id": "application_number", "default": True},
    {"name": "Title",       "id": "invention_title",    "default": True},
    {"name": "Type",        "id": "app_type",           "default": True},
    {"name": "Status",      "id": "app_status",         "default": True},
    {"name": "Status Date", "id": "app_status_date",    "default": False},
    {"name": "Filing Date", "id": "filing_date",        "default": True},
    {"name": "Patent #",    "id": "patent_number",      "default": True},
    {"name": "Grant Date",  "id": "grant_date",         "default": False},
    {"name": "Applicant",   "id": "first_applicant",    "default": True},
    {"name": "Inventor",    "id": "first_inventor",     "default": True},
    {"name": "Examiner",    "id": "examiner",           "default": True},
    {"name": "Art Unit",    "id": "group_art_unit",     "default": False},
    {"name": "CPC",         "id": "cpc_classifications","default": False},
    {"name": "Docket #",    "id": "docket_number",      "default": False},
    {"name": "Pub #",       "id": "pub_number",         "default": False},
    {"name": "Pub Date",    "id": "pub_date",           "default": False},
    {"name": "Correspondence", "id": "correspondence_address", "default": False},
]

DEFAULT_VISIBLE = [c["id"] for c in ALL_COLUMNS if c["default"]]
ALL_COL_IDS = [c["id"] for c in ALL_COLUMNS]

INPUT_STYLE = {"backgroundColor": CARD_BG, "border": f"1px solid {BORDER}", "borderRadius": "6px",
               "padding": "6px 10px", "color": TEXT, "fontSize": "13px", "width": "100%"}


def get_filter_options(db_path, column):
    """Get distinct values for a dropdown filter."""
    rows = query_db(db_path, f"SELECT DISTINCT {column} FROM patents WHERE {column} IS NOT NULL AND {column} != '' ORDER BY {column}")
    return [{"label": r[column], "value": r[column]} for r in rows]


def render_patents_table(db_path):
    type_options = get_filter_options(db_path, "app_type")
    # For status, just get top 20 to keep dropdown manageable
    status_rows = query_db(db_path, "SELECT DISTINCT app_status FROM patents WHERE app_status IS NOT NULL AND app_status != '' ORDER BY app_status ASC")
    status_options = [{"label": r["app_status"], "value": r["app_status"]} for r in status_rows]

    total = query_one(db_path, "SELECT COUNT(*) FROM patents")[0]
    rows = query_db(db_path, f"SELECT {', '.join(DEFAULT_VISIBLE)} FROM patents ORDER BY filing_date DESC LIMIT 50")

    return html.Div([
        # ── Filter bar ──
        html.Div(
            style={"backgroundColor": CARD_BG, "border": f"1px solid {BORDER}", "borderRadius": "8px",
                   "padding": "16px 20px", "marginBottom": "16px"},
            children=[
                html.Div(
                    style={"display": "flex", "alignItems": "center", "justifyContent": "space-between", "marginBottom": "12px"},
                    children=[
                        html.Span("Filters", style={"fontSize": "13px", "fontWeight": 600, "textTransform": "uppercase", "letterSpacing": "0.5px"}),
                        html.Div(
                            style={"display": "flex", "gap": "8px", "alignItems": "center"},
                            children=[
                                html.Span(id="result-count", children=f"{total:,} patents",
                                          style={"fontSize": "13px", "color": TEXT_DIM}),
                                html.Button("Export CSV", id="export-csv",
                                            style={**MINI_TAB, "border": f"1px solid {BORDER}", "color": "#3fb950"},
                                            n_clicks=0),
                                html.Button("Clear Filters", id="clear-filters",
                                            style={**MINI_TAB, "border": f"1px solid {BORDER}"},
                                            n_clicks=0),
                            ],
                        ),
                    ],
                ),
                # Row 1: Quick search + Type + Status
                html.Div(
                    style={"display": "flex", "gap": "12px", "marginBottom": "10px", "flexWrap": "wrap"},
                    children=[
                        html.Div(style={"flex": "2", "minWidth": "200px"}, children=[
                            html.Label("Search", style={"fontSize": "11px", "color": TEXT_DIM, "marginBottom": "4px", "display": "block"}),
                            dcc.Input(id="table-search", type="text", placeholder="Title, app number...",
                                      debounce=True, style=INPUT_STYLE),
                        ]),
                        html.Div(style={"flex": "1", "minWidth": "150px"}, children=[
                            html.Label("Type", style={"fontSize": "11px", "color": TEXT_DIM, "marginBottom": "4px", "display": "block"}),
                            dcc.Dropdown(id="filter-type", options=type_options, multi=True,
                                         placeholder="All types", style={"fontSize": "13px"}),
                        ]),
                        html.Div(style={"flex": "1.5", "minWidth": "200px"}, children=[
                            html.Label("Status", style={"fontSize": "11px", "color": TEXT_DIM, "marginBottom": "4px", "display": "block"}),
                            dcc.Dropdown(id="filter-status", options=status_options, multi=True,
                                         placeholder="All statuses", style={"fontSize": "13px"}),
                        ]),
                    ],
                ),
                # Row 2: Applicant + Inventor + Filing Date range
                html.Div(
                    style={"display": "flex", "gap": "12px", "flexWrap": "wrap"},
                    children=[
                        html.Div(style={"flex": "1", "minWidth": "180px"}, children=[
                            html.Label("Applicant", style={"fontSize": "11px", "color": TEXT_DIM, "marginBottom": "4px", "display": "block"}),
                            dcc.Input(id="filter-applicant", type="text", placeholder="e.g. Wells Fargo",
                                      debounce=True, style=INPUT_STYLE),
                        ]),
                        html.Div(style={"flex": "1", "minWidth": "180px"}, children=[
                            html.Label("Inventor", style={"fontSize": "11px", "color": TEXT_DIM, "marginBottom": "4px", "display": "block"}),
                            dcc.Input(id="filter-inventor", type="text", placeholder="e.g. Smith",
                                      debounce=True, style=INPUT_STYLE),
                        ]),
                        html.Div(style={"flex": "0.7", "minWidth": "140px"}, children=[
                            html.Label("Filed From", style={"fontSize": "11px", "color": TEXT_DIM, "marginBottom": "4px", "display": "block"}),
                            dcc.DatePickerSingle(id="filter-date-from", placeholder="Start date",
                                                 style={"fontSize": "13px"}),
                        ]),
                        html.Div(style={"flex": "0.7", "minWidth": "140px"}, children=[
                            html.Label("Filed To", style={"fontSize": "11px", "color": TEXT_DIM, "marginBottom": "4px", "display": "block"}),
                            dcc.DatePickerSingle(id="filter-date-to", placeholder="End date",
                                                 style={"fontSize": "13px"}),
                        ]),
                        html.Div(style={"flex": "1", "minWidth": "180px"}, children=[
                            html.Label("Examiner", style={"fontSize": "11px", "color": TEXT_DIM, "marginBottom": "4px", "display": "block"}),
                            dcc.Input(id="filter-examiner", type="text", placeholder="e.g. Johnson",
                                      debounce=True, style=INPUT_STYLE),
                        ]),
                    ],
                ),
            ],
        ),

        # ── Column visibility ──
        html.Div(
            style={"marginBottom": "12px", "display": "flex", "alignItems": "center", "gap": "12px"},
            children=[
                html.Span("Columns:", style={"fontSize": "12px", "color": TEXT_DIM}),
                dcc.Checklist(
                    id="column-toggle",
                    options=[{"label": f"  {c['name']}", "value": c["id"]} for c in ALL_COLUMNS],
                    value=DEFAULT_VISIBLE,
                    inline=True,
                    style={"display": "flex", "gap": "12px", "flexWrap": "wrap", "fontSize": "12px"},
                    inputStyle={"marginRight": "2px", "cursor": "pointer"},
                    labelStyle={"cursor": "pointer", "color": TEXT_DIM},
                ),
                html.Button("All", id="cols-all", style={**MINI_TAB, "border": f"1px solid {BORDER}", "padding": "2px 8px"}, n_clicks=0),
                html.Button("Reset", id="cols-reset", style={**MINI_TAB, "border": f"1px solid {BORDER}", "padding": "2px 8px"}, n_clicks=0),
            ],
        ),

        # ── Data table ──
        dash_table.DataTable(
            id="patent-table",
            columns=[{"name": c["name"], "id": c["id"]} for c in ALL_COLUMNS if c["id"] in DEFAULT_VISIBLE],
            data=rows,
            page_size=50,
            page_current=0,
            page_action="custom",
            sort_action="custom",
            sort_mode="single",
            sort_by=[{"column_id": "filing_date", "direction": "desc"}],
            style_table={"overflowX": "auto"},
            style_header={
                "backgroundColor": CARD_BG, "color": TEXT, "fontWeight": 600, "fontSize": "12px",
                "border": f"1px solid {BORDER}", "textTransform": "uppercase", "letterSpacing": "0.5px",
            },
            style_cell={
                "backgroundColor": BG, "color": TEXT, "border": f"1px solid {BORDER}",
                "padding": "10px 12px", "fontSize": "13px", "textAlign": "left",
                "maxWidth": "300px", "overflow": "hidden", "textOverflow": "ellipsis",
            },
            style_data_conditional=[
                {"if": {"row_index": "odd"}, "backgroundColor": "#0d1117"},
                {"if": {"row_index": "even"}, "backgroundColor": "#161b22"},
            ],
        ),
        dcc.Download(id="csv-download"),
        dcc.Store(id="table-total", data=total),
    ])


# ── Column toggle callbacks ──
@callback(
    Output("column-toggle", "value"),
    Input("cols-all", "n_clicks"),
    Input("cols-reset", "n_clicks"),
    prevent_initial_call=True,
)
def toggle_all_columns(all_clicks, reset_clicks):
    ctx = dash.callback_context
    if not ctx.triggered:
        return DEFAULT_VISIBLE
    trigger = ctx.triggered[0]["prop_id"]
    if "cols-all" in trigger:
        return ALL_COL_IDS
    return DEFAULT_VISIBLE


# ── CSV export callback (full filtered dataset) ──
@callback(
    Output("csv-download", "data"),
    Input("export-csv", "n_clicks"),
    State("table-search", "value"),
    State("filter-type", "value"),
    State("filter-status", "value"),
    State("filter-applicant", "value"),
    State("filter-inventor", "value"),
    State("filter-examiner", "value"),
    State("filter-date-from", "date"),
    State("filter-date-to", "date"),
    State("column-toggle", "value"),
    State("db-selector", "value"),
    prevent_initial_call=True,
)
def export_csv(n_clicks, search, types, statuses, applicant, inventor, examiner, date_from, date_to, visible_cols, db_path):
    if not n_clicks or not db_path:
        return None

    if not visible_cols:
        visible_cols = DEFAULT_VISIBLE
    select_sql = ", ".join(visible_cols)

    # Build same WHERE clauses as the table
    conditions = []
    params = []
    if search:
        conditions.append("(invention_title LIKE ? OR application_number LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like])
    if types:
        placeholders = ",".join("?" * len(types))
        conditions.append(f"app_type IN ({placeholders})")
        params.extend(types)
    if statuses:
        placeholders = ",".join("?" * len(statuses))
        conditions.append(f"app_status IN ({placeholders})")
        params.extend(statuses)
    if applicant:
        conditions.append("first_applicant LIKE ?")
        params.append(f"%{applicant}%")
    if inventor:
        conditions.append("first_inventor LIKE ?")
        params.append(f"%{inventor}%")
    if examiner:
        conditions.append("examiner LIKE ?")
        params.append(f"%{examiner}%")
    if date_from:
        conditions.append("filing_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("filing_date <= ?")
        params.append(date_to)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    rows = query_db(db_path, f"SELECT {select_sql} FROM patents {where} ORDER BY filing_date DESC", params)

    if not rows:
        return None

    import io, csv
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=visible_cols)
    writer.writeheader()
    writer.writerows(rows)

    db_name = Path(db_path).stem
    return dict(content=output.getvalue(), filename=f"{db_name}_patents.csv")


# ── Clear filters callback ──
@callback(
    Output("table-search", "value"),
    Output("filter-type", "value"),
    Output("filter-status", "value"),
    Output("filter-applicant", "value"),
    Output("filter-inventor", "value"),
    Output("filter-examiner", "value"),
    Output("filter-date-from", "date"),
    Output("filter-date-to", "date"),
    Input("clear-filters", "n_clicks"),
    prevent_initial_call=True,
)
def clear_filters(_):
    return "", None, None, "", "", "", None, None


# ── Main table update (data + columns + result count) ──
@callback(
    Output("patent-table", "data"),
    Output("patent-table", "columns"),
    Output("result-count", "children"),
    Input("patent-table", "page_current"),
    Input("patent-table", "sort_by"),
    Input("table-search", "value"),
    Input("filter-type", "value"),
    Input("filter-status", "value"),
    Input("filter-applicant", "value"),
    Input("filter-inventor", "value"),
    Input("filter-examiner", "value"),
    Input("filter-date-from", "date"),
    Input("filter-date-to", "date"),
    Input("column-toggle", "value"),
    State("db-selector", "value"),
    prevent_initial_call=True,
)
def update_table(page, sort_by, search, types, statuses, applicant, inventor, examiner, date_from, date_to, visible_cols, db_path):
    if not db_path:
        return [], [], "0 patents"

    page = page or 0
    page_size = 50
    offset = page * page_size

    # Build visible columns list
    if not visible_cols:
        visible_cols = DEFAULT_VISIBLE
    cols = [{"name": c["name"], "id": c["id"]} for c in ALL_COLUMNS if c["id"] in visible_cols]
    select_sql = ", ".join(visible_cols)

    # Build WHERE clauses
    conditions = []
    params = []

    if search:
        conditions.append("(invention_title LIKE ? OR application_number LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like])

    if types:
        placeholders = ",".join("?" * len(types))
        conditions.append(f"app_type IN ({placeholders})")
        params.extend(types)

    if statuses:
        placeholders = ",".join("?" * len(statuses))
        conditions.append(f"app_status IN ({placeholders})")
        params.extend(statuses)

    if applicant:
        conditions.append("first_applicant LIKE ?")
        params.append(f"%{applicant}%")

    if inventor:
        conditions.append("first_inventor LIKE ?")
        params.append(f"%{inventor}%")

    if examiner:
        conditions.append("examiner LIKE ?")
        params.append(f"%{examiner}%")

    if date_from:
        conditions.append("filing_date >= ?")
        params.append(date_from)

    if date_to:
        conditions.append("filing_date <= ?")
        params.append(date_to)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    # Get filtered count
    count = query_one(db_path, f"SELECT COUNT(*) FROM patents {where}", params)[0]

    # Sort
    order = "filing_date DESC"
    if sort_by and len(sort_by) > 0:
        col = sort_by[0]["column_id"]
        if col in ALL_COL_IDS:
            direction = "ASC" if sort_by[0]["direction"] == "asc" else "DESC"
            order = f"{col} {direction}"

    sql = f"SELECT {select_sql} FROM patents {where} ORDER BY {order} LIMIT ? OFFSET ?"
    params.extend([page_size, offset])
    rows = query_db(db_path, sql, params)

    return rows, cols, f"{count:,} patents"


# ─── Run ─────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"\n  Databases found in {DATA_DIR}:")
    for db in get_databases():
        print(f"    {db['label']}")
    print(f"\n  Starting dashboard at http://localhost:8050\n")
    app.run(debug=True, port=8050)
