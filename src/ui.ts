import type { SearchRequest, SearchResponse, PatentFileWrapperData, QueryMode, LogEntry } from './types';
import { searchODP, fetchAllPages, fetchBatchDetails, onLog } from './api';
import { exportJSON, exportCSV, exportRawResponse } from './export';

let currentResults: SearchResponse | null = null;
let currentRaw: unknown = null;
let selectedApps = new Set<string>();
let abortController: AbortController | null = null;

function $(sel: string) { return document.querySelector(sel)!; }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>, children?: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => { if (k === 'class') e.className = v; else e.setAttribute(k, v); });
  if (children) children.forEach((c) => e.append(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}

function getApiKey(): string {
  return (document.getElementById('apiKey') as HTMLInputElement).value.trim();
}

function getQueryMode(): QueryMode {
  return (document.querySelector('.tab.active') as HTMLElement)?.dataset.mode as QueryMode ?? 'simple';
}

function buildSearchRequest(): SearchRequest {
  const mode = getQueryMode();
  const offset = parseInt((document.getElementById('offset') as HTMLInputElement).value) || 0;
  const limit = Math.min(parseInt((document.getElementById('limit') as HTMLInputElement).value) || 25, 100);
  const sortField = (document.getElementById('sortField') as HTMLSelectElement).value;
  const sortOrder = (document.getElementById('sortOrder') as HTMLSelectElement).value as 'Asc' | 'Desc';

  const pagination = { offset, limit };
  const sort = sortField ? [{ field: sortField, order: sortOrder }] : undefined;

  if (mode === 'raw') {
    try {
      const raw = JSON.parse((document.getElementById('rawJson') as HTMLTextAreaElement).value);
      if (raw.pagination?.limit > 100) raw.pagination.limit = 100;
      return { ...raw, pagination: raw.pagination ?? pagination, sort: raw.sort ?? sort };
    } catch {
      throw new Error('Invalid JSON in raw query editor');
    }
  }

  if (mode === 'simple') {
    const q = (document.getElementById('simpleQuery') as HTMLInputElement).value.trim();
    if (!q) throw new Error('Enter a search query');
    return { q, pagination, sort };
  }

  // Structured mode — build q string from fields
  // Map HTML element IDs to correct API query field names
  const FIELD_MAP: Record<string, string> = {
    inventionTitle: 'applicationMetaData.inventionTitle',
    firstInventorName: 'applicationMetaData.firstInventorName',
    firstApplicantName: 'applicationMetaData.firstApplicantName',
    applicationNumberText: 'applicationNumberText',
    patentNumber: 'applicationMetaData.patentNumber',
    docketNumber: 'applicationMetaData.docketNumber',
    examinerNameText: 'applicationMetaData.examinerNameText',
    groupArtUnitNumber: 'applicationMetaData.groupArtUnitNumber',
    cpcClassificationBag: 'applicationMetaData.cpcClassificationBag',
    applicationConfirmationNumber: 'applicationMetaData.applicationConfirmationNumber',
    earliestPublicationNumber: 'applicationMetaData.earliestPublicationNumber',
  };

  const fields: Record<string, string> = {};
  for (const [id, apiField] of Object.entries(FIELD_MAP)) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    const val = input?.value.trim();
    if (val) fields[apiField] = val;
  }

  const appType = (document.getElementById('applicationTypeLabelName') as HTMLSelectElement).value;
  const dateFrom = (document.getElementById('filingDateFrom') as HTMLInputElement).value;
  const dateTo = (document.getElementById('filingDateTo') as HTMLInputElement).value;

  // Build query string
  const parts: string[] = [];
  for (const [field, val] of Object.entries(fields)) {
    const escaped = val.includes(' ') ? `"${val}"` : val;
    parts.push(`${field}:${escaped}`);
  }

  const filters: SearchRequest['filters'] = [];
  if (appType) filters.push({ name: 'applicationMetaData.applicationTypeLabelName', value: [appType] });

  const rangeFilters: SearchRequest['rangeFilters'] = [];
  if (dateFrom || dateTo) {
    rangeFilters.push({
      field: 'applicationMetaData.filingDate',
      valueFrom: dateFrom || '2001-01-01',
      valueTo: dateTo || new Date().toISOString().slice(0, 10),
    });
  }

  const q = parts.join(' AND ') || undefined;
  if (!q && filters.length === 0 && rangeFilters.length === 0) {
    throw new Error('Enter at least one search field');
  }

  return {
    q,
    filters: filters.length > 0 ? filters : undefined,
    rangeFilters: rangeFilters.length > 0 ? rangeFilters : undefined,
    pagination,
    sort,
  };
}

