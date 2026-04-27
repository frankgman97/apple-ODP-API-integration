import type Database from 'better-sqlite3';
import type { PipelineConfig } from './config.js';
import {
  probeCount,
  generateDateRanges,
  MAX_OFFSET,
} from './api-client.js';
import {
  openDatabase,
  insertChunks,
  getExistingChunks,
  resetInProgressChunks,
  resetErroredChunks,
  getStats,
  populateDetailQueue,
  resetInProgressDetails,
  countPatents,
} from './db.js';
import { runSearchWorker } from './search-worker.js';
import { runDetailWorker } from './detail-worker.js';
import { createProgressTracker, createSimpleLogger } from './progress.js';

// ─── Search Pipeline ────────────────────────────────────

export interface SearchOpts {
  query: string;
  config: PipelineConfig;
  dateFrom?: string;
  dateTo?: string;
  dryRun?: boolean;
}

export async function runSearchPipeline(opts: SearchOpts): Promise<void> {
  const { query, config, dateFrom, dateTo, dryRun } = opts;
  const db = openDatabase(config.dbPath);

  try {
    // Check for existing chunks (resume)
    const existing = getExistingChunks(db);
    if (existing.length > 0) {
      const stats = getStats(db);
      const resetIP = resetInProgressChunks(db);
      const resetErr = resetErroredChunks(db);
      const totalReset = resetIP + resetErr;
      console.log(`\nResuming previous run:`);
      console.log(`  Chunks: ${stats.chunks.done} done, ${stats.chunks.pending + totalReset} pending (reset ${resetErr} errored, ${resetIP} in-progress)`);
      console.log(`  Records in DB: ${stats.patents.total}`);
    } else {
      // Fresh run: probe and create chunks
      console.log(`\nProbing total count for: ${query}`);
      const probe = await probeCount(query, config.apiKey);
      console.log(`  Total records: ${probe.count.toLocaleString()}`);

      if (probe.count === 0) {
        console.log('  No results found. Exiting.');
        return;
      }

      const startDate = dateFrom ?? probe.oldestDate ?? '2001-01-01';
      const endDate = dateTo ?? probe.newestDate ?? new Date().toISOString().split('T')[0];
      console.log(`  Date range: ${startDate} → ${endDate}`);

      // Generate initial chunks
      let ranges = generateDateRanges(startDate, endDate, config.chunkMonths);
      console.log(`  Initial chunks: ${ranges.length} (${config.chunkMonths}-month intervals)`);

      // Probe each chunk and subdivide if > MAX_OFFSET
      console.log(`  Probing chunk sizes...`);
      const finalChunks: { chunkId: string; dateFrom: string; dateTo: string; query: string; expectedCount: number | null }[] = [];

      for (const range of ranges) {
        const rangeProbe = await probeCount(query, config.apiKey, {
          field: 'applicationMetaData.filingDate',
          valueFrom: range.from,
          valueTo: range.to,
        });

        if (rangeProbe.count === 0) {
          console.log(`    ${range.from} → ${range.to}: 0 records (skipping)`);
          continue;
        }

        if (rangeProbe.count > MAX_OFFSET) {
          // Subdivide into 1-month chunks
          console.log(`    ${range.from} → ${range.to}: ${rangeProbe.count.toLocaleString()} records (subdividing)`);
          const subRanges = generateDateRanges(range.from, range.to, 1);
          for (const sub of subRanges) {
            const subProbe = await probeCount(query, config.apiKey, {
              field: 'applicationMetaData.filingDate',
              valueFrom: sub.from,
              valueTo: sub.to,
            });
            if (subProbe.count === 0) continue;
            if (subProbe.count > MAX_OFFSET) {
              console.warn(`    WARNING: ${sub.from} → ${sub.to} has ${subProbe.count} records (>10K). Some may be missed.`);
            }
            finalChunks.push({
              chunkId: `${sub.from}_${sub.to}`,
              dateFrom: sub.from,
              dateTo: sub.to,
              query,
              expectedCount: subProbe.count,
            });
          }
        } else {
          console.log(`    ${range.from} → ${range.to}: ${rangeProbe.count.toLocaleString()} records`);
          finalChunks.push({
            chunkId: `${range.from}_${range.to}`,
            dateFrom: range.from,
            dateTo: range.to,
            query,
            expectedCount: rangeProbe.count,
          });
        }
      }

      // EDGE CASE: Records with null/missing filingDate are not captured by
      // date-range filters (rangeFilters only match records that HAVE a date).
      // We add a special chunk that queries for these explicitly using:
      //   originalQuery AND NOT applicationMetaData.filingDate:[* TO *]
      // This ensures we capture 100% of matching records.
      const nullDateQuery = `${query} AND NOT applicationMetaData.filingDate:[* TO *]`;
      const nullProbe = await probeCount(nullDateQuery, config.apiKey);
      if (nullProbe.count > 0) {
        console.log(`    (null filing dates): ${nullProbe.count} records`);
        finalChunks.push({
          chunkId: 'null-dates',
          dateFrom: '',
          dateTo: '',
          query: nullDateQuery,
          expectedCount: nullProbe.count,
        });
      }

      console.log(`\n  Final chunks: ${finalChunks.length}`);
      const totalExpected = finalChunks.reduce((s, c) => s + (c.expectedCount ?? 0), 0);
      console.log(`  Expected total records: ${totalExpected.toLocaleString()}`);

      if (dryRun) {
        console.log(`\n  DRY RUN — no data fetched. Chunk plan above.`);
        return;
      }

      // Save chunks to DB
      insertChunks(db, finalChunks);
    }

    // Launch concurrent workers
    const totalExpected = getExistingChunks(db).reduce((s, c) => s + (c.expected_count ?? 0), 0);
    const isTTY = process.stdout.isTTY;
    let progress: ReturnType<typeof createProgressTracker> | null = null;
    let logger: ReturnType<typeof createSimpleLogger> | null = null;
    let globalFetched = countPatents(db);

    if (isTTY) {
      progress = createProgressTracker('Search Phase', config.concurrency, totalExpected);
      progress.updateOverall(globalFetched);
    } else {
      logger = createSimpleLogger('Search Phase');
    }

    const controller = new AbortController();
    process.on('SIGINT', () => {
      if (progress) {
        progress.log('\nGracefully stopping... (records already saved are safe)');
      } else {
        console.log('\n\nGracefully stopping... (records already saved are safe)');
      }
      controller.abort();
    });

    const workers = Array.from({ length: config.concurrency }, (_, i) =>
      runSearchWorker({
        workerId: i,
        db,
        apiKey: config.apiKey,
        pageSize: config.pageSize,
        rateLimitDelay: config.rateLimitDelay,
        onProgress: (wid, fetched, total, label) => {
          globalFetched = countPatents(db);
          if (progress) {
            progress.update(wid, fetched, total, label);
            progress.updateOverall(globalFetched);
          } else {
            logger?.log(globalFetched, totalExpected, label);
          }
        },
        onError: (wid, chunkId, msg) => {
          if (progress) {
            progress.log(`  Worker ${wid}: Error on chunk ${chunkId}: ${msg}`);
          } else {
            console.error(`  Worker ${wid}: Error on chunk ${chunkId}: ${msg}`);
          }
        },
        signal: controller.signal,
      }),
    );

    await Promise.allSettled(workers);

    if (progress) progress.stop();

    // Final stats
    const stats = getStats(db);
    console.log(`\nSearch complete.`);
    console.log(`  Records in DB: ${stats.patents.total.toLocaleString()}`);
    console.log(`  Chunks: ${stats.chunks.done} done, ${stats.chunks.error} errored`);

    if (stats.chunks.error > 0) {
      console.log(`  Run again to retry errored chunks.`);
    }

    // Populate detail queue
    const queued = populateDetailQueue(db);
    if (queued > 0) {
      console.log(`  Queued ${queued.toLocaleString()} applications for detail fetch.`);
    }
    console.log(`  Run 'npm run cli:details' to fetch full records.`);
  } finally {
    db.close();
  }
}

