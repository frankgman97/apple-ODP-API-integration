import type Database from 'better-sqlite3';
import { fetchDetail, delay } from './api-client.js';
import {
  claimNextDetail,
  markDetailDoneBatch,
  markDetailError,
  upsertPatentBatch,
} from './db.js';

export interface DetailWorkerOpts {
  workerId: number;
  db: Database.Database;
  apiKey: string;
  rateLimitDelay: number;
  onProgress?: (workerId: number, appNo: string, done: number) => void;
  signal?: AbortSignal;
}

const BATCH_SIZE = 20;

/**
 * Worker loop: claim application numbers from the detail queue,
 * fetch full records, and update the DB. Runs until queue is empty.
 * Buffers writes in batches of BATCH_SIZE for efficiency.
 */
export async function runDetailWorker(opts: DetailWorkerOpts): Promise<number> {
  const { workerId, db, apiKey, rateLimitDelay, onProgress, signal } = opts;
  let done = 0;
  const pendingWrites: { record: Record<string, unknown>; appNo: string }[] = [];

  function flushBatch() {
    if (pendingWrites.length === 0) return;
    const batch = pendingWrites.splice(0);
    upsertPatentBatch(db, batch.map((b) => b.record), '', 'detail');
    markDetailDoneBatch(db, batch.map((b) => b.appNo));
  }

  while (true) {
    if (signal?.aborted) break;

    const appNo = claimNextDetail(db);
    if (!appNo) break; // no more pending details

    try {
      const record = await fetchDetail(appNo, apiKey);
      pendingWrites.push({ record, appNo });
      done++;
      onProgress?.(workerId, appNo, done);

      if (pendingWrites.length >= BATCH_SIZE) {
        flushBatch();
      }

      await delay(rateLimitDelay);
    } catch (err) {
      flushBatch();
      markDetailError(db, appNo, (err as Error).message);
      // No delay after errors — fetchWithRetry already has backoff
    }
  }

  // Flush remaining
  flushBatch();
  return done;
}
