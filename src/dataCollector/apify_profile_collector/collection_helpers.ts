import { asRecord, asString } from '../../helpers/index.js';
import { PIPELINE_STAGE, displayIndex } from '../../logging/index.js';
import { APIFY_RETRY_JITTER_MS } from './config.js';
import type {
  ApifyBatchContext,
  PendingProfile,
  RawApifyProfile,
} from './types.js';

/**
 * Splits the pending profiles into batches of at most `batchSize`, which is the
 * unit one Actor run accepts. The final batch is short whenever the count does
 * not divide evenly. Relies on `batchSize` being a positive integer, which
 * the configuration resolver guarantees: a zero would never advance the loop.
 */
export function chunkProfiles(
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
 * Reads a URL out of one query field, which the Actor has represented either
 * as a plain string or as an object with the URL under `query` or `url`.
 */
function stringFromQueryField(value: unknown): string | undefined {
  if (typeof value === 'string') return asString(value);

  const record = asRecord(value);
  return record ? asString(record['query']) ?? asString(record['url']) : undefined;
}

/**
 * Recovers the URL a record was requested with, so it can be matched back to
 * its input. The Actor has used several shapes for this over time — a plain
 * `originalQuery` string, an object with `query` or `url`, or a separate
 * `query` object — so each is tried before falling back to the record's own
 * `linkedinUrl`.
 */
export function providerRequestedUrl(
  record: RawApifyProfile,
): string | undefined {
  // Tried in this order: the field the Actor uses today, an older field name,
  // then the record's own URL as a last resort when neither is present.
  return (
    stringFromQueryField(record['originalQuery']) ??
    stringFromQueryField(record['query']) ??
    asString(record['linkedinUrl'])
  );
}

/**
 * Exponential backoff with jitter for the wait between retry rounds: the delay
 * doubles each round, plus a bounded random offset. The jitter
 * matters because all the failures of a round retry together — without it they
 * would hit the provider in a synchronized burst. A base delay of zero disables
 * waiting entirely, which is what keeps tests fast.
 */
export function retryDelayMs(baseDelayMs: number, completedRound: number): number {
  if (baseDelayMs === 0) return 0;

  const exponentialDelay = baseDelayMs * 2 ** (completedRound - 1);
  return exponentialDelay + Math.floor(Math.random() * APIFY_RETRY_JITTER_MS);
}

/**
 * Shared N-of-total fields for one Actor batch so start, success, and failure
 * lines can be grepped as a single progress sequence.
 */
export function apifyBatchProgress(
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
