import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SearchRequest, SearchResponse } from './types';
import {
  searchODP,
  fetchAllPages,
  fetchPages,
  generateDateRanges,
  onLog,
  _setDelayImpl,
  MAX_OFFSET,
} from './api';

// ---- Helpers ----

let restoreDelay: () => void;

function makeResponse(count: number, numResults: number, startIndex = 0): SearchResponse {
  return {
    count,
    patentFileWrapperDataBag: Array.from({ length: numResults }, (_, i) => ({
      applicationNumberText: `APP${String(startIndex + i).padStart(6, '0')}`,
      applicationMetaData: {
        inventionTitle: `Patent ${startIndex + i}`,
        filingDate: '2020-01-01',
        firstApplicantName: 'Apple Inc.',
      },
    })),
  };
}

function mockFetch(handler: (url: string, opts: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string, opts: RequestInit) => {
    const { status, body } = handler(url, opts);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

// ---- Setup ----

beforeEach(() => {
  vi.restoreAllMocks();
  onLog(() => {}); // suppress log output
  restoreDelay = _setDelayImpl(() => Promise.resolve()); // instant delays
});

afterEach(() => {
  restoreDelay();
});

// ---- Tests ----

describe('generateDateRanges', () => {
  it('generates 5-year chunks from 2001 to 2025', () => {
    const ranges = generateDateRanges(2001, 2025, 5);
    expect(ranges).toEqual([
      { from: '2001-01-01', to: '2005-12-31' },
      { from: '2006-01-01', to: '2010-12-31' },
      { from: '2011-01-01', to: '2015-12-31' },
      { from: '2016-01-01', to: '2020-12-31' },
      { from: '2021-01-01', to: '2025-12-31' },
    ]);
  });

  it('generates 1-year chunks', () => {
    const ranges = generateDateRanges(2020, 2023, 1);
    expect(ranges).toEqual([
      { from: '2020-01-01', to: '2020-12-31' },
      { from: '2021-01-01', to: '2021-12-31' },
      { from: '2022-01-01', to: '2022-12-31' },
      { from: '2023-01-01', to: '2023-12-31' },
    ]);
  });

  it('handles partial last chunk', () => {
    const ranges = generateDateRanges(2001, 2003, 5);
    expect(ranges).toEqual([
      { from: '2001-01-01', to: '2003-12-31' },
    ]);
  });

  it('handles single year', () => {
    const ranges = generateDateRanges(2020, 2020, 1);
    expect(ranges).toEqual([
      { from: '2020-01-01', to: '2020-12-31' },
    ]);
  });
});

describe('searchODP', () => {
  it('sends POST with correct headers and returns parsed response', async () => {
    const expectedResponse = makeResponse(5, 5);
    const fetchMock = mockFetch(() => ({ status: 200, body: expectedResponse }));
    vi.stubGlobal('fetch', fetchMock);

    const request: SearchRequest = {
      q: 'applicationMetaData.firstApplicantName:Apple*',
      pagination: { offset: 0, limit: 25 },
    };

    const { data } = await searchODP(request, 'test-key');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/uspto/v1/patent/applications/search');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toMatchObject({ 'X-API-KEY': 'test-key' });
    expect(JSON.parse(opts.body as string)).toEqual(request);
    expect(data.count).toBe(5);
    expect(data.patentFileWrapperDataBag).toHaveLength(5);
  });

  it('throws on non-200 response', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ status: 400, body: { error: 'Bad request' } })));

    await expect(
      searchODP({ q: 'bad', pagination: { offset: 0, limit: 25 } }, 'key'),
    ).rejects.toThrow('USPTO ODP 400');
  });

  it('throws on 429 rate limit', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ status: 429, body: 'Too many requests' })));

    await expect(
      searchODP({ q: 'test', pagination: { offset: 0, limit: 25 } }, 'key'),
    ).rejects.toThrow('USPTO ODP 429');
  });
});

