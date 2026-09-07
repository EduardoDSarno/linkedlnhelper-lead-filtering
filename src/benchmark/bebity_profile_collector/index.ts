import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { BEBITY_LINKEDIN_PREMIUM_ACTOR, collectBebityProfiles, resolveBebityProfileFields } from '../../dataCollector/apify_profile_collector/bebity_profile_collector/index.js';
import { writeJsonAtomically } from '../../helpers/index.js';
import { createFileLogger } from '../../logging/index.js';
import {
  createApifyBenchmarkArtifactPaths,
  runApifyBenchmark,
} from '../apify_profile_collector/apify_benchmark_runner.js';
import {
  apifyBenchmarkUsage,
  parseApifyBenchmarkArguments,
} from '../apify_profile_collector/argument_parser.js';
import { loadApifyBenchmarkInput } from '../apify_profile_collector/input_loader.js';

async function main(): Promise<void> {
  const runId = randomUUID();
  const outputDirectory = join('output/benchmarks/bebity', runId);
  const artifacts = createApifyBenchmarkArtifactPaths(outputDirectory);
  const loggerHandle = await createFileLogger(artifacts.log, runId, 'bebity-profile-benchmark');
  try {
    const args = parseApifyBenchmarkArguments(process.argv.slice(2));
    const input = await loadApifyBenchmarkInput(args);
    const profileFields = resolveBebityProfileFields();
    await writeJsonAtomically(join(outputDirectory, 'bebity-request.json'), { actor: BEBITY_LINKEDIN_PREMIUM_ACTOR, action: 'get-profiles', profileFields: profileFields ?? 'all' });
    const result = await runApifyBenchmark({ runId, sourceKind: input.sourceKind, sourcePath: input.sourcePath, profileLinks: input.profileLinks, expectedIdentities: input.expectedIdentities, execute: args.execute, offset: args.offset, ...(args.limit !== undefined ? { limit: args.limit } : {}), ...(args.label ? { label: args.label } : {}), collectorOptions: args.collectorOptions, outputDirectory }, loggerHandle.logger, { collectProfiles: collectBebityProfiles, environment: process.env, now: () => new Date() });
    if (result.summary.status === 'invariant_failed') process.exitCode = 1;
    process.stdout.write(`Bebity benchmark ${result.summary.status}. Artifacts: ${outputDirectory}\n`);
  } catch (error: unknown) {
    loggerHandle.logger.error({ err: error, usage: apifyBenchmarkUsage() }, 'Bebity benchmark failed.');
    process.exitCode = 1;
    process.stderr.write(`Bebity benchmark failed. See ${artifacts.log} for details.\n`);
  } finally { await loggerHandle.close(); }
}
void main();
