import cliProgress from 'cli-progress';

export interface ProgressTracker {
  overall: cliProgress.SingleBar;
  workers: Map<number, cliProgress.SingleBar>;
  multi: cliProgress.MultiBar;
  startTime: number;
  update(workerId: number, current: number, total: number, label: string): void;
  updateOverall(current: number): void;
  stop(): void;
}

export function createProgressTracker(
  phase: string,
  concurrency: number,
  totalExpected: number,
): ProgressTracker {
  const isDetailPhase = phase.toLowerCase().includes('detail');

  const multi = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format: ' {bar} {percentage}% | {value}/{total} | {label}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
    },
    cliProgress.Presets.shades_grey,
  );

  console.log(`\nUSPTO Patent Pipeline — ${phase}`);
  console.log('═'.repeat(55));

  const overall = multi.create(totalExpected, 0, { label: 'Overall' });
  const workers = new Map<number, cliProgress.SingleBar>();

  for (let i = 0; i < concurrency; i++) {
    if (isDetailPhase) {
      // Detail phase: worker bars just show a patent counter, no progress bar
      const bar = multi.create(1, 0, { label: `W${i + 1}: idle` }, {
        format: ' {label}',
      });
      workers.set(i, bar);
    } else {
      const bar = multi.create(100, 0, { label: `W${i + 1}: idle` });
      workers.set(i, bar);
    }
  }

  const startTime = Date.now();

  return {
    overall,
    workers,
    multi,
    startTime,

    update(workerId: number, current: number, total: number, label: string) {
      const bar = workers.get(workerId);
      if (!bar) return;
      if (isDetailPhase) {
        // Detail phase: show cumulative patent count + current app number
        bar.update(1, { label: `W${workerId + 1}: ${current} patents | ${label}` });
      } else {
        bar.setTotal(total);
        bar.update(current, { label: `W${workerId + 1}: ${label}` });
      }
    },

    updateOverall(current: number) {
      overall.update(current, {
        label: `Overall ${current.toLocaleString()}/${totalExpected.toLocaleString()} | ${formatEta(startTime, current, totalExpected)}`,
      });
    },

    stop() {
      multi.stop();
    },
  };
}

function formatEta(startTime: number, current: number, total: number): string {
  if (current === 0) return 'ETA: calculating...';
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = current / elapsed;
  const remaining = (total - current) / rate;
  if (remaining < 60) return `ETA: ${Math.round(remaining)}s`;
  if (remaining < 3600) return `ETA: ${Math.round(remaining / 60)}m ${Math.round(remaining % 60)}s`;
  return `ETA: ${Math.floor(remaining / 3600)}h ${Math.round((remaining % 3600) / 60)}m`;
}

/** Simple progress logger for non-TTY environments. */
export function createSimpleLogger(phase: string) {
  console.log(`\nUSPTO Patent Pipeline — ${phase}`);
  const startTime = Date.now();
  let lastLog = 0;

  return {
    log(current: number, total: number, extra = '') {
      const now = Date.now();
      if (now - lastLog < 5000 && current < total) return; // log every 5s max
      lastLog = now;
      const pct = total > 0 ? ((current / total) * 100).toFixed(1) : '0';
      const elapsed = ((now - startTime) / 1000).toFixed(0);
      console.log(`  [${elapsed}s] ${current}/${total} (${pct}%) ${extra}`);
    },
    done(total: number) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Done: ${total} records in ${elapsed}s`);
    },
  };
}
