import { join } from 'node:path';

import { collectApifyProfiles } from '../../data/apify_profile_collector/index.js';
import { resolveApifyCollectorConfig } from '../../data/apify_profile_collector/index.js';
import type {
  ApifyCollectionResult,
  RawApifyProfile,
} from '../../data/apify_profile_collector/index.js';
import { deduplicateBy } from '../../helpers/deduplicate.js';
import { normalizeLinkedinUrl } from '../../linkedin/index.js';
import { writeJsonAtomically } from '../../helpers/write_json_atomically.js';
import type { Logger } from '../../logging/index.js';
import { APIFY_BENCHMARK_ARTIFACT_NAMES } from './constants.js';
import type {
  ApifyBenchmarkArtifactPaths,
  ApifyBenchmarkDependencies,
  ApifyBenchmarkExpectedIdentity,
  ApifyBenchmarkIdentityComparison,
  ApifyBenchmarkPlan,
  ApifyBenchmarkRequest,
  ApifyBenchmarkResult,
  ApifyBenchmarkSummary,
  ApifyBenchmarkValidation,
} from './types.js';

interface PreparedApifyBenchmark {
  plan: ApifyBenchmarkPlan;
  selectedProfileLinks: string[];
  selectedExpectedIdentities: ApifyBenchmarkExpectedIdentity[];
}

/** Returns the current wall-clock time for production benchmark timestamps. */
function currentDate(): Date {
  return new Date();
}

const DEFAULT_DEPENDENCIES: ApifyBenchmarkDependencies = {
  collectProfiles: collectApifyProfiles,
  environment: process.env,
  now: currentDate,
};

/**
 * Converts any thrown value into a stable message for JSON artifacts and logs.
 *
 * @param error - Value caught from collection or artifact persistence.
 * @returns The Error message or a string representation of another value.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds every artifact path from the caller's unique benchmark directory.
 *
 * @param outputDirectory - Directory reserved for this benchmark run.
 * @returns Stable paths for the plan, data, summary, and log artifacts.
 */
export function createApifyBenchmarkArtifactPaths(
  outputDirectory: string,
): ApifyBenchmarkArtifactPaths {
  return {
    directory: outputDirectory,
    plan: join(outputDirectory, APIFY_BENCHMARK_ARTIFACT_NAMES.plan),
    profiles: join(outputDirectory, APIFY_BENCHMARK_ARTIFACT_NAMES.profiles),
    failures: join(outputDirectory, APIFY_BENCHMARK_ARTIFACT_NAMES.failures),
    summary: join(outputDirectory, APIFY_BENCHMARK_ARTIFACT_NAMES.summary),
    log: join(outputDirectory, APIFY_BENCHMARK_ARTIFACT_NAMES.log),
  };
}

/**
 * Cleans and deduplicates candidate URLs before applying offset and limit.
 * Selection happens after deduplication so benchmark segments remain stable.
 *
 * @param profileLinks - URLs supplied directly or through an input adapter.
 * @returns Unique, non-empty URLs in their original order.
 */
function uniqueProfileLinks(profileLinks: readonly string[]): string[] {
  const cleanedLinks = profileLinks
    .map((profileLink) => profileLink.trim())
    .filter((profileLink) => profileLink.length > 0);

  return deduplicateBy(cleanedLinks, normalizeLinkedinUrl).uniqueItems;
}

/**
 * Creates the no-cost execution preview and selected URL subset for a run.
 *
 * @param request - Benchmark source, selection, and configuration request.
 * @param environment - Environment used by the collector configuration resolver.
 * @returns The persisted plan and the exact URLs that a paid run would submit.
 * @throws When selection produces no profiles.
 */
