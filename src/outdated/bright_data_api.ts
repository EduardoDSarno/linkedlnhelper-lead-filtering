import { bdclient, ScrapeJob } from '@brightdata/sdk';

import { deduplicateBy } from '../helpers/deduplicate.js';

// Bright Data checks the collection status at this interval while it works.
const SNAPSHOT_POLL_INTERVAL_MS = 5_000;

// Stop waiting after ten minutes instead of leaving the command running forever.
const SNAPSHOT_POLL_TIMEOUT_MS = 10 * 60 * 1_000;

/**
 * This is deliberately a temporary, permissive type.
 * We will replace it with our real profile interfaces after inspecting an
 * actual LinkedIn response instead of guessing Bright Data's data shape.
 */
export type RawBrightDataProfile = Record<string, unknown>;

/** Returns the configured API key or stops with a clear configuration error. */
function getBrightDataApiKey(): string {
  const apiKey = process.env['BRIGHTDATA_API_KEY'];

  if (!apiKey) {
    throw new Error('BRIGHTDATA_API_KEY is not configured.');
  }

  return apiKey;
}

/** Checks that one value from the external API is a record-like object. */
function isRawBrightDataProfile(value: unknown): value is RawBrightDataProfile {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Collects LinkedIn profiles through Bright Data's official JavaScript SDK.
 * The SDK triggers the job, polls its status, and downloads its result.
 */
export async function collectBrightDataProfiles(
  profileLinks: readonly string[],
): Promise<RawBrightDataProfile[]> {
  // Remove blank and repeated URLs before they can consume Bright Data credits.
  const cleanedProfileLinks = profileLinks
    .map((link) => link.trim())
    .filter((link) => link.length > 0);
  const { uniqueItems: uniqueProfileLinks } = deduplicateBy(
    cleanedProfileLinks,
    (link) => link,
  );

  if (uniqueProfileLinks.length === 0) {
    throw new Error('At least one LinkedIn profile URL is required.');
  }

  // Keep SDK logging quiet because our CLI prints its own useful progress.
  const client = new bdclient({
    apiKey: getBrightDataApiKey(),
    logLevel: 'WARNING',
    structuredLogging: false,
  });

  try {
    // Using an async SDK job lets us request error records as well as successful
    // profiles. We need both when designing the final application data model.
    const collection = await client.scrape.linkedin.collectProfiles(
      uniqueProfileLinks,
      {
        async: true,
        format: 'json',
        includeErrors: true,
      },
    );

    // With `async: true`, the SDK should always return a ScrapeJob. Checking it
    // here protects us if a future SDK version changes that contract.
    if (!(collection instanceof ScrapeJob)) {
      throw new Error('Bright Data SDK did not return an asynchronous job.');
    }

    // toResult performs the status polling and snapshot download for us.
    const collectionStartedAt = Date.now();
    const result = await collection.toResult({
      pollInterval: SNAPSHOT_POLL_INTERVAL_MS,
      pollTimeout: SNAPSHOT_POLL_TIMEOUT_MS,
      onStatus: (status) => {
        const elapsedSeconds = Math.round((Date.now() - collectionStartedAt) / 1000);
        // \r rewrites the same line so the counter updates in place instead of
        // spamming one line per poll.
        process.stdout.write(
          `\rBright Data collection status: ${status} (${elapsedSeconds}s elapsed)`,
        );
      },
    });
    process.stdout.write('\n');

    if (!result.success) {
      throw new Error(
        `Bright Data collection failed: ${result.error ?? 'unknown error'}`,
      );
    }

    // The SDK intentionally types downloaded data as unknown, so retain one
    // small runtime check before treating the response as profile records.
    if (
      !Array.isArray(result.data) ||
      !result.data.every(isRawBrightDataProfile)
    ) {
      throw new Error('Bright Data returned an unexpected profile format.');
    }

    return result.data;
  } finally {
    // The SDK keeps HTTP connections open; always release them, even on errors.
    await client.close();
  }
}