// --- Rendering ---

function renderResults(response: SearchResponse) {
  currentResults = response;
  selectedApps.clear();

  const countEl = document.getElementById('resultCount');
  if (countEl) {
    const items = response.patentFileWrapperDataBag ?? [];
    countEl.textContent = `${items.length} of ${response.count} results`;
  }

  renderTable(response.patentFileWrapperDataBag ?? []);
}

function renderTable(items: PatentFileWrapperData[]) {
  const wrap = document.getElementById('tableWrap')!;
  if (items.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128269;</div>
        <div class="empty-state-text">No results found</div>
      </div>`;
    return;
  }

  const table = el('table');
  const thead = el('thead');
  const headerRow = el('tr', {}, [
    el('th', {}, [createSelectAllCheckbox(items)]),
    el('th', {}, ['App Number']),
    el('th', {}, ['Title']),
    el('th', {}, ['Filing Date']),
    el('th', {}, ['Patent No.']),
    el('th', {}, ['Inventor']),
    el('th', {}, ['Applicant']),
    el('th', {}, ['Type']),
    el('th', {}, ['Status']),
  ]);
  thead.append(headerRow);
  table.append(thead);

  const tbody = el('tbody');
  for (const item of items) {
    const m = item.applicationMetaData;
    const appNo = item.applicationNumberText ?? '';
    const cb = el('input', { type: 'checkbox', 'data-appno': appNo });
    cb.addEventListener('change', () => {
      if ((cb as HTMLInputElement).checked) selectedApps.add(appNo);
      else selectedApps.delete(appNo);
    });

    const row = el('tr', {}, [
      el('td', {}, [cb]),
      el('td', {}, [appNo]),
      el('td', { class: 'title-cell' }, [m?.inventionTitle ?? '']),
      el('td', {}, [m?.filingDate ?? '']),
      el('td', {}, [m?.patentNumber ?? '']),
      el('td', {}, [m?.firstInventorName ?? '']),
      el('td', {}, [m?.firstApplicantName ?? '']),
      el('td', {}, [m?.applicationTypeLabelName ?? '']),
      el('td', {}, [m?.applicationStatusDescriptionText ?? '']),
    ]);
    tbody.append(row);
  }
  table.append(tbody);

  wrap.innerHTML = '';
  wrap.append(table);
}

function createSelectAllCheckbox(items: PatentFileWrapperData[]): HTMLInputElement {
  const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
  cb.addEventListener('change', () => {
    const all = document.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]');
    all.forEach((c) => {
      c.checked = cb.checked;
      const appNo = c.dataset.appno!;
      if (cb.checked) selectedApps.add(appNo);
      else selectedApps.delete(appNo);
    });
  });
  return cb;
}

function renderRawJson(raw: unknown) {
  currentRaw = raw;
  const view = document.getElementById('jsonView')!;
  view.textContent = JSON.stringify(raw, null, 2);
}

function appendLog(entry: LogEntry) {
  const panel = document.getElementById('logPanel')!;
  const line = el('div', { class: 'log-entry' });
  const time = entry.timestamp.toLocaleTimeString();
  const statusClass = entry.status && entry.status < 400 ? 'status-ok' : 'status-err';

  line.innerHTML = `<span class="time">${time}</span> <span class="method">${entry.method}</span> ${entry.url}` +
    (entry.status ? ` <span class="${statusClass}">${entry.status}</span>` : '') +
    (entry.durationMs != null ? ` <span class="duration">${entry.durationMs}ms</span>` : '') +
    (entry.error ? ` <span class="error">${entry.error.slice(0, 200)}</span>` : '');

  panel.append(line);
  panel.scrollTop = panel.scrollHeight;
}

function setProgress(pct: number, text: string) {
  const fill = document.getElementById('progressFill') as HTMLElement;
  const status = document.getElementById('statusText')!;
  fill.style.width = `${pct}%`;
  status.textContent = text;
}

function clearProgress() {
  setProgress(0, '');
}

// --- Event handlers ---

async function handleSearch() {
  const apiKey = getApiKey();
  if (!apiKey) { alert('Enter your API key'); return; }

  let request: SearchRequest;
  try {
    request = buildSearchRequest();
  } catch (e) {
    alert(String(e));
    return;
  }

  // Show the built request in raw JSON view for debugging
  const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';
  clearProgress();

  try {
    const { data, raw } = await searchODP(request, apiKey);
    renderResults(data);
    renderRawJson(raw);
  } catch (e) {
    renderRawJson({ error: String(e) });
    document.getElementById('tableWrap')!.innerHTML =
      `<div class="empty-state"><div class="empty-state-icon">&#9888;</div><div class="empty-state-text" style="color:var(--danger)">${String(e)}</div></div>`;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

async function handleFetchAllPages() {
  const apiKey = getApiKey();
  if (!apiKey) { alert('Enter your API key'); return; }

  let request: SearchRequest;
  try {
    request = buildSearchRequest();
  } catch (e) { alert(String(e)); return; }

  // First do a search to get count
  setProgress(5, 'Getting result count...');
  try {
    const { data: peek } = await searchODP({ ...request, pagination: { offset: 0, limit: 1 } }, apiKey);
    const total = peek.count;

    const estRequests = total <= 10000
      ? Math.ceil(total / 100)
      : Math.ceil(total / 100) + Math.ceil(total / 10000) * 2; // data pages + probe per slice
    if (!confirm(`This will fetch ~${total.toLocaleString()} results in ~${estRequests.toLocaleString()} requests. ${total > 10000 ? 'Results will be fetched in date-range slices to work around the 10K offset limit. ' : ''}Continue?`)) {
      clearProgress(); return;
    }

    abortController = new AbortController();
    const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement;
    cancelBtn.style.display = 'inline-flex';

    const { data, raw } = await fetchAllPages(
      request, apiKey,
      (fetched, tot) => setProgress(Math.round((fetched / tot) * 100), `Fetched ${fetched} of ${tot}`),
      abortController.signal,
    );

    renderResults(data);
    renderRawJson(raw);
    setProgress(100, `Done — ${data.count} results`);
  } catch (e) {
    setProgress(0, `Error: ${String(e)}`);
  } finally {
    abortController = null;
    (document.getElementById('cancelBtn') as HTMLElement).style.display = 'none';
  }
}

async function handleFetchDetails() {
  const apiKey = getApiKey();
  if (!apiKey) { alert('Enter your API key'); return; }

  if (selectedApps.size === 0) {
    alert('Select at least one application from the results');
    return;
  }

  const appNos = [...selectedApps];
  abortController = new AbortController();
  const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement;
  cancelBtn.style.display = 'inline-flex';

  try {
    const { results, raw } = await fetchBatchDetails(
      appNos, apiKey,
      (done, total) => setProgress(Math.round((done / total) * 100), `Fetched details ${done}/${total}`),
      abortController.signal,
    );

    renderRawJson(raw);
    setProgress(100, `Done — ${results.length} applications`);

    // Auto-export
    exportJSON(results, `uspto-details-${Date.now()}.json`);
  } catch (e) {
    setProgress(0, `Error: ${String(e)}`);
  } finally {
    abortController = null;
    cancelBtn.style.display = 'none';
  }
}

function handleCancel() {
  abortController?.abort();
}

// --- Build DOM ---

export function initUI() {
  onLog(appendLog);

  const app = document.getElementById('app')!;
  app.innerHTML = `
    <!-- Header -->
    <div class="header">
      <h1>
        <span class="header-logo">&#9878;</span>
        USPTO ODP Search
      </h1>
      <div class="header-spacer"></div>
      <div class="api-key-group">
        <label for="apiKey">API Key</label>
        <input id="apiKey" class="api-key-input" type="password" placeholder="Enter USPTO API key" autocomplete="off" spellcheck="false" />
      </div>
    </div>

    <!-- Query Section -->
    <div class="section">
      <div class="tabs">
        <button class="tab active" data-mode="simple">Simple Query</button>
        <button class="tab" data-mode="structured">Structured</button>
        <button class="tab" data-mode="raw">Raw JSON</button>
      </div>

      <!-- Simple mode -->
      <div id="mode-simple" class="mode-panel">
        <input id="simpleQuery" class="simple-query-input" type="text"
          placeholder="applicationMetaData.inventionTitle:Nanobody AND applicationMetaData.firstInventorName:Smith" />
        <div class="query-help">
          <strong>Fields:</strong>
          <code>applicationMetaData.inventionTitle</code>
          <code>applicationMetaData.firstInventorName</code>
          <code>applicationMetaData.firstApplicantName</code>
          <code>applicationNumberText</code>
          <code>applicationMetaData.patentNumber</code>
          <code>applicationMetaData.docketNumber</code>
          <code>applicationMetaData.groupArtUnitNumber</code>
          <code>applicationMetaData.examinerNameText</code>
          <code>applicationMetaData.cpcClassificationBag</code>
          <code>applicationMetaData.earliestPublicationNumber</code>
          <code>applicationMetaData.filingDate</code>
          <code>applicationMetaData.applicationConfirmationNumber</code>
          <code>applicationMetaData.applicationTypeLabelName</code>
          <code>applicationMetaData.applicationStatusDescriptionText</code><br>
          <strong>Syntax:</strong> <code>field:value</code> &bull; <code>field:"multi word"</code> &bull; <code>AND</code> / <code>OR</code> &bull; <code>field:[2022-01-01 TO 2023-12-31]</code>
        </div>
      </div>

      <!-- Structured mode -->
      <div id="mode-structured" class="mode-panel" style="display:none">
        <div class="form-grid">
          <div class="form-field form-field-wide">
            <label for="inventionTitle">Invention Title</label>
            <input id="inventionTitle" type="text" placeholder="Keywords..." />
          </div>
          <div class="form-field">
            <label for="firstInventorName">Inventor Name</label>
            <input id="firstInventorName" type="text" placeholder="Last, First" />
          </div>
          <div class="form-field">
            <label for="firstApplicantName">Applicant / Assignee</label>
            <input id="firstApplicantName" type="text" placeholder="Company or person" />
          </div>
          <div class="form-field">
            <label for="applicationNumberText">Application Number</label>
            <input id="applicationNumberText" type="text" placeholder="e.g. 17654170" />
          </div>
          <div class="form-field">
            <label for="patentNumber">Patent Number</label>
            <input id="patentNumber" type="text" placeholder="e.g. 11234567" />
          </div>
          <div class="form-field">
            <label for="docketNumber">Docket Number</label>
            <input id="docketNumber" type="text" placeholder="Attorney docket" />
          </div>
          <div class="form-field">
            <label for="examinerNameText">Examiner Name</label>
            <input id="examinerNameText" type="text" placeholder="Last name" />
          </div>
          <div class="form-field">
            <label for="groupArtUnitNumber">Group Art Unit</label>
            <input id="groupArtUnitNumber" type="text" placeholder="e.g. 2145" />
          </div>
          <div class="form-field">
            <label for="cpcClassificationBag">CPC Classification</label>
            <input id="cpcClassificationBag" type="text" placeholder="e.g. H04L" />
          </div>
          <div class="form-field">
            <label for="applicationConfirmationNumber">Confirmation Number</label>
            <input id="applicationConfirmationNumber" type="text" placeholder="e.g. 1234" />
          </div>
          <div class="form-field">
            <label for="earliestPublicationNumber">Publication Number</label>
            <input id="earliestPublicationNumber" type="text" placeholder="e.g. US20230012345" />
          </div>
          <div class="form-field">
            <label for="applicationTypeLabelName">Application Type</label>
            <select id="applicationTypeLabelName">
              <option value="">Any</option>
              <option value="Utility">Utility</option>
              <option value="Design">Design</option>
              <option value="Plant">Plant</option>
              <option value="Provisional">Provisional</option>
            </select>
          </div>
          <div class="form-field">
            <label for="filingDateFrom">Filing Date From</label>
            <input id="filingDateFrom" type="date" />
          </div>
          <div class="form-field">
            <label for="filingDateTo">Filing Date To</label>
            <input id="filingDateTo" type="date" />
          </div>
        </div>
      </div>

      <!-- Raw JSON mode -->
      <div id="mode-raw" class="mode-panel" style="display:none">
        <textarea id="rawJson" rows="14">${JSON.stringify({
          q: 'applicationMetaData.inventionTitle:Nanobody',
          pagination: { offset: 0, limit: 25 },
          sort: [{ field: 'applicationMetaData.filingDate', order: 'Desc' }],
        }, null, 2)}</textarea>
      </div>

      <!-- Pagination & Sort -->
      <div class="pagination-bar">
        <label>Offset:</label>
        <input id="offset" type="number" value="0" min="0" />
        <label>Limit:</label>
        <input id="limit" type="number" value="25" min="1" max="100" />
        <label>Sort by:</label>
        <select id="sortField">
          <option value="" selected>None</option>
          <option value="applicationMetaData.filingDate">Filing Date</option>
          <option value="applicationNumberText">App Number</option>
          <option value="applicationMetaData.inventionTitle">Title</option>
          <option value="applicationMetaData.grantDate">Grant Date</option>
          <option value="applicationMetaData.firstApplicantName">Applicant</option>
          <option value="applicationMetaData.firstInventorName">Inventor</option>
          <option value="applicationMetaData.patentNumber">Patent Number</option>
        </select>
        <select id="sortOrder">
          <option value="Desc">Desc</option>
          <option value="Asc">Asc</option>
        </select>
      </div>

      <!-- Actions -->
      <div class="action-bar">
        <button id="searchBtn" class="primary">Search</button>
        <button id="fetchAllBtn">Fetch All Pages</button>
        <button id="fetchDetailsBtn">Fetch Details for Selected</button>
        <button id="cancelBtn" class="danger" style="display:none">Cancel</button>
        <div class="spacer"></div>
        <div class="export-btn-group">
          <button id="exportJsonBtn">JSON</button>
          <button id="exportCsvBtn">CSV</button>
          <button id="exportRawBtn">Raw</button>
        </div>
        <span id="resultCount" class="result-count"></span>
      </div>

      <!-- Progress -->
      <div class="progress-bar"><div id="progressFill" class="progress-bar-fill" style="width:0%"></div></div>
      <div id="statusText" class="status-text"></div>
    </div>

    <!-- Results -->
    <div class="section">
      <div class="results-container">
        <div class="results-table-panel">
          <div class="panel-header">
            <span class="panel-label"><span class="panel-label-dot panel-label-dot--table"></span> Results Table</span>
          </div>
          <div id="tableWrap" class="table-wrap">
            <div class="empty-state">
              <div class="empty-state-icon">&#128269;</div>
              <div class="empty-state-text">Run a search to see results</div>
            </div>
          </div>
        </div>
        <div class="results-json-panel">
          <div class="panel-header">
            <span class="panel-label"><span class="panel-label-dot panel-label-dot--json"></span> API Response</span>
          </div>
          <div id="jsonView" class="json-view">// Raw API response will appear here</div>
        </div>
      </div>
    </div>

    <!-- Log -->
    <div class="section">
      <div class="panel-header">
        <span class="panel-label"><span class="panel-label-dot panel-label-dot--log"></span> API Log</span>
      </div>
      <div id="logPanel" class="log-panel"></div>
    </div>
  `;

  // Pre-fill API key from env
  const envKey = import.meta.env.VITE_USPTO_API_KEY;
  if (envKey) (document.getElementById('apiKey') as HTMLInputElement).value = envKey;

  // Tab switching
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = (tab as HTMLElement).dataset.mode;
      document.querySelectorAll('.mode-panel').forEach((p) => (p as HTMLElement).style.display = 'none');
      (document.getElementById(`mode-${mode}`) as HTMLElement).style.display = '';
    });
  });

  // Button handlers
  document.getElementById('searchBtn')!.addEventListener('click', handleSearch);
  document.getElementById('fetchAllBtn')!.addEventListener('click', handleFetchAllPages);
  document.getElementById('fetchDetailsBtn')!.addEventListener('click', handleFetchDetails);
  document.getElementById('cancelBtn')!.addEventListener('click', handleCancel);

  document.getElementById('exportJsonBtn')!.addEventListener('click', () => {
    if (!currentResults?.patentFileWrapperDataBag?.length) { alert('No results to export'); return; }
    exportJSON(currentResults.patentFileWrapperDataBag, `uspto-search-${Date.now()}.json`);
  });

  document.getElementById('exportCsvBtn')!.addEventListener('click', () => {
    if (!currentResults?.patentFileWrapperDataBag?.length) { alert('No results to export'); return; }
    exportCSV(currentResults.patentFileWrapperDataBag, `uspto-search-${Date.now()}.csv`);
  });

  document.getElementById('exportRawBtn')!.addEventListener('click', () => {
    if (!currentRaw) { alert('No raw response to export'); return; }
    exportRawResponse(currentRaw, `uspto-raw-${Date.now()}.json`);
  });

  // Enter key triggers search
  document.getElementById('simpleQuery')!.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') handleSearch();
  });
}
