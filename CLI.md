# USPTO Patent Data Pipeline — CLI Reference

A headless Node.js pipeline for bulk-fetching patent application data from the [USPTO Open Data Portal (ODP) API](https://developer.uspto.gov/api-catalog/open-data-portal). Designed to handle datasets of any size (tested with 57K+ records) with crash-safe resume, concurrent workers, and streaming export.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Commands](#commands)
  - [`search`](#search) — Fetch patent records by query
  - [`details`](#details) — Fetch full records for each application
  - [`export`](#export) — Export database to JSON/CSV files
  - [`status`](#status) — Show pipeline progress
- [Configuration](#configuration)
- [Query Syntax](#query-syntax)
- [How It Works](#how-it-works)
  - [Architecture Overview](#architecture-overview)
  - [Date-Range Chunking](#date-range-chunking)
  - [Concurrency Model](#concurrency-model)
  - [Crash Recovery & Resume](#crash-recovery--resume)
  - [Null Filing Date Edge Case](#null-filing-date-edge-case)
- [Database Schema](#database-schema)
- [Export Format](#export-format)
- [Data Preview](#data-preview)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [File Structure](#file-structure)

---

## Prerequisites

| Requirement | Purpose |
|---|---|
| **Node.js** >= 18 | Runtime (uses native `fetch`) |
| **npm** | Package manager |
| **USPTO API Key** | Required for all API calls. Get one at [developer.uspto.gov](https://developer.uspto.gov) |

Install dependencies:

```bash
npm install
```

### API Key Setup

Create a `.env` file in the project root:

```
USPTO_API_KEY=your_key_here
```

The pipeline also reads `VITE_USPTO_API_KEY` (for compatibility with the browser app). You can override the key per-command with `--api-key`.

---

## Quick Start

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

---

## Commands

All commands are run via `npm run cli -- <command>` or the shorthand scripts.

### `search`

Fetches patent search results and stores them in a local SQLite database.

```
npm run cli:search -- -q <query> [options]
```

| Option | Default | Description |
|---|---|---|
| `-q, --query <string>` | **(required)** | Lucene query string (see [Query Syntax](#query-syntax)) |
| `--dry-run` | `false` | Show the chunk plan and expected record counts without fetching any data. Use this to verify your query and estimate the workload before committing to a long run. |
| `--db <path>` | `./data/patents.db` | Path to the SQLite database file. Use separate files for separate queries (e.g., `./data/apple.db`, `./data/polsinelli.db`). The directory is created automatically. |
| `--date-from <YYYY-MM-DD>` | Auto-detected | Start of filing date range. If omitted, the pipeline probes the API to find the oldest matching record. |
| `--date-to <YYYY-MM-DD>` | Auto-detected | End of filing date range. If omitted, uses the newest matching record's date. |
| `--concurrency <n>` | `3` | Number of parallel fetch workers. Higher values are faster but increase rate-limit risk. |
| `--chunk-months <n>` | `6` | Size of each date-range chunk in months. Chunks larger than 10,000 records are automatically subdivided into 1-month intervals. |
| `--api-key <key>` | From `.env` | Override the API key for this run. |
| `--resume` | On by default | Resume is automatic. If the database already contains chunks from a prior run of the same query, the pipeline picks up where it left off. |

**What it does:**

1. Sends a lightweight probe query (`limit: 1`) to get the total record count and the oldest/newest filing dates.
2. Splits the date range into chunks (default: 6-month intervals).
3. Probes each chunk's size. If any chunk exceeds 10,000 records (the API's maximum offset), it is subdivided into 1-month intervals.
4. Adds a special "null filing dates" chunk to catch records with no filing date (see [edge case](#null-filing-date-edge-case)).
5. Saves the chunk plan to the database, then launches concurrent workers that each claim and fetch one chunk at a time.
6. Records are written to the database immediately as each page of 25 results arrives.
7. After all chunks complete, queues all application numbers for the detail fetch phase.

**Example output:**

```
Probing total count for: applicationMetaData.firstApplicantName:Apple*
  Total records: 57,237
  Date range: 2001-03-15 → 2025-11-20
  Initial chunks: 50 (6-month intervals)
  Probing chunk sizes...
    2001-03-15 → 2001-09-14: 412 records
    ...
    (null filing dates): 34 records

  Final chunks: 51
  Expected total records: 57,237

USPTO Patent Pipeline — Search Phase
═══════════════════════════════════════════════════════
 ████████████████████████████████████████ 100% | 57237/57237 | Overall | ETA: 0s
 ████████████████████████████████████████ 100% | W1: 2023-01 → 2023-06 DONE
 ████████████████████████████████████████ 100% | W2: 2024-01 → 2024-06 DONE
 ████████████████████████████████████████ 100% | W3: null filing dates DONE

Search complete.
  Records in DB: 57,237
  Chunks: 51 done, 0 errored
  Queued 57,237 applications for detail fetch.
```

---

### `details`

Fetches the full detail record for each application found during the search phase. The search endpoint returns ~15 summary fields; the detail endpoint returns the complete record (attorneys, prosecution history, continuity data, assignments, etc.).

```
npm run cli:details [options]
```

| Option | Default | Description |
|---|---|---|
| `--db <path>` | `./data/patents.db` | Path to the SQLite database. Must contain data from a prior `search` run. |
| `--concurrency <n>` | `5` | Number of parallel workers. The detail endpoint is one call per record, so more workers help significantly. |
| `--limit <n>` | All pending | Fetch at most `n` records. Useful for testing (e.g., `--limit 50`). |
| `--retry-errors` | `false` | Retry records that errored on a previous run. |
| `--api-key <key>` | From `.env` | Override the API key. |

**What it does:**

1. Reads the `detail_queue` table to find all pending application numbers.
2. Launches `n` concurrent workers. Each worker atomically claims the next pending application, fetches the full record from the detail endpoint, and writes it to the database.
3. Errored records are retried up to 3 times automatically.

**Note:** This step is significantly slower than search because the detail API returns one record per request (vs. 25 per page during search). For 12,000 records at ~4 req/s, expect ~50 minutes.

---

### `export`

Exports the patent data from SQLite to JSON and/or CSV files using streaming writes (constant memory usage regardless of dataset size).

```
npm run cli:export [options]
```

| Option | Default | Description |
|---|---|---|
| `--format <json\|csv\|both>` | `both` | Output format. |
| `--output <dir>` | `./data/exports` | Output directory (created automatically). |
| `--source <search\|detail>` | All records | Filter by data source. Use `search` for summary metadata only, or `detail` for full records. |
| `--db <path>` | `./data/patents.db` | Path to the SQLite database. |

**Output files are named with the current date:** `patents_2026-03-12.json`, `patents_2026-03-12.csv`.

---

### `status`

Displays the current state of the pipeline: chunk progress, record counts, and detail queue status.

```
npm run cli:status [options]
```

| Option | Default | Description |
|---|---|---|
| `--db <path>` | `./data/patents.db` | Path to the SQLite database. |

**Example output:**

```
Pipeline Status
═══════════════════════════════════════
Database: ./data/polsinelli.db
Query: (correspondenceAddressBag.nameLineOneText:*POLSINELLI* OR ...)

Chunks:
  Total: 51 | Done: 51 | Pending: 0 | Errors: 0

Patent Records:
  Total: 12,178 | Search: 12,178 | Detail: 0

Detail Queue:
  Total: 12,178 | Done: 0 | Pending: 12,178 | Errors: 0
```

---

## Configuration

Default values are defined in `cli/config.ts`. All can be overridden via CLI flags.

| Parameter | Default | Description |
|---|---|---|
| `pageSize` | `25` | Records per API page. Reduced from 100 to avoid HTTP 413 (payload too large) errors — patent records with full attorney/event data are very large. |
| `rateLimitDelay` | `250` ms | Delay between consecutive API requests within a worker. |
| `rateLimitBackoff` | `5000` ms | Initial backoff when the API returns HTTP 429 (rate limited). Doubles on each retry (exponential backoff). |
| `maxRetries` | `3` | Maximum retry attempts for failed API requests. |
| `concurrency` | `3` (search) / `5` (details) | Number of parallel workers. |
| `chunkMonths` | `6` | Date-range chunk size in months. |

---

## Query Syntax

The USPTO ODP API uses [Apache Lucene query syntax](https://lucene.apache.org/core/2_9_4/queryparsersyntax.html). Queries are passed via the `-q` flag.

### Common Fields

| Field | Description | Example |
|---|---|---|
| `applicationMetaData.firstApplicantName` | First named applicant | `Apple*` |
| `applicationMetaData.firstInventorName` | First named inventor | `"John Smith"` |
| `applicationMetaData.inventionTitle` | Title of the invention | `"machine learning"` |
| `applicationMetaData.applicationStatusDescriptionText` | Application status | `Patented*` |
| `applicationMetaData.groupArtUnitNumber` | Tech center / art unit | `16*` (all of TC 1600) |
| `applicationMetaData.examinerNameText` | Examiner name | `"SMITH, JOHN"` |
| `correspondenceAddressBag.nameLineOneText` | Correspondence address line 1 | `*POLSINELLI*` |
| `correspondenceAddressBag.nameLineTwoText` | Correspondence address line 2 | `*POLSINELLI*` |
| `applicationMetaData.filingDate` | Filing date | `[2020-01-01 TO 2023-12-31]` |
| `applicationMetaData.cpcClassificationBag` | CPC classification codes | `A61B*` |

### Operators

| Operator | Example |
|---|---|
| `AND` | `firstApplicantName:Apple* AND groupArtUnitNumber:16*` |
| `OR` | `nameLineOneText:*FOLEY* OR nameLineTwoText:*FOLEY*` |
| `NOT` | `firstApplicantName:Apple* AND NOT applicationStatusDescriptionText:Abandoned*` |
| `*` (wildcard) | `firstApplicantName:Apple*` matches "Apple Inc.", "Apple Computer", etc. |
| `"..."` (phrase) | `inventionTitle:"neural network"` |
| `(...)` (grouping) | `(nameLineOneText:*FOO* OR nameLineTwoText:*FOO*) AND groupArtUnitNumber:17*` |

### Tips

- Always wrap the full `-q` value in **single quotes** to prevent shell interpretation of `*`, `(`, `)`, and `&`.
- Use the [USPTO Patent File Wrapper search UI](https://patentcenter.uspto.gov/applications/search) to test queries interactively before running them through the pipeline.
- Wildcard prefix searches (`*POLSINELLI*`) work but are slower than suffix-only wildcards (`Apple*`).

---

## How It Works

### Architecture Overview

```
┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│              │     │   USPTO ODP API    │     │              │
│   CLI Entry  │────▶│   /search (POST)   │────▶│   SQLite DB  │
│   (main.ts)  │     │   /detail (GET)    │     │   (WAL mode) │
│              │     │                    │     │              │
└──────────────┘     └───────────────────┘     └──────────────┘
       │                      ▲                       │
       │                      │                       │
       ▼                      │                       ▼
┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│   Pipeline   │     │  Search Workers   │     │   Streaming  │
│  Orchestrator│────▶│  (N concurrent)   │     │   Export     │
│ (pipeline.ts)│     │ Detail Workers    │     │  (JSON/CSV)  │
└──────────────┘     └───────────────────┘     └──────────────┘
```

The pipeline runs entirely on your local machine. No browser, no server, no cloud. It reads your API key from `.env`, fetches data directly from the USPTO API, and stores everything in a local SQLite file.

### Date-Range Chunking

The USPTO API has a hard limit: you can only access the first **10,000 records** of any result set (max offset = 10,000). For queries returning more than 10,000 results, the pipeline splits the work into date-range chunks:

1. **Probe** — A lightweight request (`limit: 1`) determines the total count and the oldest/newest filing dates.
2. **Chunk** — The date range is split into intervals (default: 6 months). Each chunk gets its own API request with a `rangeFilter` on `filingDate`.
3. **Adaptive subdivision** — If any chunk still contains >10,000 records, it's automatically split into 1-month intervals.
4. **Fetch** — Each chunk is fetched independently. Since every chunk has <10,000 records, the offset limit is never hit.

```
Total: 57,237 records (2001 → 2025)
  ├── 2001-01 → 2001-06: 412 records  ✓ one chunk
  ├── 2001-07 → 2001-12: 389 records  ✓ one chunk
  ├── ...
  ├── 2023-01 → 2023-06: 4,200 records  ✓ one chunk
  ├── 2023-07 → 2023-12: 11,500 records  ✗ too big!
  │   ├── 2023-07: 1,800 records  ✓ subdivided
  │   ├── 2023-08: 1,950 records  ✓ subdivided
  │   └── ...
  └── null filing dates: 34 records  ✓ special chunk
```

### Concurrency Model

Multiple workers run in parallel, each independently claiming and fetching chunks:

1. Worker calls `claimNextChunk()` — an atomic SQLite transaction that marks one `pending` chunk as `in_progress` and returns it.
2. Worker fetches all pages for that chunk (25 records per page), writing each page to the DB immediately.
3. Worker marks the chunk as `done` and loops back to claim the next one.
4. When no more pending chunks exist, the worker exits.

Workers never conflict because chunk claiming is transactional — SQLite guarantees that two workers cannot claim the same chunk.

### Crash Recovery & Resume

**You never lose data.** Every design decision prioritizes crash safety:

- Records are written to SQLite **as each page arrives** (every 25 records), not buffered in memory.
- Each chunk's status is tracked: `pending` → `in_progress` → `done` (or `error`).
- On restart, `in_progress` chunks are reset to `pending` and re-fetched. `done` chunks are skipped.
- Duplicate records are handled via `INSERT OR REPLACE` on the primary key — re-fetching a partial chunk is safe.
- `Ctrl+C` triggers a graceful shutdown (SIGINT handler). Workers finish their current page, then stop.

**To resume after any interruption, just run the same command again.**

### Null Filing Date Edge Case

A small number of patent records have no `filingDate` in the API. These records are invisible to date-range filters (`rangeFilters` only match records that *have* a date value). The pipeline handles this automatically:

1. After generating all date-range chunks, it runs one additional probe: `<original query> AND NOT applicationMetaData.filingDate:[* TO *]`
2. If any records match (they have the original query's criteria but no filing date), a special chunk with ID `null-dates` is added.
3. This chunk is fetched without `rangeFilters`, using the modified query that explicitly selects null-date records.

This ensures 100% record capture.

---

## Database Schema

The SQLite database (`data/*.db`) uses WAL mode for safe concurrent access and contains three tables:

### `patents`

One row per patent application. Primary storage for all fetched data.

| Column | Type | Description |
|---|---|---|
| `application_number` | TEXT (PK) | e.g., `16123456` |
| `invention_title` | TEXT | Title of the invention |
| `filing_date` | TEXT | `YYYY-MM-DD` or null |
| `patent_number` | TEXT | Granted patent number, if any |
| `grant_date` | TEXT | Grant date, if any |
| `app_status` | TEXT | e.g., `Patented Case`, `Abandoned` |
| `app_status_date` | TEXT | Date of current status |
| `app_type` | TEXT | e.g., `Utility`, `Design`, `Provisional` |
| `first_inventor` | TEXT | First named inventor |
| `first_applicant` | TEXT | First named applicant |
| `examiner` | TEXT | Assigned examiner |
| `group_art_unit` | TEXT | Art unit number (e.g., `1693`) |
| `cpc_classifications` | TEXT | Pipe-separated CPC codes |
| `docket_number` | TEXT | Attorney docket number |
| `pub_number` | TEXT | Publication number |
| `pub_date` | TEXT | Publication date |
| `customer_number` | INTEGER | USPTO customer number |
| `raw_json` | TEXT | **Complete API response** — nothing is lost |
| `source` | TEXT | `search` or `detail` |
| `chunk_id` | TEXT | Which chunk fetched this record |
| `fetched_at` | TEXT | Timestamp |

### `chunks`

Tracks the progress of each date-range chunk (for resume).

| Column | Type | Description |
|---|---|---|
| `chunk_id` | TEXT (PK) | e.g., `2023-01-01_2023-06-30` or `null-dates` |
| `date_from` | TEXT | Start date |
| `date_to` | TEXT | End date |
| `query` | TEXT | The Lucene query for this chunk |
| `expected_count` | INTEGER | Probed record count |
| `fetched_count` | INTEGER | Actual records fetched |
| `status` | TEXT | `pending`, `in_progress`, `done`, `error` |
| `error_message` | TEXT | Error details if failed |

### `detail_queue`

Tracks which applications need full detail fetches.

| Column | Type | Description |
|---|---|---|
| `application_number` | TEXT (PK) | Application to fetch |
| `status` | TEXT | `pending`, `in_progress`, `done`, `error` |
| `error_message` | TEXT | Error details if failed |
| `retry_count` | INTEGER | Number of retry attempts (max 3) |

---

## Export Format

### JSON

A JSON array of complete API response objects. Each element is the raw, unmodified response from the USPTO API:

```json
[
  {
    "applicationNumberText": "16123456",
    "applicationMetaData": {
      "inventionTitle": "Method for ...",
      "filingDate": "2023-01-15",
      "firstApplicantName": "ACME Corp",
      ...
    },
    "prosecutionHistoryBag": [...],
    "assignmentBag": [...],
    "correspondenceAddressBag": [...],
    ...
  },
  ...
]
```

### CSV

A flat file with 21 columns. Array fields (inventors, applicants, assignees) are pipe-separated within a single column.

| Column | Example Value |
|---|---|
| `application_number` | `16123456` |
| `invention_title` | `Method for Treating Disease` |
| `filing_date` | `2023-01-15` |
| `patent_number` | `US11234567B2` |
| `grant_date` | `2024-06-01` |
| `app_status` | `Patented Case` |
| `app_status_date` | `2024-06-01` |
| `app_type` | `Utility` |
| `first_inventor` | `John Smith` |
| `first_applicant` | `ACME Corp` |
| `examiner` | `DOE, JANE` |
| `group_art_unit` | `1693` |
| `cpc_classifications` | `A61B 5/0833 \| A61K 31/00` |
| `docket_number` | `ACM-2023-001` |
| `pub_number` | `US20230012345A1` |
| `pub_date` | `2023-07-15` |
| `customer_number` | `12345` |
| `all_inventors` | `John Smith \| Jane Doe \| Bob Lee` |
| `all_applicants` | `ACME Corp` |
| `all_assignees` | `ACME CORPORATION` |
| `correspondence_address` | `POLSINELLI PC, 900 W 48th Pl, Kansas City, MO, 64112, US` |

---

## Data Preview

You can inspect the SQLite database before exporting using [Datasette](https://datasette.io/):

```bash
# Install (one-time)
brew install pipx
pipx install datasette

# Launch browser UI
datasette data/polsinelli.db --port 8001
```

Open http://localhost:8001 to browse tables, filter, sort, and run SQL queries.

Alternatively, install [DB Browser for SQLite](https://sqlitebrowser.org/):

```bash
brew install --cask db-browser-for-sqlite
```

---

## Examples

### Fetch all Apple patents

```bash
npm run cli:search -- -q 'applicationMetaData.firstApplicantName:Apple*'
npm run cli:details
npm run cli:export
```

### Fetch Polsinelli biotech/pharma correspondence

```bash
npm run cli:search -- \
  -q '(correspondenceAddressBag.nameLineOneText:*POLSINELLI* OR correspondenceAddressBag.nameLineTwoText:*POLSINELLI*) AND (applicationMetaData.groupArtUnitNumber:16* OR applicationMetaData.groupArtUnitNumber:17*)' \
  --db ./data/polsinelli.db
npm run cli:details -- --db ./data/polsinelli.db
npm run cli:export -- --db ./data/polsinelli.db
```

### Test with a small subset

```bash
# Only records filed in 2023
npm run cli:search -- \
  -q 'applicationMetaData.firstApplicantName:Apple*' \
  --date-from 2023-01-01 --date-to 2023-12-31

# Only fetch 50 detail records
npm run cli:details -- --limit 50
```

### Dry run to estimate workload

```bash
npm run cli:search -- \
  -q 'correspondenceAddressBag.nameLineOneText:"foley & lardner*"' \
  --dry-run
```

### Export only JSON, only detail-enriched records

```bash
npm run cli:export -- --format json --source detail
```

### Check status mid-run

```bash
npm run cli:status -- --db ./data/polsinelli.db
```

### Resume after crash or Ctrl+C

Just run the exact same command again. Done chunks are skipped automatically:

```bash
# First run — interrupted after 3,000 records
npm run cli:search -- -q 'applicationMetaData.firstApplicantName:Apple*'
# (Ctrl+C)

# Second run — picks up from record 3,001
npm run cli:search -- -q 'applicationMetaData.firstApplicantName:Apple*'
```

### Use a different database per query

```bash
npm run cli:search -- -q 'firstApplicantName:Apple*' --db ./data/apple.db
npm run cli:search -- -q 'firstApplicantName:Google*' --db ./data/google.db
```

---

## Troubleshooting

### HTTP 429 — Rate Limited

The API rate-limits aggressive clients. The pipeline handles this automatically with exponential backoff (5s, 10s, 20s). If you see frequent 429s, reduce concurrency:

```bash
npm run cli:search -- -q '...' --concurrency 2
```

### HTTP 413 — Payload Too Large

The default page size is 25 records. If you still see 413 errors, the records may be unusually large. The page size is set in `cli/config.ts` (`pageSize`).

### "No API key found"

Ensure `.env` exists in the project root with either `USPTO_API_KEY=...` or `VITE_USPTO_API_KEY=...`.

### Resume picks up old query data

Each database file stores one query's results. If you run a different query against the same database, the pipeline will try to resume the old query. **Use a separate `--db` path for each query:**

```bash
npm run cli:search -- -q 'firstApplicantName:Apple*' --db ./data/apple.db
npm run cli:search -- -q 'firstApplicantName:Google*' --db ./data/google.db
```

Or delete the old database first: `rm -rf data/`

### Record count mismatch

The total from the API probe may slightly exceed the unique records in the database. This happens when the same application appears in multiple date-range chunks (overlapping boundaries). Duplicates are safely deduplicated by the primary key (`application_number`). A difference of <0.1% is normal.

### WARNING: chunk has >10K records

If a single 1-month chunk still exceeds 10,000 records, some records in that chunk will be unreachable due to the API's offset limit. This is rare — it would require >10,000 matching records filed in a single month. The warning is informational; all other chunks are unaffected.

---

## File Structure

```
cli/
  main.ts              Entry point. Parses CLI commands via Commander.
  config.ts            Loads API key from .env, merges defaults with CLI flags.
  api-client.ts        HTTP layer: fetch with retry, exponential backoff,
                       pagination, date-range chunking, probe queries.
  db.ts                SQLite schema, CRUD operations, atomic chunk/detail
                       claiming, stats, streaming iteration.
  search-worker.ts     Worker loop for search phase: claim chunk → fetch pages
                       → write to DB → repeat.
  detail-worker.ts     Worker loop for detail phase: claim app → fetch full
                       record → write to DB → repeat.
  pipeline.ts          Orchestrator: probe → plan chunks → launch workers →
                       report results. Contains both search and detail pipelines.
  progress.ts          Terminal progress bars (multi-bar for TTY, periodic
                       logging for non-TTY/CI environments).
  export-streaming.ts  Streaming JSON and CSV writers. Constant memory usage
                       via SQLite cursor iteration.
```
