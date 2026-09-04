import { setTimeout as delay } from 'node:timers/promises';

import { ApifyClient } from 'apify-client';

import {
  APIFY_RETRY_JITTER_MS,
  requireApifyApiKey,
  resolveApifyCollectorConfig,
} from './config.js';
import {
  LINKEDIN_PROFILE_SCRAPER_ACTOR,
  PROFILE_DETAILS_MODE,
} from './constants.js';
import {
  classifyProviderRecord,
  classifyThrownError,
  finalFailure,
} from './error_handling.js';
import type { FailureDescriptor } from './error_handling.js';
import { normalizeLinkedinUrl } from '../../linkedin/index.js';
import { asRecord, asString, deduplicateBy } from '../../helpers/index.js';
import {
  PIPELINE_PROGRESS_MESSAGE,
  PIPELINE_STAGE,
  displayIndex,
} from '../../logging/index.js';
import type { Logger } from '../../logging/index.js';
import type {
  ApifyBatchContext,
  ApifyBatchExecutor,
  ApifyCollectionResult,
  ApifyCollectorOptions,
  ApifyProfileFailure,
  BatchOutcome,
  CollectedProfile,
  PendingProfile,
  RawApifyProfile,
} from './types.js';

/**
 * Splits the pending profiles into batches of at most `batchSize`, which is the
 * unit one Actor run accepts. The final batch is short whenever the count does
 * not divide evenly. Relies on `batchSize` being a positive integer, which
 * the configuration resolver guarantees: a zero would never advance the loop.
 */
function chunkProfiles(
  profiles: readonly PendingProfile[],
  batchSize: number,
): PendingProfile[][] {
  const batches: PendingProfile[][] = [];

  for (let start = 0; start < profiles.length; start += batchSize) {
    batches.push(profiles.slice(start, start + batchSize));
  }

  return batches;
}

/**
 * Recovers the URL a record was requested with, so it can be matched back to
 * its input. The Actor has used several shapes for this over time — a plain
 * `originalQuery` string, an object with `query` or `url`, or a separate
 * `query` object — so each is tried before falling back to the record's own
 * `linkedinUrl`.
 */
function providerQuery(record: RawApifyProfile): string | undefined {
  const originalQuery = record['originalQuery'];
  if (typeof originalQuery === 'string') return asString(originalQuery);

  const originalQueryRecord = asRecord(originalQuery);
  const queryRecord = asRecord(record['query']);

  return (
    (originalQueryRecord
      ? asString(originalQueryRecord['query']) ??
        asString(originalQueryRecord['url'])
      : undefined) ??
    (queryRecord
      ? asString(queryRecord['query']) ?? asString(queryRecord['url'])
      : undefined) ??
    asString(record['linkedinUrl'])
  );
}

/**
 * Correlates dataset items back to their requested URLs.
 *
 * HarvestAPI normally preserves query order and includes `originalQuery`, but
 * query matching is preferred so one missing result cannot shift later items.
 * Positional matching is retained only as a compatibility fallback.
 */
function matchProviderRecords(
  profiles: readonly PendingProfile[],
  records: readonly RawApifyProfile[],
): {
  matches: Array<{ profile: PendingProfile; record?: RawApifyProfile }>;
  unexpectedRecords: number;
} {
  const assignedProfileIndexes = new Set<number>();
  const assignedRecordIndexes = new Set<number>();
  const recordsByInputIndex = new Map<number, RawApifyProfile>();
  const profilesByUrl = new Map<string, PendingProfile>();

  for (const profile of profiles) {
    profilesByUrl.set(normalizeLinkedinUrl(profile.linkedinUrl), profile);
  }

  // First pass: reserve all records that identify their requested profile.
  // This prevents a query-less warning record from taking their position.
  for (const [recordIndex, record] of records.entries()) {
    const query = providerQuery(record);
    const profile = query
      ? profilesByUrl.get(normalizeLinkedinUrl(query))
      : undefined;

    if (!profile || assignedProfileIndexes.has(profile.inputIndex)) continue;

    assignedProfileIndexes.add(profile.inputIndex);
    assignedRecordIndexes.add(recordIndex);
    recordsByInputIndex.set(profile.inputIndex, record);
  }

  // Second pass: use order only for provider records that contain no usable
  // query/URL identity. A record that explicitly identifies an unrequested
  // profile must remain unexpected; assigning it positionally would silently
  // attach the wrong person to the requested URL.
  for (const [recordIndex, record] of records.entries()) {
    if (assignedRecordIndexes.has(recordIndex)) continue;
    if (providerQuery(record) !== undefined) continue;

    const positionalProfile = profiles[recordIndex];
    const profile =
      positionalProfile &&
      !assignedProfileIndexes.has(positionalProfile.inputIndex)
        ? positionalProfile
        : profiles.find(
            (candidate) =>
              !assignedProfileIndexes.has(candidate.inputIndex),
          );

    if (!profile) continue;

    assignedProfileIndexes.add(profile.inputIndex);
    assignedRecordIndexes.add(recordIndex);
    recordsByInputIndex.set(profile.inputIndex, record);
  }

  return {
    matches: profiles.map((profile) => {
      const record = recordsByInputIndex.get(profile.inputIndex);
      return {
        profile,
        ...(record ? { record } : {}),
      };
    }),
    unexpectedRecords: Math.max(0, records.length - assignedRecordIndexes.size),
  };
}

