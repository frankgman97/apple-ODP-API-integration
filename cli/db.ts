import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// ─── Types ──────────────────────────────────────────────

export interface ChunkRow {
  chunk_id: string;
  date_from: string;
  date_to: string;
  query: string;
  expected_count: number | null;
  fetched_count: number;
  status: 'pending' | 'in_progress' | 'done' | 'error';
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface PatentRow {
  application_number: string;
  invention_title: string | null;
  filing_date: string | null;
  patent_number: string | null;
  grant_date: string | null;
  app_status: string | null;
  app_status_date: string | null;
  app_type: string | null;
  first_inventor: string | null;
  first_applicant: string | null;
  examiner: string | null;
  group_art_unit: string | null;
  cpc_classifications: string | null;
  docket_number: string | null;
  pub_number: string | null;
  pub_date: string | null;
  customer_number: number | null;
  raw_json: string;
  source: string;
  chunk_id: string | null;
  fetched_at: string;
}

export interface DetailQueueRow {
  application_number: string;
  status: 'pending' | 'in_progress' | 'done' | 'error';
  error_message: string | null;
  retry_count: number;
  fetched_at: string | null;
}

export interface PipelineStats {
  chunks: { total: number; pending: number; in_progress: number; done: number; error: number };
  patents: { total: number; search: number; detail: number };
  details: { total: number; pending: number; done: number; error: number };
}

// ─── Schema ─────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id       TEXT PRIMARY KEY,
  date_from      TEXT NOT NULL,
  date_to        TEXT NOT NULL,
  query          TEXT NOT NULL,
  expected_count INTEGER,
  fetched_count  INTEGER DEFAULT 0,
  status         TEXT DEFAULT 'pending',
  error_message  TEXT,
  started_at     TEXT,
  completed_at   TEXT
);

CREATE TABLE IF NOT EXISTS patents (
  application_number TEXT PRIMARY KEY,
  invention_title    TEXT,
  filing_date        TEXT,
  patent_number      TEXT,
  grant_date         TEXT,
  app_status         TEXT,
  app_status_date    TEXT,
  app_type           TEXT,
  first_inventor     TEXT,
  first_applicant    TEXT,
  examiner           TEXT,
  group_art_unit     TEXT,
  cpc_classifications TEXT,
  docket_number      TEXT,
  pub_number         TEXT,
  pub_date           TEXT,
  customer_number    INTEGER,
  raw_json           TEXT NOT NULL,
  source             TEXT DEFAULT 'search',
  chunk_id           TEXT,
  fetched_at         TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS detail_queue (
  application_number TEXT PRIMARY KEY,
  status             TEXT DEFAULT 'pending',
  error_message      TEXT,
  retry_count        INTEGER DEFAULT 0,
  fetched_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_patents_filing_date ON patents(filing_date);
CREATE INDEX IF NOT EXISTS idx_patents_app_type ON patents(app_type);
CREATE INDEX IF NOT EXISTS idx_detail_queue_status ON detail_queue(status);
`;

// ─── Database helpers ───────────────────────────────────

export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** Extract flat fields from raw API JSON for the patents table columns. */
function extractFlat(raw: Record<string, unknown>): Record<string, unknown> {
  const meta = (raw.applicationMetaData ?? {}) as Record<string, unknown>;
  const cpc = Array.isArray(meta.cpcClassificationBag)
    ? (meta.cpcClassificationBag as string[]).map((s) => s.trim()).join(' | ')
    : null;
  return {
    invention_title: meta.inventionTitle ?? null,
    filing_date: meta.filingDate ?? null,
    patent_number: meta.patentNumber ?? null,
    grant_date: meta.grantDate ?? null,
    app_status: meta.applicationStatusDescriptionText ?? null,
    app_status_date: meta.applicationStatusDate ?? null,
    app_type: meta.applicationTypeLabelName ?? null,
    first_inventor: meta.firstInventorName ?? null,
    first_applicant: meta.firstApplicantName ?? null,
    examiner: meta.examinerNameText ?? null,
    group_art_unit: meta.groupArtUnitNumber ?? null,
    cpc_classifications: cpc,
    docket_number: meta.docketNumber ?? null,
    pub_number: meta.earliestPublicationNumber ?? null,
    pub_date: meta.earliestPublicationDate ?? null,
    customer_number: meta.customerNumber ?? null,
  };
}

const UPSERT_SQL = `
  INSERT OR REPLACE INTO patents (
    application_number, invention_title, filing_date, patent_number,
    grant_date, app_status, app_status_date, app_type,
    first_inventor, first_applicant, examiner, group_art_unit,
    cpc_classifications, docket_number, pub_number, pub_date,
    customer_number, raw_json, source, chunk_id
  ) VALUES (
    @application_number, @invention_title, @filing_date, @patent_number,
    @grant_date, @app_status, @app_status_date, @app_type,
    @first_inventor, @first_applicant, @examiner, @group_art_unit,
    @cpc_classifications, @docket_number, @pub_number, @pub_date,
    @customer_number, @raw_json, @source, @chunk_id
  )
`;

/** Insert a batch of patent records inside a transaction. */
export function upsertPatentBatch(
  db: Database.Database,
  records: Record<string, unknown>[],
  chunkId: string,
  source: string,
): void {
  const insert = db.prepare(UPSERT_SQL);
  const tx = db.transaction((recs: Record<string, unknown>[]) => {
    for (const raw of recs) {
      const flat = extractFlat(raw);
      insert.run({
        application_number: raw.applicationNumberText,
        ...flat,
        raw_json: JSON.stringify(raw),
        source,
        chunk_id: chunkId,
      });
    }
  });
  tx(records);
}

// ─── Chunk management ───────────────────────────────────

export function insertChunks(
  db: Database.Database,
  chunks: { chunkId: string; dateFrom: string; dateTo: string; query: string; expectedCount: number | null }[],
): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO chunks (chunk_id, date_from, date_to, query, expected_count)
     VALUES (@chunk_id, @date_from, @date_to, @query, @expected_count)`,
  );
  const tx = db.transaction(() => {
    for (const c of chunks) {
      insert.run({
        chunk_id: c.chunkId,
        date_from: c.dateFrom,
        date_to: c.dateTo,
        query: c.query,
        expected_count: c.expectedCount,
      });
    }
  });
  tx();
}

