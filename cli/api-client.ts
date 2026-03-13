const API_BASE = 'https://api.uspto.gov/api/v1/patent/applications';

export interface SearchRequest {
  q?: string;
  filters?: Array<{ name: string; value: string[] }>;
  rangeFilters?: Array<{ field: string; valueFrom: string; valueTo: string }>;
  pagination?: { offset: number; limit: number };
  sort?: Array<{ field: string; order: 'Asc' | 'Desc' }>;
  fields?: string[];
}

export interface SearchResponse {
  count: number;
  requestIdentifier?: string;
  patentFileWrapperDataBag: Record<string, unknown>[];
}

// ─── Core fetch helpers ─────────────────────────────────

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number,
  backoff: number,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429) {
        const wait = backoff * Math.pow(2, attempt);
        console.log(`  [429] Rate limited. Waiting ${wait / 1000}s...`);
        await delay(wait);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        const wait = backoff * Math.pow(2, attempt);
        console.log(`  [Error] ${(err as Error).message}. Retrying in ${wait / 1000}s...`);
        await delay(wait);
      }
    }
  }
  throw lastError!;
}

export async function searchODP(
  request: SearchRequest,
  apiKey: string,
  maxRetries = 3,
  backoff = 5000,
): Promise<SearchResponse> {
  const res = await fetchWithRetry(
    `${API_BASE}/search`,
    {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    maxRetries,
    backoff,
  );
  return (await res.json()) as SearchResponse;
}

export async function fetchDetail(
  appNo: string,
  apiKey: string,
  maxRetries = 3,
  backoff = 5000,
): Promise<Record<string, unknown>> {
  const clean = appNo.replace(/[\/,\-\s]/g, '');
  const res = await fetchWithRetry(
    `${API_BASE}/${clean}`,
    {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
      },
    },
    maxRetries,
    backoff,
  );
  const json = (await res.json()) as Record<string, unknown>;
  // The detail endpoint wraps the record in patentFileWrapperDataBag
  const bag = json.patentFileWrapperDataBag;
  if (Array.isArray(bag) && bag.length > 0) return bag[0] as Record<string, unknown>;
  return json;
}

// ─── Probe: lightweight count-only request ──────────────

export async function probeCount(
  query: string,
  apiKey: string,
  rangeFilter?: { field: string; valueFrom: string; valueTo: string },
): Promise<{ count: number; newestDate?: string; oldestDate?: string }> {
  const request: SearchRequest = {
    q: query,
    pagination: { offset: 0, limit: 1 },
    sort: [{ field: 'applicationMetaData.filingDate', order: 'Desc' }],
    rangeFilters: rangeFilter ? [rangeFilter] : [],
  };

  const res = await searchODP(request, apiKey);
  const count = res.count;
  let newestDate: string | undefined;
  let oldestDate: string | undefined;

  if (count > 0 && res.patentFileWrapperDataBag.length > 0) {
    const meta = res.patentFileWrapperDataBag[0].applicationMetaData as
      | Record<string, unknown>
      | undefined;
    newestDate = (meta?.filingDate as string) ?? undefined;
  }

  if (count > 1) {
    const ascReq: SearchRequest = {
      q: query,
      pagination: { offset: 0, limit: 1 },
      sort: [{ field: 'applicationMetaData.filingDate', order: 'Asc' }],
      rangeFilters: rangeFilter ? [rangeFilter] : [],
    };
    const ascRes = await searchODP(ascReq, apiKey);
    if (ascRes.patentFileWrapperDataBag.length > 0) {
      const meta = ascRes.patentFileWrapperDataBag[0].applicationMetaData as
        | Record<string, unknown>
        | undefined;
      oldestDate = (meta?.filingDate as string) ?? undefined;
    }
  } else {
    oldestDate = newestDate;
  }

  return { count, newestDate, oldestDate };
}

// ─── Date range generation ──────────────────────────────

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export function generateDateRanges(
  startDate: string,
  endDate: string,
  chunkMonths: number,
): DateRange[] {
  const ranges: DateRange[] = [];
  const end = new Date(endDate);
  let cursor = new Date(startDate);

  while (cursor <= end) {
    const rangeStart = cursor.toISOString().split('T')[0];
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + chunkMonths);
    next.setDate(next.getDate() - 1); // end of chunk
    const rangeEnd = next > end ? endDate : next.toISOString().split('T')[0];
    ranges.push({ from: rangeStart, to: rangeEnd });
    // move cursor to day after this chunk's end
    const afterEnd = new Date(rangeEnd);
    afterEnd.setDate(afterEnd.getDate() + 1);
    cursor = afterEnd;
  }

  return ranges;
}

// ─── Paginated search for one date-range chunk ──────────

export const MAX_OFFSET = 10000;

export interface PageCallback {
  (records: Record<string, unknown>[], pageOffset: number, total: number): void;
}

/**
 * Fetch all pages for a single date-range chunk.
 *
 * EDGE CASE: Records with null/missing filingDate are NOT captured by date-range
 * filters. Those are handled separately by fetchNullDatePages() which appends
 * "AND NOT applicationMetaData.filingDate:[* TO *]" to the query.
 * See: pipeline.ts where a special "null-dates" chunk is created.
 */
export async function fetchChunkPages(
  query: string,
  dateRange: DateRange | null,
  apiKey: string,
  pageSize: number,
  rateLimitDelay: number,
  onPage: PageCallback,
  signal?: AbortSignal,
): Promise<number> {
  let offset = 0;
  let total = 0;
  let fetched = 0;

  // If dateRange is null, this is the "null filing date" chunk —
  // the query itself already includes the NOT filingDate filter
  const isNullDateChunk = dateRange === null;

  while (true) {
    if (signal?.aborted) throw new Error('Aborted');

    const request: SearchRequest = {
      q: query,
      pagination: { offset, limit: pageSize },
      sort: [{ field: 'applicationMetaData.applicationStatusDate', order: 'Desc' }],
      rangeFilters: isNullDateChunk
        ? []
        : [
            {
              field: 'applicationMetaData.filingDate',
              valueFrom: dateRange!.from,
              valueTo: dateRange!.to,
            },
          ],
    };

    const res = await searchODP(request, apiKey);
    total = res.count;
    const records = res.patentFileWrapperDataBag;

    if (records.length === 0) break;

    onPage(records, offset, total);
    fetched += records.length;
    offset += pageSize;

    if (offset >= total || offset >= MAX_OFFSET) break;

    await delay(rateLimitDelay);
  }

  return fetched;
}

// ─── Utility ────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { delay };