// ─── Detail Pipeline ────────────────────────────────────

export interface DetailOpts {
  config: PipelineConfig;
  limit?: number;
  retryErrors?: boolean;
}

export async function runDetailPipeline(opts: DetailOpts): Promise<void> {
  const { config, limit } = opts;
  const db = openDatabase(config.dbPath);

  try {
    const reset = resetInProgressDetails(db);
    if (reset > 0) console.log(`Reset ${reset} in-progress details to pending`);

    const stats = getStats(db);
    const pending = stats.details.pending + stats.details.error;
    if (pending === 0) {
      console.log('No pending detail fetches. Run search first.');
      return;
    }

    const target = limit ? Math.min(limit, pending) : pending;
    console.log(`\nFetching details: ${target.toLocaleString()} applications (${config.concurrency} workers)`);

    const isTTY = process.stdout.isTTY;
    let progress: ReturnType<typeof createProgressTracker> | null = null;
    let logger: ReturnType<typeof createSimpleLogger> | null = null;
    let globalDone = stats.details.done;

    const detailTotal = globalDone + target;

    if (isTTY) {
      progress = createProgressTracker('Detail Phase', config.concurrency, detailTotal);
      progress.updateOverall(globalDone);
    } else {
      logger = createSimpleLogger('Detail Phase');
    }

    const controller = new AbortController();
    process.on('SIGINT', () => {
      if (progress) {
        progress.log('\nGracefully stopping...');
      } else {
        console.log('\n\nGracefully stopping...');
      }
      controller.abort();
    });

    const workers = Array.from({ length: config.concurrency }, (_, i) =>
      runDetailWorker({
        workerId: i,
        db,
        apiKey: config.apiKey,
        rateLimitDelay: config.rateLimitDelay,
        onProgress: (wid, appNo, workerDone) => {
          globalDone++;
          if (progress) {
            progress.update(wid, workerDone, 0, appNo);
            progress.updateOverall(globalDone);
          } else {
            logger?.log(globalDone - stats.details.done, target, appNo);
          }
          // Respect limit
          if (limit && globalDone - stats.details.done >= limit) {
            controller.abort();
          }
        },
        signal: controller.signal,
      }),
    );

    await Promise.allSettled(workers);

    if (progress) progress.stop();

    const finalStats = getStats(db);
    console.log(`\nDetail fetch complete.`);
    console.log(`  Done: ${finalStats.details.done} | Errors: ${finalStats.details.error} | Pending: ${finalStats.details.pending}`);
    console.log(`  Run 'npm run cli:export' to export data.`);
  } finally {
    db.close();
  }
}

// ─── Status ─────────────────────────────────────────────

export function showStatus(dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const stats = getStats(db);
    const query = db.prepare(`SELECT query FROM chunks LIMIT 1`).get() as { query: string } | undefined;

    console.log(`\nPipeline Status`);
    console.log(`═══════════════════════════════════════`);
    console.log(`Database: ${dbPath}`);
    if (query) console.log(`Query: ${query.query}`);

    console.log(`\nChunks:`);
    console.log(`  Total: ${stats.chunks.total} | Done: ${stats.chunks.done} | Pending: ${stats.chunks.pending} | Errors: ${stats.chunks.error}`);

    console.log(`\nPatent Records:`);
    console.log(`  Total: ${stats.patents.total.toLocaleString()} | Search: ${stats.patents.search.toLocaleString()} | Detail: ${stats.patents.detail.toLocaleString()}`);

    console.log(`\nDetail Queue:`);
    console.log(`  Total: ${stats.details.total.toLocaleString()} | Done: ${stats.details.done.toLocaleString()} | Pending: ${stats.details.pending.toLocaleString()} | Errors: ${stats.details.error.toLocaleString()}`);
  } finally {
    db.close();
  }
}