export function claimNextChunk(db: Database.Database): ChunkRow | null {
  const claim = db.transaction(() => {
    const row = db
      .prepare(`SELECT * FROM chunks WHERE status = 'pending' ORDER BY date_from LIMIT 1`)
      .get() as ChunkRow | undefined;
    if (!row) return null;
    db.prepare(
      `UPDATE chunks SET status = 'in_progress', started_at = datetime('now') WHERE chunk_id = ?`,
    ).run(row.chunk_id);
    return row;
  });
  return claim();
}

export function updateChunkProgress(db: Database.Database, chunkId: string, fetchedCount: number): void {
  db.prepare(`UPDATE chunks SET fetched_count = ? WHERE chunk_id = ?`).run(fetchedCount, chunkId);
}

export function markChunkDone(db: Database.Database, chunkId: string, fetchedCount: number): void {
  db.prepare(
    `UPDATE chunks SET status = 'done', fetched_count = ?, completed_at = datetime('now') WHERE chunk_id = ?`,
  ).run(fetchedCount, chunkId);
}

export function markChunkError(db: Database.Database, chunkId: string, error: string): void {
  db.prepare(
    `UPDATE chunks SET status = 'error', error_message = ?, completed_at = datetime('now') WHERE chunk_id = ?`,
  ).run(error, chunkId);
}

export function resetInProgressChunks(db: Database.Database): number {
  const result = db
    .prepare(`UPDATE chunks SET status = 'pending', started_at = NULL WHERE status = 'in_progress'`)
    .run();
  return result.changes;
}

export function resetErroredChunks(db: Database.Database): number {
  const result = db
    .prepare(`UPDATE chunks SET status = 'pending', error_message = NULL, started_at = NULL, completed_at = NULL WHERE status = 'error'`)
    .run();
  return result.changes;
}

export function getExistingChunks(db: Database.Database): ChunkRow[] {
  return db.prepare(`SELECT * FROM chunks ORDER BY date_from`).all() as ChunkRow[];
}

// ─── Detail queue ───────────────────────────────────────

