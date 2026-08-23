/** Root for isolated benchmark artifacts; each run adds its own ID directory. */
export const APIFY_BENCHMARK_OUTPUT_ROOT = 'output/benchmarks/apify';

/** Logger service name used to distinguish benchmark records from the pipeline. */
export const APIFY_BENCHMARK_SERVICE_NAME = 'apify-profile-benchmark';

/** Default starting position when no input offset is requested. */
export const DEFAULT_PROFILE_OFFSET = 0;

/** Source label persisted when links are supplied directly on the command line. */
export const DIRECT_LINK_SOURCE_PATH = 'command-line';

/** Stable artifact names shared by the runner, CLI, tests, and documentation. */
export const APIFY_BENCHMARK_ARTIFACT_NAMES = {
  plan: 'plan.json',
  profiles: 'profiles.json',
  failures: 'failures.json',
  summary: 'summary.json',
  log: 'benchmark.log',
} as const;

/** Supported command-line flags for paid execution and benchmark selection. */
export const APIFY_BENCHMARK_FLAGS = {
  execute: '--execute',
  dryRun: '--dry-run',
  offset: '--offset',
  limit: '--limit',
  label: '--label',
  batchSize: '--batch-size',
  concurrency: '--concurrency',
  maxAttempts: '--max-attempts',
  url: '--url',
} as const;
