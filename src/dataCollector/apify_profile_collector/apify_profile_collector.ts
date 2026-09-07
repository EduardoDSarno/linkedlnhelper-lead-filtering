import { setTimeout as delay } from 'node:timers/promises';

import { resolveApifyCollectorConfig } from './config.js';
import {
  apifyBatchProgress,
  chunkProfiles,
  providerRequestedUrl,
  retryDelayMs,
} from './collection_helpers.js';
import {
  classifyProviderRecord,
  classifyThrownError,
  decideFailureOutcome,
} from './error_handling.js';
import type { FailureDescriptor } from './error_handling.js';
import { normalizeLinkedinUrl } from '../../linkedin/index.js';
import { deduplicateBy } from '../../helpers/index.js';
import {
  PIPELINE_PROGRESS_MESSAGE,
  PIPELINE_STAGE,
  displayIndex,
  elapsedMs,
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
  RoundExecutionContext,
  RoundProgress,
} from './types.js';

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

  // Build the lookup every record will be matched against below, keyed by the
  // same normalization used to read a record's own identity.
  for (const profile of profiles) {
    profilesByUrl.set(normalizeLinkedinUrl(profile.linkedinUrl), profile);
  }

  // First pass: reserve all records that identify their requested profile.
  // This prevents a query-less warning record from taking their position.
  for (const [recordIndex, record] of records.entries()) {
    const query = providerRequestedUrl(record);
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
    if (providerRequestedUrl(record) !== undefined) continue;

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
    // Every requested profile gets an entry, with or without a matched
    // record — this is what lets the caller tell "collected" from "no record
    // came back" apart from "matched to something the record didn't identify."
    matches: profiles.map((profile) => {
      const record = recordsByInputIndex.get(profile.inputIndex);
      return {
        profile,
        ...(record ? { record } : {}),
      };
    }),
    // Records that never got claimed above — the provider returned more, or
    // different, data than was requested.
    unexpectedRecords: Math.max(0, records.length - assignedRecordIndexes.size),
  };
}

/**
 * Claims and executes Actor batches until the round is exhausted.
 *
 * Several instances of this run concurrently, each pulling the next unclaimed
 * batch from the shared `roundState.nextBatchIndex`. Claiming a batch (reading
 * the index, then incrementing it) must stay synchronous, with no `await` in
 * between — otherwise two runners could read the same index before either
 * increments it, and claim the same batch twice.
 */
