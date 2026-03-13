import type { SearchRequest, SearchResponse, LogEntry } from './types';

let logCallback: ((entry: LogEntry) => void) | null = null;

export function onLog(cb: (entry: LogEntry) => void) {
  logCallback = cb;
}

export function log(entry: LogEntry) {
  logCallback?.(entry);
}

let _delayImpl = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function delay(ms: number) {
  return _delayImpl(ms);
}

/** Override delay for testing. Returns a restore function. */
export function _setDelayImpl(fn: (ms: number) => Promise<void>): () => void {
  const original = _delayImpl;
  _delayImpl = fn;
  return () => { _delayImpl = original; };
}

// --- ODP Search (api.uspto.gov) ---

export async function searchODP(
  request: SearchRequest,
  apiKey: string,
): Promise<{ data: SearchResponse; raw: unknown }> {
  const url = '/api/uspto/v1/patent/applications/search';
  const start = performance.now();

  const entry: LogEntry = { timestamp: new Date(), method: 'POST', url };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    entry.status = res.status;
    entry.durationMs = Math.round(performance.now() - start);

    if (!res.ok) {
      const text = await res.text();
      entry.error = text;
      log(entry);
      throw new Error(`USPTO ODP ${res.status}: ${text}`);
    }

    const raw = await res.json();
    log(entry);
    return { data: raw as SearchResponse, raw };
  } catch (err) {
    entry.durationMs = Math.round(performance.now() - start);
    if (!entry.error) entry.error = String(err);
    log(entry);
    throw err;
  }
}

// --- Direct Lookup (api.uspto.gov) ---

export async function fetchApplicationDetails(
  appNo: string,
  apiKey: string,
): Promise<{ data: unknown; raw: unknown }> {
  const clean = appNo.replace(/[\/,\-\s]/g, '');
  const url = `/api/uspto/v1/patent/applications/${clean}`;
  const start = performance.now();

  const entry: LogEntry = { timestamp: new Date(), method: 'GET', url };

  try {
    const res = await fetch(url, {
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
      },
    });

    entry.status = res.status;
    entry.durationMs = Math.round(performance.now() - start);

    if (!res.ok) {
      const text = await res.text();
      entry.error = text;
      log(entry);
      throw new Error(`USPTO API ${res.status}: ${text}`);
    }

    const raw = await res.json();
    log(entry);
    return { data: raw, raw };
  } catch (err) {
    entry.durationMs = Math.round(performance.now() - start);
    if (!entry.error) entry.error = String(err);
    log(entry);
    throw err;
  }
}

// --- Batch: Fetch All Search Pages ---

export const MAX_OFFSET = 10000;
export const RATE_LIMIT_DELAY = 250; // ms between requests
export const RATE_LIMIT_BACKOFF = 5000; // ms on 429

export async function fetchPages(
  request: SearchRequest,
  apiKey: string,
  limit: number,
  maxResults: number,
  onProgress: (fetched: number, sliceTotal: number) => void,
  signal?: AbortSignal,
): Promise<{ results: SearchResponse['patentFileWrapperDataBag']; raw: unknown[]; count: number }> {
  let offset = 0;
  let total = Infinity;
  const results: SearchResponse['patentFileWrapperDataBag'] = [];
  const raw: unknown[] = [];

  while (offset < total && offset < MAX_OFFSET && results.length < maxResults) {
    if (signal?.aborted) throw new Error('Cancelled');

    const pageReq: SearchRequest = {
      ...request,
      pagination: { offset, limit },
    };

    let resp: { data: SearchResponse; raw: unknown };
    try {
      resp = await searchODP(pageReq, apiKey);
    } catch (err: unknown) {
      // Back off on rate limit (429)
      if (err instanceof Error && err.message.includes('429')) {
        log({ timestamp: new Date(), method: 'WAIT', url: `Rate limited, waiting ${RATE_LIMIT_BACKOFF}ms...` });
        await delay(RATE_LIMIT_BACKOFF);
        if (signal?.aborted) throw new Error('Cancelled');
        resp = await searchODP(pageReq, apiKey);
      } else {
        throw err;
      }
    }

    total = resp.data.count;
    const batch = resp.data.patentFileWrapperDataBag ?? [];
    if (batch.length === 0) break;

    results.push(...batch);
    raw.push(resp.raw);
    offset += limit;

    onProgress(results.length, Math.min(total, MAX_OFFSET, maxResults));

    if (offset < total && offset < MAX_OFFSET) await delay(RATE_LIMIT_DELAY);
  }

  return { results, raw, count: total };
}

/**
 * Generate year-based date ranges to split large queries into <10K-result slices.
 */
