import 'dotenv/config';

export interface PipelineConfig {
  apiKey: string;
  dbPath: string;
  concurrency: number;
  chunkMonths: number;
  rateLimitDelay: number;
  rateLimitBackoff: number;
  maxRetries: number;
  pageSize: number;
}

const defaults: Omit<PipelineConfig, 'apiKey'> = {
  dbPath: './data/patents.db',
  concurrency: 3,
  chunkMonths: 6,
  rateLimitDelay: 250,
  rateLimitBackoff: 5000,
  maxRetries: 3,
  pageSize: 25,
};

export function loadConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  // Filter out undefined values from overrides so they don't clobber defaults
  const cleaned = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined),
  ) as Partial<PipelineConfig>;

  const apiKey =
    cleaned.apiKey ||
    process.env.USPTO_API_KEY ||
    process.env.VITE_USPTO_API_KEY ||
    '';

  if (!apiKey) {
    console.error(
      'Error: No API key found. Set USPTO_API_KEY in .env or pass --api-key.',
    );
    process.exit(1);
  }

  return { ...defaults, ...cleaned, apiKey };
}
