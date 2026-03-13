import { Command } from 'commander';
import { loadConfig } from './config.js';
import { runSearchPipeline, runDetailPipeline, showStatus } from './pipeline.js';
import { exportJSON, exportCSV } from './export-streaming.js';
import { resolve } from 'path';

const program = new Command();

program
  .name('uspto-cli')
  .description('Headless USPTO ODP Patent Data Pipeline')
  .version('1.0.0');

// ─── Search ─────────────────────────────────────────────

program
  .command('search')
  .description('Fetch patent search results and store in SQLite')
  .requiredOption('-q, --query <string>', 'Search query (e.g. \'applicationMetaData.firstApplicantName:Apple*\')')
  .option('--date-from <YYYY-MM-DD>', 'Filing date range start')
  .option('--date-to <YYYY-MM-DD>', 'Filing date range end')
  .option('--concurrency <n>', 'Number of parallel workers', '3')
  .option('--chunk-months <n>', 'Date-range chunk size in months', '6')
  .option('--db <path>', 'Database path', './data/patents.db')
  .option('--api-key <key>', 'USPTO API key (overrides .env)')
  .option('--rate-limit-delay <ms>', 'Delay between API calls in ms', '250')
  .option('--dry-run', 'Show chunks and estimated counts without fetching')
  .option('--resume', 'Resume from last run (default behavior)')
  .action(async (opts) => {
    const config = loadConfig({
      apiKey: opts.apiKey,
      dbPath: resolve(opts.db),
      concurrency: parseInt(opts.concurrency, 10),
      chunkMonths: parseInt(opts.chunkMonths, 10),
      rateLimitDelay: parseInt(opts.rateLimitDelay, 10),
    });

    await runSearchPipeline({
      query: opts.query,
      config,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      dryRun: opts.dryRun,
    });
  });

// ─── Details ────────────────────────────────────────────

program
  .command('details')
  .description('Fetch full detail records for applications found by search')
  .option('--concurrency <n>', 'Number of parallel workers', '5')
  .option('--db <path>', 'Database path', './data/patents.db')
  .option('--api-key <key>', 'USPTO API key (overrides .env)')
  .option('--rate-limit-delay <ms>', 'Delay between API calls in ms', '250')
  .option('--limit <n>', 'Max records to fetch')
  .option('--retry-errors', 'Retry previously errored fetches')
  .action(async (opts) => {
    const config = loadConfig({
      apiKey: opts.apiKey,
      dbPath: resolve(opts.db),
      concurrency: parseInt(opts.concurrency, 10),
      rateLimitDelay: parseInt(opts.rateLimitDelay, 10),
    });

    await runDetailPipeline({
      config,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      retryErrors: opts.retryErrors,
    });
  });

// ─── Export ─────────────────────────────────────────────

program
  .command('export')
  .description('Export patent data from SQLite to JSON and/or CSV files')
  .option('--format <json|csv|both>', 'Export format', 'both')
  .option('--output <dir>', 'Output directory', './data/exports')
  .option('--source <search|detail>', 'Export search metadata or full detail records')
  .option('--db <path>', 'Database path', './data/patents.db')
  .action(async (opts) => {
    const dbPath = resolve(opts.db);
    const outDir = resolve(opts.output);
    const source = opts.source as string | undefined;
    const timestamp = new Date().toISOString().split('T')[0];

    if (opts.format === 'json' || opts.format === 'both') {
      await exportJSON(dbPath, `${outDir}/patents_${timestamp}.json`, source);
    }
    if (opts.format === 'csv' || opts.format === 'both') {
      await exportCSV(dbPath, `${outDir}/patents_${timestamp}.csv`, source);
    }
  });

// ─── Status ─────────────────────────────────────────────

program
  .command('status')
  .description('Show current pipeline status')
  .option('--db <path>', 'Database path', './data/patents.db')
  .action((opts) => {
    showStatus(resolve(opts.db));
  });

program.parse();