export function generateDateRanges(startYear: number, endYear: number, chunkYears: number): Array<{ from: string; to: string }> {
  const ranges: Array<{ from: string; to: string }> = [];
  for (let y = startYear; y <= endYear; y += chunkYears) {
    const end = Math.min(y + chunkYears - 1, endYear);
    ranges.push({
      from: `${y}-01-01`,
      to: `${end}-12-31`,
    });
  }
  return ranges;
}

export async function fetchAllPages(
  request: SearchRequest,
  apiKey: string,
  onProgress: (fetched: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ data: SearchResponse; raw: unknown[] }> {
  const limit = request.pagination?.limit ?? 100;

  // First, probe total count
  const { data: probe } = await searchODP(
    { ...request, pagination: { offset: 0, limit: 1 } },
    apiKey,
  );
  const totalCount = probe.count;

  if (totalCount <= MAX_OFFSET) {
    // Simple case: total fits within offset limit, just paginate
    const { results, raw } = await fetchPages(
      request, apiKey, limit, totalCount, onProgress, signal,
    );
    return {
      data: { count: totalCount, patentFileWrapperDataBag: results },
      raw,
    };
  }

  // Large result set: split into date-range chunks
  log({
    timestamp: new Date(),
    method: 'INFO',
    url: `Total ${totalCount} exceeds ${MAX_OFFSET} offset limit — splitting by date ranges`,
  });

  // Start with 5-year chunks, will subdivide if needed
  const START_YEAR = 2001;
  const END_YEAR = new Date().getFullYear();
  let dateRanges = generateDateRanges(START_YEAR, END_YEAR, 5);

  const allResults: SearchResponse['patentFileWrapperDataBag'] = [];
  const allRaw: unknown[] = [];

  for (let i = 0; i < dateRanges.length; i++) {
    if (signal?.aborted) throw new Error('Cancelled');

    const range = dateRanges[i];

    // Build request with date range filter
    const rangeFilter = { field: 'applicationMetaData.filingDate', valueFrom: range.from, valueTo: range.to };
    const sliceRequest: SearchRequest = {
      ...request,
      rangeFilters: [...(request.rangeFilters ?? []).filter(
        (f) => f.field !== 'applicationMetaData.filingDate',
      ), rangeFilter],
      sort: [{ field: 'applicationMetaData.filingDate', order: 'Asc' }],
    };

    // Probe this slice's count
    const { data: sliceProbe } = await searchODP(
      { ...sliceRequest, pagination: { offset: 0, limit: 1 } },
      apiKey,
    );
    await delay(RATE_LIMIT_DELAY);

    if (sliceProbe.count === 0) continue;

    if (sliceProbe.count > MAX_OFFSET) {
      // This slice is still too big — subdivide into 1-year chunks
      const fromYear = parseInt(range.from);
      const toYear = parseInt(range.to);
      const subRanges = generateDateRanges(fromYear, toYear, 1);

      log({
        timestamp: new Date(),
        method: 'INFO',
        url: `Slice ${range.from}→${range.to} has ${sliceProbe.count} results, subdividing into ${subRanges.length} yearly chunks`,
      });

      // Replace this range with sub-ranges and reprocess
      dateRanges.splice(i, 1, ...subRanges);
      i--; // re-process from this index
      continue;
    }

    log({
      timestamp: new Date(),
      method: 'INFO',
      url: `Fetching slice ${range.from}→${range.to}: ${sliceProbe.count} results`,
    });

    const { results, raw } = await fetchPages(
      sliceRequest, apiKey, limit, sliceProbe.count,
      (fetched, sliceTotal) => {
        onProgress(allResults.length + fetched, totalCount);
      },
      signal,
    );

    allResults.push(...results);
    allRaw.push(...raw);
    onProgress(allResults.length, totalCount);
  }

  return {
    data: { count: totalCount, patentFileWrapperDataBag: allResults },
    raw: allRaw,
  };
}

// --- Batch: Fetch Full Details for Selected ---

export async function fetchBatchDetails(
  appNumbers: string[],
  apiKey: string,
  onProgress: (completed: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ results: Array<{ appNo: string; data: unknown; error?: string }>; raw: unknown[] }> {
  const results: Array<{ appNo: string; data: unknown; error?: string }> = [];
  const allRaw: unknown[] = [];
  const batchSize = 5;

  for (let i = 0; i < appNumbers.length; i += batchSize) {
    if (signal?.aborted) throw new Error('Cancelled');

    const batch = appNumbers.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((appNo) => fetchApplicationDetails(appNo, apiKey)),
    );

    for (let j = 0; j < batch.length; j++) {
      const r = batchResults[j];
      if (r.status === 'fulfilled') {
        results.push({ appNo: batch[j], data: r.value.data });
        allRaw.push(r.value.raw);
      } else {
        results.push({ appNo: batch[j], data: null, error: String(r.reason) });
      }
    }

    onProgress(results.length, appNumbers.length);

    if (i + batchSize < appNumbers.length) await delay(1000);
  }

  return { results, raw: allRaw };
}
