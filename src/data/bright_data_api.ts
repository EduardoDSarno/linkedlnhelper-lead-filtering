import { deduplicateBy } from '../helpers/deduplicate.js';

// Keeping provider-specific values here prevents them from leaking into CSV code.
const BRIGHT_DATA_HOSTNAME = 'api.brightdata.com';
const LINKEDIN_PROFILE_DATASET_ID = 'gd_l1viktl72bvl7bjuj0';
const BRIGHT_DATA_TRIGGER_URL =
  `https://${BRIGHT_DATA_HOSTNAME}/datasets/v3/trigger` +
  `?dataset_id=${LINKEDIN_PROFILE_DATASET_ID}` +
  '&notify=false&include_errors=true';

/** The useful part of Bright Data's response when an asynchronous job starts. */
export interface BrightDataTriggerResponse {
  snapshot_id: string;

  // Preserve additional response properties without pretending we know their shape yet.
  [key: string]: unknown;
}

/**
 * Starts an asynchronous Bright Data collection job for LinkedIn profile URLs.
 * It returns the snapshot ID; retrieving the completed snapshot will be a separate step.
 */
export async function triggerBrightDataProfileCollection(
  // readonly communicates that this function will not mutate the caller's array.
  profileLinks: readonly string[],
): Promise<BrightDataTriggerResponse> {
  // Clean first so whitespace-only values are excluded before deduplication.
  const cleanedProfileLinks = profileLinks
    .map((link) => link.trim())
    .filter((link) => link.length > 0);

  // The shared helper avoids paying to request the same URL more than once.
  const { uniqueItems: uniqueProfileLinks } = deduplicateBy(
    cleanedProfileLinks,
    (link) => link,
  );

  if (uniqueProfileLinks.length === 0) {
    throw new Error('At least one LinkedIn profile URL is required.');
  }

  // Read the token at call time so it is never stored in the source code.
  const apiKey = process.env['BRIGHTDATA_API_KEY'];

  if (!apiKey) {
    throw new Error('BRIGHTDATA_API_KEY is not configured.');
  }

  // Bright Data expects each URL as an object inside the `input` array.
  const requestBody = JSON.stringify({
    input: uniqueProfileLinks.map((url) => ({ url })),
    limit_per_input: null,
  });

  // fetch returns a Promise, so no callbacks or manual Promise wrapper are needed.
  const response = await fetch(BRIGHT_DATA_TRIGGER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: requestBody,
  });

  // Read the body once as text so an unsuccessful response can include Bright Data's message.
  const responseData = await response.text();

  if (!response.ok) {
    throw new Error(
      `Bright Data request failed with status ${response.status}: ${responseData}`,
    );
  }

  let parsedResponse: unknown;

  try {
    // Parse as unknown first because external API responses are not trusted types.
    parsedResponse = JSON.parse(responseData);
  } catch (error: unknown) {
    throw new Error('Bright Data returned invalid JSON.', { cause: error });
  }

  // Runtime validation protects later code from a missing or invalid snapshot ID.
  if (
    typeof parsedResponse !== 'object' ||
    parsedResponse === null ||
    !('snapshot_id' in parsedResponse) ||
    typeof parsedResponse.snapshot_id !== 'string'
  ) {
    throw new Error('Bright Data returned an unexpected response.');
  }

  return parsedResponse as BrightDataTriggerResponse;
}