export function prepareApifyBenchmark(
  request: ApifyBenchmarkRequest,
  environment: NodeJS.ProcessEnv = process.env,
): PreparedApifyBenchmark {
  const availableLinks = uniqueProfileLinks(request.profileLinks);
  const selectionEnd =
    request.limit === undefined
      ? availableLinks.length
      : request.offset + request.limit;
  const selectedProfileLinks = availableLinks.slice(
    request.offset,
    selectionEnd,
  );
  const selectedUrlSet = new Set(
    selectedProfileLinks.map(normalizeLinkedinUrl),
  );
  const selectedExpectedIdentities = (request.expectedIdentities ?? []).filter(
    (identity) => selectedUrlSet.has(normalizeLinkedinUrl(identity.linkedinUrl)),
  );

  if (selectedProfileLinks.length === 0) {
    throw new Error(
      'The benchmark selection does not contain any LinkedIn profile URLs.',
    );
  }

  const configuration = resolveApifyCollectorConfig(
    request.collectorOptions,
    environment,
  );
  const plannedInitialActorRuns = Math.ceil(
    selectedProfileLinks.length / configuration.profilesPerActorRun,
  );
  const plannedInitialWaves = Math.ceil(
    plannedInitialActorRuns / configuration.actorRunConcurrency,
  );

  return {
    plan: {
      runId: request.runId,
      ...(request.label ? { label: request.label } : {}),
      sourceKind: request.sourceKind,
      sourcePath: request.sourcePath,
      mode: request.execute ? 'execute' : 'dry_run',
      availableProfiles: availableLinks.length,
      selectedProfiles: selectedProfileLinks.length,
      selectedProfileLinks,
      expectedIdentityCount: selectedExpectedIdentities.length,
      offset: request.offset,
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      configuration,
      plannedInitialActorRuns,
      plannedInitialWaves,
    },
    selectedProfileLinks,
    selectedExpectedIdentities,
  };
}

/**
 * Reads the canonical LinkedIn URL required on a successful provider record.
 *
 * @param profile - Untouched provider record returned as successful.
 * @returns A normalized comparison URL, or undefined when the field is absent.
 */
function successfulProfileUrl(
  profile: RawApifyProfile,
): string | undefined {
  const linkedinUrl = profile['linkedinUrl'];
  return typeof linkedinUrl === 'string' && linkedinUrl.trim().length > 0
    ? normalizeLinkedinUrl(linkedinUrl)
    : undefined;
}

/**
 * Produces a comparison-friendly person name without changing stored values.
 *
 * @param value - Name obtained from source identity or provider data.
 * @returns Lowercase name with repeated whitespace collapsed, or undefined.
 */
function normalizePersonName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized || undefined;
}

/**
 * Chooses the best available display name from optional identity fields.
 *
 * @param identity - Expected or provider identity fields.
 * @returns Full name or a first/last-name combination when available.
 */
function identityName(identity: {
  fullName?: string;
  firstName?: string;
  lastName?: string;
}): string | undefined {
  const fullName = identity.fullName?.trim();
  if (fullName) return fullName;
  const combinedName = [identity.firstName, identity.lastName]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' ');
  return combinedName || undefined;
}

/**
 * Compares optional source names with successful Apify records as an advisory
 * identity check. Differences are reported but never affect benchmark validity.
 *
 * @param expectedIdentities - Selected name evidence supplied by an input adapter.
 * @param profiles - Successful untouched Apify profile records.
 * @returns Comparison totals and mismatches, or undefined when names are absent.
 */
export function compareApifyBenchmarkIdentities(
  expectedIdentities: readonly ApifyBenchmarkExpectedIdentity[],
  profiles: readonly RawApifyProfile[],
): ApifyBenchmarkIdentityComparison | undefined {
  const expectedByUrl = new Map(
    expectedIdentities.map((identity) => [
      normalizeLinkedinUrl(identity.linkedinUrl),
      identity,
    ]),
  );
  const mismatches: ApifyBenchmarkIdentityComparison['mismatches'] = [];
  let comparedProfiles = 0;
  let matchingProfiles = 0;

  for (const profile of profiles) {
    const profileUrl = successfulProfileUrl(profile);
    if (!profileUrl) continue;
    const expected = expectedByUrl.get(profileUrl);
    if (!expected) continue;
    const expectedName = identityName(expected);
    if (!expectedName) continue;
    const actualName = identityName({
      ...(typeof profile['fullName'] === 'string'
        ? { fullName: profile['fullName'] }
        : {}),
      ...(typeof profile['firstName'] === 'string'
        ? { firstName: profile['firstName'] }
        : {}),
      ...(typeof profile['lastName'] === 'string'
        ? { lastName: profile['lastName'] }
        : {}),
    });
    comparedProfiles += 1;

    if (
      normalizePersonName(expectedName) === normalizePersonName(actualName)
    ) {
      matchingProfiles += 1;
      continue;
    }

    mismatches.push({
      linkedinUrl: expected.linkedinUrl,
      expectedName,
      ...(actualName ? { actualName } : {}),
    });
  }

  return comparedProfiles > 0
    ? { comparedProfiles, matchingProfiles, mismatches }
    : undefined;
}

