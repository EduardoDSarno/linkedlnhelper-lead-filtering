// This file is the CLI entry point; reusable functions live in sibling modules.
import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '../../helpers/error_message.js';

import { createFileLogger } from '../../logging/index.js';
import type { Logger } from '../../logging/index.js';
import {
  createApifyBenchmarkArtifactPaths,
  runApifyBenchmark,
} from './apify_benchmark_runner.js';
import {
  APIFY_BENCHMARK_OUTPUT_ROOT,
  APIFY_BENCHMARK_SERVICE_NAME,
} from './constants.js';
import {
  apifyBenchmarkUsage,
  parseApifyBenchmarkArguments,
} from './argument_parser.js';
import { loadApifyBenchmarkInput } from './input_loader.js';
import type { ApifyBenchmarkResult } from './types.js';

/**
 * Runs one benchmark command after logging has been initialized.
 *
 * @param arguments_ - Arguments supplied after the benchmark entry point.
 * @param runId - Unique correlation and output-directory identifier.
 * @param outputDirectory - Isolated directory reserved for this run.
 * @param logger - Structured benchmark logger.
 * @returns The dry-run or paid benchmark result.
 * @throws For invalid arguments, input loading failures, or fatal collection errors.
 */
async function main(
  arguments_: readonly string[],
  runId: string,
  outputDirectory: string,
  logger: Logger,
): Promise<ApifyBenchmarkResult> {
  const argumentsResult = parseApifyBenchmarkArguments(arguments_);
  logger.info(
    {
      inputPath: argumentsResult.inputPath,
      directProfileLinks: argumentsResult.profileLinks.length,
      execute: argumentsResult.execute,
      offset: argumentsResult.offset,
      limit: argumentsResult.limit,
      label: argumentsResult.label,
      collectorOptions: argumentsResult.collectorOptions,
    },
    'Loading benchmark input.',
  );

  const input = await loadApifyBenchmarkInput(argumentsResult);

  return runApifyBenchmark(
    {
      runId,
      sourceKind: input.sourceKind,
      sourcePath: input.sourcePath,
      profileLinks: input.profileLinks,
      expectedIdentities: input.expectedIdentities,
      execute: argumentsResult.execute,
      offset: argumentsResult.offset,
      ...(argumentsResult.limit !== undefined
        ? { limit: argumentsResult.limit }
        : {}),
      ...(argumentsResult.label ? { label: argumentsResult.label } : {}),
      collectorOptions: argumentsResult.collectorOptions,
      outputDirectory,
    },
    logger,
  );
}

/**
 * Owns the benchmark CLI lifecycle, file logger, exit status, and final output.
 * Paid provider calls remain impossible unless argument parsing finds the
 * explicit execution flag.
 *
 * @returns A promise that settles after buffered Pino records are flushed.
 */
async function runApplication(): Promise<void> {
  const runId = randomUUID();
  const outputDirectory = join(APIFY_BENCHMARK_OUTPUT_ROOT, runId);
  const artifacts = createApifyBenchmarkArtifactPaths(outputDirectory);
  const loggerHandle = await createFileLogger(
    artifacts.log,
    runId,
    APIFY_BENCHMARK_SERVICE_NAME,
  );
  const { logger } = loggerHandle;

  try {
    logger.info(
      { outputDirectory, usage: apifyBenchmarkUsage() },
      'Apify benchmark command started.',
    );
    const result = await main(
      process.argv.slice(2),
      runId,
      outputDirectory,
      logger,
    );

    if (result.summary.status === 'invariant_failed') {
      process.exitCode = 1;
    }

    process.stdout.write(
      `Apify benchmark ${result.summary.status}. Artifacts: ${outputDirectory}\n`,
    );
  } catch (error: unknown) {
    logger.error(
      {
        err: error,
        error: errorMessage(error),
        usage: apifyBenchmarkUsage(),
        outputDirectory,
      },
      'Apify benchmark command failed.',
    );
    process.exitCode = 1;
    process.stderr.write(
      `Apify benchmark failed. See ${artifacts.log} for details.\n`,
    );
  } finally {
    logger.info(
      { exitCode: process.exitCode ?? 0 },
      'Apify benchmark command stopped.',
    );
    await loggerHandle.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runApplication();
}
