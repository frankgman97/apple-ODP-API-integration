# USPTO Patent Data Pipeline

A toolkit for fetching patent application data from the [USPTO Open Data Portal (ODP) API](https://developer.uspto.gov/api-catalog/open-data-portal). Includes a headless CLI pipeline for bulk data collection and a browser-based search UI for interactive exploration.

## What It Does

**CLI Pipeline** — Bulk-fetch patent records at scale. Handles datasets of any size (tested with 57K+ records) using date-range chunking to work around API offset limits, concurrent workers, crash-safe resume, and streaming export to JSON/CSV. All data is stored locally in SQLite.

**Web App** — A browser-based search interface for querying the USPTO ODP API interactively. Search by applicant, inventor, title, patent number, date range, and more. Export results to JSON or CSV.

## Prerequisites

| Requirement | Purpose |
|---|---|
| **Node.js** >= 18 | Runtime (uses native `fetch`) |
| **npm** | Package manager |
| **USPTO API Key** | Required for all API calls. Get one at [developer.uspto.gov](https://developer.uspto.gov) |

## Setup

```bash
# Install dependencies
npm install

# Add your API key
echo "VITE_USPTO_API_KEY=your_key_here" > .env
```

## Quick Start — CLI Pipeline

```bash
# 1. Preview the work plan (no data fetched)
npm run cli:search -- -q 'applicationMetaData.firstApplicantName:Apple*' --dry-run

# 2. Fetch search metadata for all matching records
npm run cli:search -- -q 'applicationMetaData.firstApplicantName:Apple*'

# 3. Check progress
npm run cli:status

# 4. Fetch full detail records (one API call per application)
npm run cli:details

# 5. Export to JSON and CSV
npm run cli:export
```

See [CLI.md](CLI.md) for the full CLI reference — commands, options, query syntax, architecture details, database schema, and troubleshooting.

## Quick Start — Web App

```bash
npm run dev
```

Opens a local dev server with the search UI. Uses the same API key from `.env`.

## How the CLI Pipeline Works

The USPTO API caps results at 10,000 records per query. The pipeline works around this by splitting large queries into date-range chunks:

1. **Probe** — determines total record count and date range
2. **Chunk** — splits the range into 6-month intervals
3. **Subdivide** — any chunk over 10K records is split into 1-month intervals
4. **Fetch** — concurrent workers claim and fetch chunks independently
5. **Resume** — interrupted runs pick up exactly where they left off

Records are written to SQLite as each page arrives — you never lose data, even on crash or `Ctrl+C`.

## Project Structure

```
├── cli/                    Headless CLI pipeline
│   ├── main.ts             Entry point (Commander CLI)
│   ├── config.ts           API key + defaults
│   ├── api-client.ts       HTTP layer with retry/backoff
│   ├── db.ts               SQLite schema + CRUD
│   ├── pipeline.ts         Orchestrator (probe → chunk → fetch)
│   ├── search-worker.ts    Concurrent search workers
│   ├── detail-worker.ts    Concurrent detail workers
│   ├── progress.ts         Terminal progress bars
│   └── export-streaming.ts Streaming JSON/CSV export
├── src/                    Browser search app
│   ├── api.ts              API client
│   ├── types.ts            TypeScript interfaces
│   ├── ui.ts               DOM rendering
│   ├── export.ts           Browser export (JSON/CSV)
│   ├── main.ts             App entry point
│   └── style.css           Styles
├── samples/                Sample API responses
├── generate_report.py      Python report generator
├── CLI.md                  Full CLI documentation
└── package.json
```

## USPTO ODP API

The pipeline uses two API endpoints:

| Endpoint | Purpose |
|---|---|
| `POST data.uspto.gov/apis/patent-file-wrapper/search` | Search — returns paginated results with ~15 summary fields |
| `GET api.uspto.gov/api/v1/patent/applications/{appNo}` | Detail — returns the complete record (attorneys, prosecution history, continuity, assignments) |

**Coverage:** Applications filed on or after January 1, 2001.

**Query syntax:** Apache Lucene. See [CLI.md](CLI.md#query-syntax) for fields, operators, and examples.

## Data Preview

Inspect the SQLite database with [Datasette](https://datasette.io/):

```bash
pipx install datasette
datasette data/your_database.db
```

Or use [DB Browser for SQLite](https://sqlitebrowser.org/).

## License

MIT