/**
 * Compares requested inputs, returned profiles, failures, and aggregate stats.
 * Provider-level failures may be valid; lost, duplicate, or invented profiles
 * make the benchmark untrustworthy.
 *
 * @param selectedProfileLinks - Exact deduplicated input subset sent to Apify.
 * @param collection - Production collector result to validate.
 * @returns Individual invariants, missing/unexpected URLs, and readable errors.
 */
export function validateApifyBenchmarkCollection(
  selectedProfileLinks: readonly string[],
  collection: ApifyCollectionResult,
): ApifyBenchmarkValidation {
  const requestedUrls = selectedProfileLinks.map(normalizeLinkedinUrl);
  const successfulUrls = collection.profiles
    .map(successfulProfileUrl)
    .filter((profileUrl): profileUrl is string => profileUrl !== undefined);
  const failureUrls = collection.failures.map((failure) =>
    normalizeLinkedinUrl(failure.linkedinUrl),
  );
  const requestedSet = new Set(requestedUrls);
  const successfulSet = new Set(successfulUrls);
  const failureSet = new Set(failureUrls);
  const resultSet = new Set([...successfulSet, ...failureSet]);
  const missingProfileLinks = requestedUrls.filter(
    (profileUrl) => !resultSet.has(profileUrl),
  );
  const unexpectedProfileLinks = [...resultSet].filter(
    (profileUrl) => !requestedSet.has(profileUrl),
  );
  const reconciledCounts =
    collection.stats.requestedProfiles === selectedProfileLinks.length &&
    collection.stats.collectedProfiles === collection.profiles.length &&
    collection.stats.failedProfiles === collection.failures.length &&
    collection.profiles.length + collection.failures.length ===
      selectedProfileLinks.length;
  const noDuplicateProfiles = successfulSet.size === successfulUrls.length;
  const noDuplicateFailures = failureSet.size === failureUrls.length;
  const noOverlappingResults = [...successfulSet].every(
    (profileUrl) => !failureSet.has(profileUrl),
  );
  const noMissingInputs = missingProfileLinks.length === 0;
  const noUnexpectedResults = unexpectedProfileLinks.length === 0;
  const noUnexpectedProviderRecords =
    collection.stats.unexpectedProviderRecords === 0;
  const errors: string[] = [];

  if (!reconciledCounts) errors.push('Collection counts do not reconcile.');
  if (!noDuplicateProfiles) errors.push('Successful profiles contain duplicates.');
  if (!noDuplicateFailures) errors.push('Profile failures contain duplicates.');
  if (!noOverlappingResults) {
    errors.push('At least one profile appears in successes and failures.');
  }
  if (!noMissingInputs) errors.push('At least one requested profile is missing.');
  if (!noUnexpectedResults) {
    errors.push('At least one result was not present in the selected input.');
  }
  if (!noUnexpectedProviderRecords) {
    errors.push('The provider returned unexpected dataset records.');
  }

  return {
    passed: errors.length === 0,
    reconciledCounts,
    noDuplicateProfiles,
    noDuplicateFailures,
    noOverlappingResults,
    noMissingInputs,
    noUnexpectedResults,
    noUnexpectedProviderRecords,
    missingProfileLinks,
    unexpectedProfileLinks,
    errors,
  };
}

/**
 * Produces a summary sharing the benchmark's plan, timestamps, and artifacts.
 *
 * @param summary - Summary fields specific to the current terminal status.
 * @returns A complete serializable benchmark summary.
 */