/**
 * Runs one full collection round and returns an outcome per batch, successful
 * or failed.
 *
 * A fixed pool of `concurrency` workers pulls from a shared batch index, so
 * slow batches never leave workers idle and no more than `concurrency` Actor
 * runs are ever in flight. Each batch's error is captured into its outcome
 * rather than thrown, which is what stops one failed batch from cancelling the
 * rest of the round.
 */
async function executeRound(
  profiles: readonly PendingProfile[],
  round: number,
  batchSize: number,
  concurrency: number,
  executeBatch: ApifyBatchExecutor,
  logger: Logger | undefined,
  runRequestedProfiles: number,
): Promise<BatchOutcome[]> {
  const batches = chunkProfiles(profiles, batchSize);
  const outcomes = new Array<BatchOutcome>(batches.length);
  let nextBatchIndex = 0;
  let completedBatches = 0;

  /** Claims and executes Actor batches until the current round is exhausted. */
  async function worker(): Promise<void> {
    while (nextBatchIndex < batches.length) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      const batch = batches[batchIndex];
      if (!batch) continue;

      const context: ApifyBatchContext = {
        round,
        batchNumber: batchIndex + 1,
        totalBatches: batches.length,
      };
      const startedAt = Date.now();
      const progress = apifyBatchProgress(
        batch,
        context,
        concurrency,
        runRequestedProfiles,
      );

      logger?.info(progress, PIPELINE_PROGRESS_MESSAGE.apifyBatchStarted);

      try {
        const execution = await executeBatch(
          batch.map((profile) => profile.linkedinUrl),
          context,
        );
        const durationMs = Date.now() - startedAt;
        outcomes[batchIndex] = {
          profiles: batch,
          context,
          durationMs,
          execution,
        };
        completedBatches += 1;

        logger?.info(
          {
            ...progress,
            completed: completedBatches,
            durationMs,
            requestedProfiles: batch.length,
            receivedRecords: execution.records.length,
            actorRunId: execution.actorRunId,
          },
          PIPELINE_PROGRESS_MESSAGE.apifyBatchCompleted,
        );
      } catch (error: unknown) {
        const durationMs = Date.now() - startedAt;
        outcomes[batchIndex] = {
          profiles: batch,
          context,
          durationMs,
          error,
        };
        completedBatches += 1;

        logger?.warn(
          {
            ...progress,
            completed: completedBatches,
            durationMs,
            requestedProfiles: batch.length,
            linkedinUrls: batch.map((profile) => profile.linkedinUrl),
            err: error,
          },
          PIPELINE_PROGRESS_MESSAGE.apifyBatchFailed,
        );
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, batches.length) },
      async () => worker(),
    ),
  );

  return outcomes;
}

/**
 * Exponential backoff with jitter for the wait between retry rounds: the delay
 * doubles each round, plus a bounded random offset. The jitter
 * matters because all the failures of a round retry together — without it they
 * would hit the provider in a synchronized burst. A base delay of zero disables
 * waiting entirely, which is what keeps tests fast.
 */
function retryDelayMs(baseDelayMs: number, completedRound: number): number {
  if (baseDelayMs === 0) return 0;

  const exponentialDelay = baseDelayMs * 2 ** (completedRound - 1);
  return exponentialDelay + Math.floor(Math.random() * APIFY_RETRY_JITTER_MS);
}

/**
 * Fault-tolerant collection engine used by production and deterministic tests.
 *
 * Every round finishes before its retryable failures are pooled and rebatched.
 * Successful profiles are never requested again, permanent failures are never
 * retried, and one failed batch cannot cancel unrelated batches.
 */
