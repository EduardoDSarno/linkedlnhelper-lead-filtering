import {
  APIFY_BENCHMARK_FLAGS,
  DEFAULT_PROFILE_OFFSET,
} from './constants.js';
import type { ApifyBenchmarkArguments } from './types.js';

const MINIMUM_POSITIVE_INTEGER = 1;

/**
 * Returns the benchmark command syntax used in validation errors and logs.
 *
 * @returns A single-line command usage description.
 */
export function apifyBenchmarkUsage(): string {
  return [
    'npm run benchmark:apify -- (<input-file> | --url <linkedin-url> [...])',
    `[${APIFY_BENCHMARK_FLAGS.execute} | ${APIFY_BENCHMARK_FLAGS.dryRun}]`,
    `[${APIFY_BENCHMARK_FLAGS.offset} <number>]`,
    `[${APIFY_BENCHMARK_FLAGS.limit} <number>]`,
    `[${APIFY_BENCHMARK_FLAGS.label} <text>]`,
    `[${APIFY_BENCHMARK_FLAGS.batchSize} <number>]`,
    `[${APIFY_BENCHMARK_FLAGS.concurrency} <number>]`,
    `[${APIFY_BENCHMARK_FLAGS.maxAttempts} <number>]`,
  ].join(' ');
}

/**
 * Reads the value following a CLI flag and rejects missing flag arguments.
 *
 * @param arguments_ - Complete command-line argument list.
 * @param flagIndex - Position of the flag whose value is required.
 * @returns The following non-empty argument.
 * @throws When the flag has no usable value.
 */
function requiredFlagValue(
  arguments_: readonly string[],
  flagIndex: number,
): string {
  const flag = arguments_[flagIndex];
  const value = arguments_[flagIndex + 1]?.trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`${String(flag)} requires a value.`);
  }
  return value;
}

/**
 * Parses a flag value as an integer and enforces its minimum accepted value.
 *
 * @param rawValue - Untrusted string supplied on the command line.
 * @param flag - Flag name included in a validation error.
 * @param minimum - Smallest accepted integer for this flag.
 * @returns The validated integer.
 * @throws When the value is not an integer or is below the accepted minimum.
 */
function parseIntegerFlag(
  rawValue: string,
  flag: string,
  minimum: number,
): number {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${flag} must be an integer of at least ${minimum}.`);
  }
  return value;
}

/**
 * Converts benchmark CLI arguments into a typed request without calling Apify.
 * Dry-run mode is selected unless the paid-execution flag is explicitly set.
 *
 * @param arguments_ - Arguments following the benchmark entry-point script.
 * @returns Validated input selection and collector override values.
 * @throws For missing paths, unknown flags, conflicting modes, or bad values.
 */
export function parseApifyBenchmarkArguments(
  arguments_: readonly string[],
): ApifyBenchmarkArguments {
  let inputPath: string | undefined;
  const profileLinks: string[] = [];
  let execute = false;
  let explicitDryRun = false;
  let offset = DEFAULT_PROFILE_OFFSET;
  let limit: number | undefined;
  let label: string | undefined;
  let batchSize: number | undefined;
  let concurrency: number | undefined;
  let maxAttempts: number | undefined;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument) continue;

    switch (argument) {
      case APIFY_BENCHMARK_FLAGS.execute:
        execute = true;
        continue;
      case APIFY_BENCHMARK_FLAGS.dryRun:
        explicitDryRun = true;
        continue;
      case APIFY_BENCHMARK_FLAGS.offset:
        offset = parseIntegerFlag(
          requiredFlagValue(arguments_, index),
          argument,
          DEFAULT_PROFILE_OFFSET,
        );
        index += 1;
        continue;
      case APIFY_BENCHMARK_FLAGS.limit:
        limit = parseIntegerFlag(
          requiredFlagValue(arguments_, index),
          argument,
          MINIMUM_POSITIVE_INTEGER,
        );
        index += 1;
        continue;
      case APIFY_BENCHMARK_FLAGS.label:
        label = requiredFlagValue(arguments_, index);
        index += 1;
        continue;
      case APIFY_BENCHMARK_FLAGS.batchSize:
        batchSize = parseIntegerFlag(
          requiredFlagValue(arguments_, index),
          argument,
          MINIMUM_POSITIVE_INTEGER,
        );
        index += 1;
        continue;
      case APIFY_BENCHMARK_FLAGS.concurrency:
        concurrency = parseIntegerFlag(
          requiredFlagValue(arguments_, index),
          argument,
          MINIMUM_POSITIVE_INTEGER,
        );
        index += 1;
        continue;
      case APIFY_BENCHMARK_FLAGS.maxAttempts:
        maxAttempts = parseIntegerFlag(
          requiredFlagValue(arguments_, index),
          argument,
          MINIMUM_POSITIVE_INTEGER,
        );
        index += 1;
        continue;
      case APIFY_BENCHMARK_FLAGS.url:
        profileLinks.push(requiredFlagValue(arguments_, index));
        index += 1;
        continue;
      default:
        if (argument.startsWith('--')) {
          throw new Error(`Unknown benchmark flag: ${argument}.`);
        }
        if (inputPath) {
          throw new Error('Only one benchmark input file may be supplied.');
        }
        inputPath = argument;
    }
  }

  if (!inputPath && profileLinks.length === 0) {
    throw new Error('An input file or at least one --url value is required.');
  }
  if (inputPath && profileLinks.length > 0) {
    throw new Error('Use either an input file or direct --url values, not both.');
  }
  if (execute && explicitDryRun) {
    throw new Error('Choose either paid execution or dry-run mode, not both.');
  }

  return {
    ...(inputPath ? { inputPath } : {}),
    profileLinks,
    execute,
    offset,
    ...(limit !== undefined ? { limit } : {}),
    ...(label ? { label } : {}),
    collectorOptions: {
      ...(batchSize !== undefined ? { batchSize } : {}),
      ...(concurrency !== undefined ? { concurrency } : {}),
      ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    },
  };
}