function buildSummary(
  summary: Omit<ApifyBenchmarkSummary, 'durationMs'>,
): ApifyBenchmarkSummary {
  return {
    ...summary,
    durationMs:
      new Date(summary.completedAt).getTime() -
      new Date(summary.startedAt).getTime(),
  };
}

/**
 * Plans a benchmark, optionally performs paid collection, validates results,
 * and writes isolated artifacts. Dry-run mode never calls the collector.
 *
 * @param request - Complete benchmark selection and execution request.
 * @param logger - Structured file logger for the benchmark run.
 * @param dependencies - Injectable collector, environment, and clock.
 * @returns The plan, terminal summary, and any collected profile data.
 * @throws After writing a fatal summary when paid collection itself throws.
 */
export async function runApifyBenchmark(
  request: ApifyBenchmarkRequest,
  logger: Logger,
  dependencies: ApifyBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<ApifyBenchmarkResult> {
  const startedAt = dependencies.now();
  const artifacts = createApifyBenchmarkArtifactPaths(request.outputDirectory);
  const prepared = prepareApifyBenchmark(request, dependencies.environment);

  await writeJsonAtomically(artifacts.plan, prepared.plan);
  logger.info(
    {
      mode: prepared.plan.mode,
      selectedProfiles: prepared.plan.selectedProfiles,
      plannedInitialActorRuns: prepared.plan.plannedInitialActorRuns,
      plannedInitialWaves: prepared.plan.plannedInitialWaves,
      configuration: prepared.plan.configuration,
      planPath: artifacts.plan,
    },
    'Prepared Apify benchmark plan.',
  );

  if (!request.execute) {
    const completedAt = dependencies.now();
    const summary = buildSummary({
      runId: request.runId,
      status: 'dry_run',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      plan: prepared.plan,
      artifacts,
    });
    await writeJsonAtomically(artifacts.summary, summary);
    logger.info(
      { summaryPath: artifacts.summary },
      'Completed Apify benchmark dry run without provider calls.',
    );
    return {
      plan: prepared.plan,
      summary,
      profiles: [],
      failures: [],
      artifacts,
    };
  }

  try {
    logger.info(
      { selectedProfiles: prepared.selectedProfileLinks.length },
      'Starting paid Apify benchmark execution.',
    );
    const collection = await dependencies.collectProfiles(
      prepared.selectedProfileLinks,
      logger,
      request.collectorOptions,
    );
    const validation = validateApifyBenchmarkCollection(
      prepared.selectedProfileLinks,
      collection,
    );
    const identityComparison = compareApifyBenchmarkIdentities(
      prepared.selectedExpectedIdentities,
      collection.profiles,
    );
    const completedAt = dependencies.now();
    const summary = buildSummary({
      runId: request.runId,
      status: validation.passed ? 'completed' : 'invariant_failed',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      plan: prepared.plan,
      collection: collection.stats,
      validation,
      ...(identityComparison ? { identityComparison } : {}),
      artifacts,
    });

    await Promise.all([
      writeJsonAtomically(artifacts.profiles, collection.profiles),
      writeJsonAtomically(artifacts.failures, collection.failures),
      writeJsonAtomically(artifacts.summary, summary),
    ]);
    logger.info(
      {
        status: summary.status,
        collectedProfiles: collection.profiles.length,
        failedProfiles: collection.failures.length,
        validationErrors: validation.errors,
        identityMismatches: identityComparison?.mismatches.length,
        summaryPath: artifacts.summary,
      },
      'Completed paid Apify benchmark execution.',
    );

    return {
      plan: prepared.plan,
      summary,
      profiles: collection.profiles,
      failures: collection.failures,
      artifacts,
    };
  } catch (error: unknown) {
    const completedAt = dependencies.now();
    const fatalError = errorMessage(error);
    const summary = buildSummary({
      runId: request.runId,
      status: 'fatal',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      plan: prepared.plan,
      fatalError,
      artifacts,
    });
    await writeJsonAtomically(artifacts.summary, summary);
    logger.error(
      { err: error, fatalError, summaryPath: artifacts.summary },
      'Apify benchmark execution failed.',
    );
    throw error;
  }
}