export async function collectApifyProfilesWithExecutor(
  profileLinks: readonly string[],
  executeBatch: ApifyBatchExecutor,
  logger?: Logger,
  options: ApifyCollectorOptions = {},
): Promise<ApifyCollectionResult> {
  const config = resolveApifyCollectorConfig(options);
  const cleanedProfiles = profileLinks
    .map((linkedinUrl, inputIndex) => ({
      linkedinUrl: linkedinUrl.trim(),
      inputIndex,
      attempts: 0,
    }))
    .filter((profile) => profile.linkedinUrl.length > 0);
  const { uniqueItems: uniqueProfiles } = deduplicateBy(
    cleanedProfiles,
    (profile) => normalizeLinkedinUrl(profile.linkedinUrl),
  );

  if (uniqueProfiles.length === 0) {
    throw new Error('At least one LinkedIn profile URL is required.');
  }

  logger?.info(
    {
      stage: PIPELINE_STAGE.apify,
      requestedProfiles: uniqueProfiles.length,
      batchSize: config.profilesPerActorRun,
      concurrency: config.actorRunConcurrency,
      maxAttempts: config.maxAttempts,
    },
    PIPELINE_PROGRESS_MESSAGE.apifyStarted,
  );

  const collected = new Map<number, CollectedProfile>();
  const failures = new Map<number, ApifyProfileFailure>();
  const retriedProfiles = new Set<number>();
  const profileAttempts = new Map<number, number>();
  let pending: PendingProfile[] = uniqueProfiles;
  let roundsCompleted = 0;
  let actorRuns = 0;
  let unexpectedProviderRecords = 0;

  while (
    pending.length > 0 &&
    roundsCompleted < config.maxAttempts
  ) {
    const round = roundsCompleted + 1;
    const outcomes = await executeRound(
      pending,
      round,
      config.profilesPerActorRun,
      config.actorRunConcurrency,
      executeBatch,
      logger,
      uniqueProfiles.length,
    );
    roundsCompleted = round;
    actorRuns += outcomes.length;
    const retryCandidates: PendingProfile[] = [];

    /** Records one failure or schedules the profile for its next safe attempt. */
    function processFailure(
      profile: PendingProfile,
      descriptor: FailureDescriptor,
    ): void {
      const attempts = profile.attempts + 1;
      profileAttempts.set(profile.inputIndex, attempts);

      if (descriptor.category === 'authentication') {
        throw new Error(
          `Apify authentication/authorization failed: ${descriptor.error}`,
        );
      }

      if (
        descriptor.retryable &&
        attempts < config.maxAttempts
      ) {
        retryCandidates.push({ ...profile, attempts });
        retriedProfiles.add(profile.inputIndex);
        return;
      }

      const retryExhausted =
        descriptor.retryable && attempts >= config.maxAttempts;
      const failure = finalFailure(
        profile,
        descriptor,
        attempts,
        retryExhausted,
      );
      failures.set(profile.inputIndex, failure);
      logger?.warn(
        {
          stage: PIPELINE_STAGE.apify,
          linkedinUrl: failure.linkedinUrl,
          profileIndex: displayIndex(failure.inputIndex),
          requestedProfiles: uniqueProfiles.length,
          category: failure.category,
          status: failure.status,
          attempts: failure.attempts,
          retryable: failure.retryable,
          retryExhausted: failure.retryExhausted,
          error: failure.error,
        },
        PIPELINE_PROGRESS_MESSAGE.apifyProfileFailed,
      );
    }

    // Process outcomes only after every batch in the round has settled. This
    // lets failures from different batches be combined into efficient retries.
    for (const outcome of outcomes) {
      if (outcome.error !== undefined) {
        const descriptor = classifyThrownError(outcome.error);
        for (const profile of outcome.profiles) {
          processFailure(profile, descriptor);
        }
        continue;
      }

      if (!outcome.execution) continue;

      const matched = matchProviderRecords(
        outcome.profiles,
        outcome.execution.records,
      );
      unexpectedProviderRecords += matched.unexpectedRecords;

      for (const { profile, record } of matched.matches) {
        if (!record) {
          processFailure(profile, {
            category: 'invalid_response',
            error: 'Provider returned no record for the requested profile.',
            retryable: true,
          });
          continue;
        }

        const descriptor = classifyProviderRecord(record);
        if (descriptor) {
          processFailure(profile, descriptor);
          continue;
        }

        const attempts = profile.attempts + 1;
        profileAttempts.set(profile.inputIndex, attempts);
        collected.set(profile.inputIndex, {
          inputIndex: profile.inputIndex,
          raw: record,
        });
      }
    }

    retryCandidates.sort((left, right) => left.inputIndex - right.inputIndex);
    pending = retryCandidates;

    logger?.info(
      {
        stage: PIPELINE_STAGE.apify,
        round,
        completed: collected.size,
        total: uniqueProfiles.length,
        collectedProfiles: collected.size,
        requestedProfiles: uniqueProfiles.length,
        failedProfiles: failures.size,
        retryProfiles: pending.length,
      },
      PIPELINE_PROGRESS_MESSAGE.apifyRoundProgress,
    );

    if (pending.length > 0) {
      const waitMs = retryDelayMs(
        config.retryBaseDelayMs,
        roundsCompleted,
      );
      logger?.info(
        {
          completedRound: roundsCompleted,
          retryProfiles: pending.length,
          nextRound: roundsCompleted + 1,
          waitMs,
        },
        'Waiting before Apify retry round.',
      );
      await delay(waitMs);
    }
  }

  const orderedProfiles = [...collected.values()]
    .sort((left, right) => left.inputIndex - right.inputIndex)
    .map((profile) => profile.raw);
  const orderedFailures = [...failures.values()].sort(
    (left, right) => left.inputIndex - right.inputIndex,
  );

  return {
    profiles: orderedProfiles,
    failures: orderedFailures,
    stats: {
      requestedProfiles: uniqueProfiles.length,
      collectedProfiles: orderedProfiles.length,
      failedProfiles: orderedFailures.length,
      permanentFailures: orderedFailures.filter(
        (failure) => !failure.retryable,
      ).length,
      exhaustedTransientFailures: orderedFailures.filter(
        (failure) => failure.retryExhausted,
      ).length,
      retriedProfiles: retriedProfiles.size,
      totalProfileAttempts: [...profileAttempts.values()].reduce(
        (total, attempts) => total + attempts,
        0,
      ),
      roundsCompleted,
      retryRounds: Math.max(0, roundsCompleted - 1),
      actorRuns,
      batchSize: config.profilesPerActorRun,
      batchConcurrency: config.actorRunConcurrency,
      unexpectedProviderRecords,
    },
  };
}