describe('fetchPages', () => {
  it('fetches multiple pages until all results are collected', async () => {
    // 300 total, 100 per page = exactly 3 pages
    let callCount = 0;
    vi.stubGlobal('fetch', mockFetch(() => {
      callCount++;
      const page = callCount - 1;
      const remaining = Math.max(0, 300 - page * 100);
      const pageSize = Math.min(100, remaining);
      return { status: 200, body: makeResponse(300, pageSize, page * 100) };
    }));

    const progress: Array<[number, number]> = [];
    const { results, count } = await fetchPages(
      { q: 'test' }, 'key', 100, 300,
      (f, t) => progress.push([f, t]),
    );

    expect(count).toBe(300);
    expect(results).toHaveLength(300);
    // Verify unique app numbers
    const appNos = new Set(results.map((r) => r.applicationNumberText));
    expect(appNos.size).toBe(300);
    expect(progress.length).toBe(3);
  });

  it('stops at MAX_OFFSET even if more results exist', async () => {
    // Total 15000 but should stop at offset 10000 (100 pages of 100)
    let callCount = 0;
    vi.stubGlobal('fetch', mockFetch(() => {
      callCount++;
      return { status: 200, body: makeResponse(15000, 100, (callCount - 1) * 100) };
    }));

    const { results, count } = await fetchPages(
      { q: 'test' }, 'key', 100, 15000,
      () => {},
    );

    expect(count).toBe(15000);
    expect(results).toHaveLength(MAX_OFFSET);
    expect(callCount).toBe(100); // 10000 / 100
  });

  it('stops when empty batch is returned', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', mockFetch(() => {
      callCount++;
      if (callCount === 1) return { status: 200, body: makeResponse(500, 100) };
      return { status: 200, body: makeResponse(500, 0) };
    }));

    const { results } = await fetchPages({ q: 'test' }, 'key', 100, 500, () => {});
    expect(results).toHaveLength(100);
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    vi.stubGlobal('fetch', mockFetch(() => ({ status: 200, body: makeResponse(100, 100) })));

    await expect(
      fetchPages({ q: 'test' }, 'key', 100, 100, () => {}, controller.signal),
    ).rejects.toThrow('Cancelled');
  });

  it('retries on 429 with backoff', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429, json: async () => ({}), text: async () => 'Too many requests' };
      }
      const body = makeResponse(50, 50);
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }));

    const { results } = await fetchPages({ q: 'test' }, 'key', 100, 50, () => {});
    expect(results).toHaveLength(50);
    expect(callCount).toBe(2);
  });
});