async function claimAndRunBatches(
  roundContext: RoundExecutionContext,
  roundState: RoundProgress,
): Promise<void> {
  while (roundState.nextBatchIndex < roundContext.batches.length) {
    // Claim this batch before doing anything else with it — see the docstring
    // above for why these two lines must stay adjacent, with no `await`.
    const batchIndex = roundState.nextBatchIndex;
    roundState.nextBatchIndex += 1;
    const batch = roundContext.batches[batchIndex];
    if (!batch) continue;

    const context: ApifyBatchContext = {
      round: roundContext.round,
      batchNumber: batchIndex + 1,
      totalBatches: roundContext.batches.length,
    };
    const startedAt = Date.now();
    const progress = apifyBatchProgress(
      batch,
      context,
      roundContext.concurrency,
      roundContext.runRequestedProfiles,
    );

    roundContext.logger?.info(progress, PIPELINE_PROGRESS_MESSAGE.apifyBatchStarted);

    try {
      // The actual Apify Actor call — everything above is bookkeeping for it,
      // everything below is recording what it returned.
      const execution = await roundContext.executeBatch(
        batch.map((profile) => profile.linkedinUrl),
        context,
      );
      const durationMs = elapsedMs(startedAt);
      roundState.outcomes[batchIndex] = {
        profiles: batch,
        context,
        durationMs,
        execution,
      };
      roundState.completedBatches += 1;

      roundContext.logger?.info(
        {
          ...progress,
          completed: roundState.completedBatches,
          durationMs,
          requestedProfiles: batch.length,
          receivedRecords: execution.records.length,
          actorRunId: execution.actorRunId,
        },
        PIPELINE_PROGRESS_MESSAGE.apifyBatchCompleted,
      );
    } catch (error: unknown) {
      // The whole batch failed (e.g. the Actor run itself errored) rather
      // than any one profile. Caught here, not left to reject `Promise.all`,
      // so one bad batch cannot cancel the batches still running concurrently.
      const durationMs = elapsedMs(startedAt);
      roundState.outcomes[batchIndex] = {
        profiles: batch,
        context,
        durationMs,
        error,
      };
      roundState.completedBatches += 1;

      roundContext.logger?.warn(
        {
          ...progress,
          completed: roundState.completedBatches,
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

/**
 * Runs one full collection round and returns an outcome per batch, successful
 * or failed.
 *
 * A fixed pool of `concurrency` batch runners pulls from a shared batch index,
 * so slow batches never leave runners idle and no more than `concurrency`
 * Actor runs are ever in flight. Each batch's error is captured into its
 * outcome rather than thrown, which is what stops one failed batch from
 * cancelling the rest of the round.
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
  // Read-only for every runner below, and the shared claim state they mutate.
  const roundContext: RoundExecutionContext = {
    round,
    batches,
    concurrency,
    executeBatch,
    logger,
    runRequestedProfiles,
  };
  const roundState: RoundProgress = {
    nextBatchIndex: 0,
    completedBatches: 0,
    outcomes: new Array<BatchOutcome>(batches.length),
  };

  // Never spawn more runners than there are batches — a small round should
  // not create idle runners that immediately find nothing left to claim.
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, batches.length) },
      async () => claimAndRunBatches(roundContext, roundState),
    ),
  );

  return roundState.outcomes;
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
  // `inputIndex` is assigned here, before dedup, so it always reflects the
  // caller's original ordering — the final result is sorted back into it.
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

  // All keyed by inputIndex, so a profile's state can be found regardless of
  // which round or batch last touched it.
  const collected = new Map<number, CollectedProfile>();
  const failures = new Map<number, ApifyProfileFailure>();
  const retriedProfiles = new Set<number>();
  const profileAttempts = new Map<number, number>();
  let pending: PendingProfile[] = uniqueProfiles;
  let roundsCompleted = 0;
  let actorRuns = 0;
  let unexpectedProviderRecords = 0;

  // One iteration = one full round of Actor runs, across every still-pending
  // profile. Stops when nothing is pending, or the attempt budget runs out —
  // whichever comes first.
  while (
    pending.length > 0 &&
    roundsCompleted < config.maxAttempts
  ) {
    const round = roundsCompleted + 1;
    const roundStartedAt = Date.now();
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

    /**
     * Decides one failed attempt's outcome, then applies it: abort the whole
     * collection, queue the profile for its next attempt, or record it as a
     * final failure. The decision itself lives in `decideFailureOutcome`,
     * which touches nothing outside its arguments; this is only the part that
     * writes to the round's shared retry queue, failure map, and log.
     */
    function applyFailureOutcome(
      profile: PendingProfile,
      descriptor: FailureDescriptor,
    ): void {
      const outcome = decideFailureOutcome(profile, descriptor, config.maxAttempts);

      // Authentication failures abort the whole collection rather than just
      // this profile — see decideFailureOutcome for why.
      if (outcome.kind === 'abort') throw new Error(outcome.message);

      if (outcome.kind === 'retry') {
        // Queued for this round's retryCandidates, not requested again yet —
        // the whole round finishes first, then every retry candidate goes
        // into the next round's batches together.
        profileAttempts.set(profile.inputIndex, outcome.profile.attempts);
        retryCandidates.push(outcome.profile);
        retriedProfiles.add(profile.inputIndex);
        return;
      }

      // Retry budget exhausted, or the failure category was never retryable
      // to begin with (e.g. a 404) — this profile is done.
      profileAttempts.set(profile.inputIndex, outcome.failure.attempts);
      failures.set(profile.inputIndex, outcome.failure);
      logger?.warn(
        {
          stage: PIPELINE_STAGE.apify,
          linkedinUrl: outcome.failure.linkedinUrl,
          profileIndex: displayIndex(outcome.failure.inputIndex),
          requestedProfiles: uniqueProfiles.length,
          category: outcome.failure.category,
          status: outcome.failure.status,
          attempts: outcome.failure.attempts,
          retryable: outcome.failure.retryable,
          retryExhausted: outcome.failure.retryExhausted,
          error: outcome.failure.error,
        },
        PIPELINE_PROGRESS_MESSAGE.apifyProfileFailed,
      );
    }

    // Process outcomes only after every batch in the round has settled. This
    // lets failures from different batches be combined into efficient retries.
    for (const outcome of outcomes) {
      if (outcome.error !== undefined) {
        // The whole batch's Actor run threw — every profile in it gets the
        // same failure, classified once rather than per profile.
        const descriptor = classifyThrownError(outcome.error);
        for (const profile of outcome.profiles) {
          applyFailureOutcome(profile, descriptor);
        }
        continue;
      }

      if (!outcome.execution) continue;

      // The batch itself succeeded, but that says nothing about individual
      // profiles yet — each returned record still needs matching and
      // classifying below.
      const matched = matchProviderRecords(
        outcome.profiles,
        outcome.execution.records,
      );
      unexpectedProviderRecords += matched.unexpectedRecords;

      for (const { profile, record } of matched.matches) {
        if (!record) {
          // Nothing came back for this profile at all — treated as
          // retryable, since a missing record is usually transient.
          applyFailureOutcome(profile, {
            category: 'invalid_response',
            error: 'Provider returned no record for the requested profile.',
            retryable: true,
          });
          continue;
        }

        // A record came back, but it may itself be an error the provider
        // embedded inside a "successful" batch (e.g. a per-profile 404).
        const descriptor = classifyProviderRecord(record);
        if (descriptor) {
          applyFailureOutcome(profile, descriptor);
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

    // Sorted so the next round's batches are built in a stable, predictable
    // order rather than whatever order batches happened to settle in.
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
        durationMs: elapsedMs(roundStartedAt),
      },
      PIPELINE_PROGRESS_MESSAGE.apifyRoundProgress,
    );

    if (pending.length > 0) {
      // Wait before the next round only — a round that collected everything
      // returns immediately, with no delay tacked onto the end.
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

  // Collection can finish profiles in any order across rounds and batches —
  // sort both back into the caller's original input order before returning.
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