export function populateDetailQueue(db: Database.Database): number {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO detail_queue (application_number)
       SELECT application_number FROM patents`,
    )
    .run();
  return result.changes;
}

export function claimNextDetail(db: Database.Database): string | null {
  const claim = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT application_number FROM detail_queue
         WHERE status = 'pending' OR (status = 'error' AND retry_count < 3)
         ORDER BY status, application_number LIMIT 1`,
      )
      .get() as { application_number: string } | undefined;
    if (!row) return null;
    db.prepare(
      `UPDATE detail_queue SET status = 'in_progress' WHERE application_number = ?`,
    ).run(row.application_number);
    return row.application_number;
  });
  return claim();
}

export function markDetailDone(db: Database.Database, appNo: string): void {
  db.prepare(
    `UPDATE detail_queue SET status = 'done', fetched_at = datetime('now') WHERE application_number = ?`,
  ).run(appNo);
}

export function markDetailDoneBatch(db: Database.Database, appNos: string[]): void {
  const stmt = db.prepare(
    `UPDATE detail_queue SET status = 'done', fetched_at = datetime('now') WHERE application_number = ?`,
  );
  const tx = db.transaction(() => {
    for (const appNo of appNos) {
      stmt.run(appNo);
    }
  });
  tx();
}

export function markDetailError(db: Database.Database, appNo: string, error: string): void {
  db.prepare(
    `UPDATE detail_queue SET status = 'error', error_message = ?, retry_count = retry_count + 1
     WHERE application_number = ?`,
  ).run(error, appNo);
}

export function resetInProgressDetails(db: Database.Database): number {
  const result = db
    .prepare(`UPDATE detail_queue SET status = 'pending' WHERE status = 'in_progress'`)
    .run();
  return result.changes;
}

// ─── Stats ──────────────────────────────────────────────

export function getStats(db: Database.Database): PipelineStats {
  const chunkRows = db
    .prepare(
      `SELECT status, COUNT(*) as cnt FROM chunks GROUP BY status`,
    )
    .all() as { status: string; cnt: number }[];
  const chunkMap: Record<string, number> = {};
  for (const r of chunkRows) chunkMap[r.status] = r.cnt;

  const patentCounts = db
    .prepare(`SELECT source, COUNT(*) as cnt FROM patents GROUP BY source`)
    .all() as { source: string; cnt: number }[];
  const patentMap: Record<string, number> = {};
  for (const r of patentCounts) patentMap[r.source] = r.cnt;

  const detailRows = db
    .prepare(`SELECT status, COUNT(*) as cnt FROM detail_queue GROUP BY status`)
    .all() as { status: string; cnt: number }[];
  const detailMap: Record<string, number> = {};
  for (const r of detailRows) detailMap[r.status] = r.cnt;

  const totalChunks = Object.values(chunkMap).reduce((a, b) => a + b, 0);
  const totalPatents = Object.values(patentMap).reduce((a, b) => a + b, 0);
  const totalDetails = Object.values(detailMap).reduce((a, b) => a + b, 0);

  return {
    chunks: {
      total: totalChunks,
      pending: chunkMap['pending'] ?? 0,
      in_progress: chunkMap['in_progress'] ?? 0,
      done: chunkMap['done'] ?? 0,
      error: chunkMap['error'] ?? 0,
    },
    patents: {
      total: totalPatents,
      search: patentMap['search'] ?? 0,
      detail: patentMap['detail'] ?? 0,
    },
    details: {
      total: totalDetails,
      pending: detailMap['pending'] ?? 0,
      done: detailMap['done'] ?? 0,
      error: detailMap['error'] ?? 0,
    },
  };
}

/** Iterate over all patent rows (lazy — one row at a time). */
export function iteratePatents(
  db: Database.Database,
  source?: string,
): IterableIterator<PatentRow> {
  if (source) {
    return db
      .prepare(`SELECT * FROM patents WHERE source = ? ORDER BY filing_date`)
      .iterate(source) as IterableIterator<PatentRow>;
  }
  return db
    .prepare(`SELECT * FROM patents ORDER BY filing_date`)
    .iterate() as IterableIterator<PatentRow>;
}

export function countPatents(db: Database.Database, source?: string): number {
  if (source) {
    const row = db
      .prepare(`SELECT COUNT(*) as cnt FROM patents WHERE source = ?`)
      .get(source) as { cnt: number };
    return row.cnt;
  }
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM patents`).get() as { cnt: number };
  return row.cnt;
}