describe('fetchAllPages', () => {
  it('uses simple pagination when total <= 10000', async () => {
    // 300 total: 1 probe + 3 data pages
    let callCount = 0;
    vi.stubGlobal('fetch', mockFetch((_url, opts) => {
      callCount++;
      const body = JSON.parse(opts.body as string) as SearchRequest;
      const limit = body.pagination?.limit ?? 100;

      if (callCount === 1) {
        // Probe with limit:1
        expect(limit).toBe(1);
        return { status: 200, body: makeResponse(300, 1) };
      }

      // Data pages
      const offset = body.pagination?.offset ?? 0;
      const remaining = Math.max(0, 300 - offset);
      const pageSize = Math.min(limit, remaining);
      return { status: 200, body: makeResponse(300, pageSize, offset) };
    }));

    const progress: Array<[number, number]> = [];
    const { data } = await fetchAllPages(
      { q: 'test', pagination: { offset: 0, limit: 100 } },
      'key',
      (f, t) => progress.push([f, t]),
    );

    expect(data.count).toBe(300);
    expect(data.patentFileWrapperDataBag).toHaveLength(300);
  });

  it('splits into date ranges when total > 10000', async () => {
    const requestBodies: SearchRequest[] = [];

    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as SearchRequest;
      requestBodies.push(body);

      const isProbe = body.pagination?.limit === 1;
      const dateFilter = body.rangeFilters?.find(
        (f) => f.field === 'applicationMetaData.filingDate',
      );

      if (isProbe && !dateFilter) {
        // Global probe: 50000 total
        return {
          ok: true, status: 200,
          json: async () => makeResponse(50000, 1),
          text: async () => '',
        };
      }

      if (isProbe && dateFilter) {
        // Each 5-year slice has 800 results
        return {
          ok: true, status: 200,
          json: async () => makeResponse(800, 1),
          text: async () => '',
        };
      }

      // Data fetch for a date-range slice
      const limit = body.pagination?.limit ?? 100;
      const offset = body.pagination?.offset ?? 0;
      const remaining = Math.max(0, 800 - offset);
      const pageSize = Math.min(limit, remaining);

      return {
        ok: true, status: 200,
        json: async () => makeResponse(800, pageSize, offset),
        text: async () => '',
      };
    }));

    const { data } = await fetchAllPages(
      { q: 'applicationMetaData.firstApplicantName:Apple*', pagination: { offset: 0, limit: 100 } },
      'key',
      () => {},
    );

    expect(data.count).toBe(50000);

    // Verify date range filters were used in data-fetch requests
    const dateRangeRequests = requestBodies.filter(
      (r) => r.rangeFilters?.some((f) => f.field === 'applicationMetaData.filingDate')
        && r.pagination?.limit !== 1, // exclude probes
    );
    expect(dateRangeRequests.length).toBeGreaterThan(1);

    // Total fetched should be number_of_slices * 800
    expect(data.patentFileWrapperDataBag.length).toBeGreaterThan(0);
  });

  it('subdivides 5-year chunks into 1-year when a slice exceeds 10000', async () => {
    const probeResponses: Record<string, number> = {};
    probeResponses['2001-01-01_2005-12-31'] = 12000; // too big, needs subdivision
    probeResponses['2006-01-01_2010-12-31'] = 3000;
    // yearly subdivisions of 2001-2005
    probeResponses['2001-01-01_2001-12-31'] = 2000;
    probeResponses['2002-01-01_2002-12-31'] = 2500;
    probeResponses['2003-01-01_2003-12-31'] = 2500;
    probeResponses['2004-01-01_2004-12-31'] = 2500;
    probeResponses['2005-01-01_2005-12-31'] = 2500;
    // Other ranges empty
    const getSliceCount = (from: string, to: string) => probeResponses[`${from}_${to}`] ?? 0;

    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as SearchRequest;
      const isProbe = body.pagination?.limit === 1;
      const dateFilter = body.rangeFilters?.find(
        (f) => f.field === 'applicationMetaData.filingDate',
      );

      if (isProbe && !dateFilter) {
        return {
          ok: true, status: 200,
          json: async () => makeResponse(15000, 1),
          text: async () => '',
        };
      }

      if (isProbe && dateFilter) {
        const count = getSliceCount(dateFilter.valueFrom, dateFilter.valueTo);
        return {
          ok: true, status: 200,
          json: async () => makeResponse(count, count > 0 ? 1 : 0),
          text: async () => '',
        };
      }

      // Data fetch
      if (dateFilter) {
        const sliceTotal = getSliceCount(dateFilter.valueFrom, dateFilter.valueTo);
        const offset = body.pagination?.offset ?? 0;
        const limit = body.pagination?.limit ?? 100;
        const remaining = Math.max(0, sliceTotal - offset);
        const pageSize = Math.min(limit, remaining);
        return {
          ok: true, status: 200,
          json: async () => makeResponse(sliceTotal, pageSize, offset),
          text: async () => '',
        };
      }

      return {
        ok: true, status: 200,
        json: async () => makeResponse(0, 0),
        text: async () => '',
      };
    }));

    const { data } = await fetchAllPages(
      { q: 'test', pagination: { offset: 0, limit: 100 } },
      'key',
      () => {},
    );

    expect(data.count).toBe(15000);
    // 2001:2000 + 2002:2500 + 2003:2500 + 2004:2500 + 2005:2500 + 2006-2010:3000 = 15000
    expect(data.patentFileWrapperDataBag).toHaveLength(15000);
  });

  it('respects abort signal during date-range fetching', async () => {
    const controller = new AbortController();
    let callCount = 0;

    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // Global probe returns >10K to trigger date chunking
        return {
          ok: true, status: 200,
          json: async () => makeResponse(50000, 1),
          text: async () => '',
        };
      }
      // Abort after global probe
      controller.abort();
      return {
        ok: true, status: 200,
        json: async () => makeResponse(5000, 1),
        text: async () => '',
      };
    }));

    await expect(
      fetchAllPages({ q: 'test', pagination: { offset: 0, limit: 100 } }, 'key', () => {}, controller.signal),
    ).rejects.toThrow('Cancelled');
  });
});
