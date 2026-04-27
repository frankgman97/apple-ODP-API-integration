import { createWriteStream, type WriteStream } from 'fs';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { openDatabase, iteratePatents, countPatents, type PatentRow } from './db.js';
import { createSimpleLogger } from './progress.js';

/** Write to stream, pausing on backpressure until the buffer drains. */
function write(stream: WriteStream, data: string): Promise<void> | undefined {
  if (!stream.write(data)) {
    return new Promise((resolve) => stream.once('drain', resolve));
  }
}

// ─── JSON Export (streaming) ────────────────────────────

export async function exportJSON(dbPath: string, outputPath: string, source?: string): Promise<void> {
  const db = openDatabase(dbPath);
  const total = countPatents(db, source);
  if (total === 0) {
    console.log('No records to export.');
    db.close();
    return;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const stream = createWriteStream(outputPath);
  const done = new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  const logger = createSimpleLogger('JSON Export');

  stream.write('[\n');
  let count = 0;

  for (const row of iteratePatents(db, source)) {
    if (count > 0) await write(stream, ',\n');
    await write(stream, row.raw_json);
    count++;
    logger.log(count, total);
  }

  await write(stream, '\n]\n');
  stream.end();
  await done;

  logger.done(count);
  console.log(`  Saved: ${outputPath}`);
  db.close();
}

// ─── CSV Export (streaming) ─────────────────────────────

const CSV_COLUMNS = [
  'application_number',
  'invention_title',
  'filing_date',
  'patent_number',
  'grant_date',
  'app_status',
  'app_status_date',
  'app_type',
  'first_inventor',
  'first_applicant',
  'examiner',
  'group_art_unit',
  'cpc_classifications',
  'docket_number',
  'pub_number',
  'pub_date',
  'customer_number',
  'all_inventors',
  'all_applicants',
  'all_assignees',
  'correspondence_address',
];

function escapeCSV(value: string | null | undefined): string {
  if (value == null || value === '') return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('|')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function extractPipeSeparated(raw: Record<string, unknown>, path: string): string {
  try {
    const meta = raw.applicationMetaData as Record<string, unknown> | undefined;

    switch (path) {
      case 'inventors': {
        const bag = meta?.inventorBag as Array<Record<string, unknown>> | undefined;
        if (!bag) return '';
        return bag.map((inv) => inv.inventorNameText ?? `${inv.firstName ?? ''} ${inv.lastName ?? ''}`.trim()).join(' | ');
      }
      case 'applicants': {
        const bag = meta?.applicantBag as Array<Record<string, unknown>> | undefined;
        if (!bag) return '';
        return bag.map((app) => app.applicantNameText ?? '').join(' | ');
      }
      case 'assignees': {
        const bag = raw.assignmentBag as Array<Record<string, unknown>> | undefined;
        if (!bag) return '';
        const names = new Set<string>();
        for (const assignment of bag) {
          const assignees = assignment.assigneeBag as Array<Record<string, unknown>> | undefined;
          if (assignees) {
            for (const a of assignees) {
              const name = a.assigneeNameText as string | undefined;
              if (name) names.add(name);
            }
          }
        }
        return [...names].join(' | ');
      }
      case 'correspondence': {
        const bag = raw.correspondenceAddressBag as Array<Record<string, unknown>> | undefined;
        if (!bag || bag.length === 0) return '';
        const addr = bag[0];
        const parts = [
          addr.nameLineOneText,
          addr.addressLineOneText ?? addr.streetLineOneText,
          addr.cityName,
          addr.geographicRegionCode,
          addr.postalCode,
          addr.countryCode,
        ].filter(Boolean);
        return parts.join(', ');
      }
      default:
        return '';
    }
  } catch {
    return '';
  }
}

export async function exportCSV(dbPath: string, outputPath: string, source?: string): Promise<void> {
  const db = openDatabase(dbPath);
  const total = countPatents(db, source);
  if (total === 0) {
    console.log('No records to export.');
    db.close();
    return;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const stream = createWriteStream(outputPath);
  const done = new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  const logger = createSimpleLogger('CSV Export');

  // Header row
  stream.write(CSV_COLUMNS.map(escapeCSV).join(',') + '\n');

  let count = 0;

  for (const row of iteratePatents(db, source)) {
    const raw = JSON.parse(row.raw_json) as Record<string, unknown>;

    const values = [
      row.application_number,
      row.invention_title,
      row.filing_date,
      row.patent_number,
      row.grant_date,
      row.app_status,
      row.app_status_date,
      row.app_type,
      row.first_inventor,
      row.first_applicant,
      row.examiner,
      row.group_art_unit,
      row.cpc_classifications,
      row.docket_number,
      row.pub_number,
      row.pub_date,
      row.customer_number != null ? String(row.customer_number) : '',
      extractPipeSeparated(raw, 'inventors'),
      extractPipeSeparated(raw, 'applicants'),
      extractPipeSeparated(raw, 'assignees'),
      extractPipeSeparated(raw, 'correspondence'),
    ];

    await write(stream, values.map(escapeCSV).join(',') + '\n');
    count++;
    logger.log(count, total);
  }

  stream.end();
  await done;

  logger.done(count);
  console.log(`  Saved: ${outputPath}`);
  db.close();
}