/**
 * Shared N-of-total fields for one Actor batch so start, success, and failure
 * lines can be grepped as a single progress sequence.
 */
function apifyBatchProgress(
  batch: readonly PendingProfile[],
  context: ApifyBatchContext,
  concurrency: number,
  runRequestedProfiles: number,
): {
  stage: typeof PIPELINE_STAGE.apify;
  round: number;
  batchNumber: number;
  totalBatches: number;
  total: number;
  batchSize: number;
  concurrency: number;
  runRequestedProfiles: number;
  profileStart: number;
  profileEnd: number;
} {
  const first = batch[0];
  const last = batch[batch.length - 1];

  return {
    stage: PIPELINE_STAGE.apify,
    round: context.round,
    batchNumber: context.batchNumber,
    totalBatches: context.totalBatches,
    total: context.totalBatches,
    batchSize: batch.length,
    concurrency,
    runRequestedProfiles,
    profileStart: first ? displayIndex(first.inputIndex) : 0,
    profileEnd: last ? displayIndex(last.inputIndex) : 0,
  };
}

/**
 * Type guard narrowing an item straight off the Apify dataset to a record. The
 * `value is RawApifyProfile` return type is what lets TypeScript treat the item
 * as a profile after the check; arrays and null are rejected because a dataset
 * item is always expected to be an object.
 */
function isRawApifyProfile(value: unknown): value is RawApifyProfile {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Production entry point for HarvestAPI's LinkedIn profile Actor.
 *
 * Apify's `call` waits for one Actor run to finish. The collection engine calls
 * this executor through a bounded worker pool, then combines all datasets.
 */
export async function collectApifyProfiles(
  profileLinks: readonly string[],
  logger?: Logger,
  options: ApifyCollectorOptions = {},
): Promise<ApifyCollectionResult> {
  const client = new ApifyClient({ token: requireApifyApiKey() });

  /** Executes one configured HarvestAPI Actor batch and reads its dataset. */
  const executeBatch: ApifyBatchExecutor = async (queries) => {
    const run = await client.actor(LINKEDIN_PROFILE_SCRAPER_ACTOR).call({
      profileScraperMode: PROFILE_DETAILS_MODE,
      queries,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    if (!items.every(isRawApifyProfile)) {
      throw new Error('Apify returned an unexpected dataset item format.');
    }

    return {
      records: items,
      actorRunId: run.id,
      datasetId: run.defaultDatasetId,
    };
  };

  return collectApifyProfilesWithExecutor(
    profileLinks,
    executeBatch,
    logger,
    options,
  );
}
