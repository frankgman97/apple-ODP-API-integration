import type Database from 'better-sqlite3';
import {
  fetchChunkPages,
  type DateRange,
} from './api-client.js';
import {
  claimNextChunk,
  upsertPatentBatch,
  updateChunkProgress,
  markChunkDone,
  markChunkError,
} from './db.js';

export interface SearchWorkerOpts {
  workerId: number;
  db: Database.Database;
  apiKey: string;
  pageSize: number;
  rateLimitDelay: number;
  onProgress?: (workerId: number, fetched: number, total: number, label: string) => void;
  onError?: (workerId: number, chunkId: string, message: string) => void;
  signal?: AbortSignal;
}

/**
 * Worker loop: claim chunks from DB and fetch them until none remain.
 * Returns total number of records fetched.
 */
export async function runSearchWorker(opts: SearchWorkerOpts): Promise<number> {
  const { workerId, db, apiKey, pageSize, rateLimitDelay, onProgress, onError, signal } = opts;
  let totalFetched = 0;

  while (true) {
    if (signal?.aborted) break;

    const chunk = claimNextChunk(db);
    if (!chunk) break; // no more pending chunks

    // Special "null-dates" chunk has empty date_from/date_to —
    // these are records with no filing date that date-range filters miss
    const isNullDateChunk = chunk.chunk_id === 'null-dates';
    const dateRange = isNullDateChunk ? null : { from: chunk.date_from, to: chunk.date_to };
    const label = isNullDateChunk ? 'null filing dates' : `${chunk.date_from} → ${chunk.date_to}`;

    try {
      let chunkFetched = 0;

      const fetched = await fetchChunkPages(
        chunk.query,
        dateRange,
        apiKey,
        pageSize,
        rateLimitDelay,
        (records, _offset, total) => {
          // Write page to DB immediately
          upsertPatentBatch(db, records, chunk.chunk_id, 'search');
          chunkFetched += records.length;
          updateChunkProgress(db, chunk.chunk_id, chunkFetched);
          onProgress?.(workerId, chunkFetched, chunk.expected_count ?? total, label);
        },
        signal,
      );

      markChunkDone(db, chunk.chunk_id, fetched);
      totalFetched += fetched;
      onProgress?.(workerId, fetched, fetched, `${label} DONE`);
    } catch (err) {
      const msg = (err as Error).message;
      markChunkError(db, chunk.chunk_id, msg);
      if (onError) {
        onError(workerId, chunk.chunk_id, msg);
      } else {
        console.error(`  Worker ${workerId}: Error on chunk ${chunk.chunk_id}: ${msg}`);
      }
    }
  }

  return totalFetched;
}
