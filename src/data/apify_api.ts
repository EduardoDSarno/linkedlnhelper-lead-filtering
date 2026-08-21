import { ApifyClient } from 'apify-client';

import { deduplicateBy } from '../helpers/deduplicate.js';

// This Actor accepts existing LinkedIn profile URLs and returns detailed profiles.
const LINKEDIN_PROFILE_SCRAPER_ACTOR =
  'harvestapi/linkedin-profile-scraper';

// We only need LinkedIn profile data, so do not pay for email discovery.
const PROFILE_DETAILS_MODE = 'Profile details no email ($4 per 1k)';

// Confirmed live via Apify Actor warning (2026-08-20 run): "Free users are
// limited up to 10 items per run." Splitting larger requests lets our
// 20-profile evaluation run as two batches.
const PROFILES_PER_RUN = 10;

/**
 * Keep the initial response type permissive until we inspect real Apify data.
 * We can create precise profile interfaces after verifying which fields are
 * consistently populated across the test profiles.
 */
export type RawApifyProfile = Record<string, unknown>;

/** Returns the configured API key or stops with a clear configuration error. */
function getApifyApiKey(): string {
  const apiKey = process.env['APIFY_API_KEY'];

  if (!apiKey) {
    throw new Error('APIFY_API_KEY is not configured.');
  }

  return apiKey;
}

/** Checks that one dataset item is an object before returning it as a profile. */
function isRawApifyProfile(value: unknown): value is RawApifyProfile {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Detects an Actor warning/error item so it is not mistaken for a profile. */
function isApifyErrorRecord(profile: RawApifyProfile): boolean {
  return typeof profile['error'] === 'string';
}

/**
 * Runs HarvestAPI's LinkedIn profile Actor and returns its raw dataset items.
 * Apify's `call` method waits for the Actor to finish, so there is no snapshot
 * polling workflow for our application to manage.
 */
export async function collectApifyProfiles(
  profileLinks: readonly string[],
): Promise<RawApifyProfile[]> {
  // Clean and deduplicate again at the provider boundary. This protects us if
  // this reusable function is called later with URLs from somewhere other than
  // our already-deduplicated CSV importer.
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

  const client = new ApifyClient({
    token: getApifyApiKey(),
  });

  const profiles: RawApifyProfile[] = [];
  const totalRuns = Math.ceil(uniqueProfileLinks.length / PROFILES_PER_RUN);

  for (let start = 0; start < uniqueProfileLinks.length; start += PROFILES_PER_RUN) {
    const batch = uniqueProfileLinks.slice(start, start + PROFILES_PER_RUN);
    const runNumber = start / PROFILES_PER_RUN + 1;
    console.log(`Starting Apify batch ${runNumber} of ${totalRuns}...`);

    // `queries` is the Actor's documented input for profile URLs or public IDs.
    const run = await client.actor(LINKEDIN_PROFILE_SCRAPER_ACTOR).call({
      profileScraperMode: PROFILE_DETAILS_MODE,
      queries: batch,
    });

    // Every Actor run writes its results into a default Apify dataset.
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    if (!items.every(isRawApifyProfile)) {
      throw new Error('Apify returned an unexpected profile format.');
    }

    const errorRecord = items.find(isApifyErrorRecord);
    if (errorRecord) {
      throw new Error(`Apify Actor error: ${String(errorRecord['error'])}`);
    }

    profiles.push(...items);
  }

  return profiles;
}
