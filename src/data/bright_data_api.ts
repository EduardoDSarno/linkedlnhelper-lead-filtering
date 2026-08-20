import { deduplicateBy } from '../helpers/deduplicate.js';

// Keeping provider-specific values here prevents them from leaking into CSV code.
const BRIGHT_DATA_HOSTNAME = 'api.brightdata.com';
const LINKEDIN_PROFILE_DATASET_ID = 'gd_l1viktl72bvl7bjuj0';
const BRIGHT_DATA_TRIGGER_URL =
  `https://${BRIGHT_DATA_HOSTNAME}/datasets/v3/trigger` +
  `?dataset_id=${LINKEDIN_PROFILE_DATASET_ID}` +
  '&notify=false&include_errors=true';
const BRIGHT_DATA_PROGRESS_URL_BASE = `https://${BRIGHT_DATA_HOSTNAME}/datasets/v3/progress`;
const BRIGHT_DATA_SNAPSHOT_URL_BASE = `https://${BRIGHT_DATA_HOSTNAME}/datasets/v3/snapshot`;

// Polling every five seconds is frequent enough for the command-line tool
// without constantly asking Bright Data for the same status.
const SNAPSHOT_POLL_INTERVAL_MS = 5_000;

type BrightDataSnapshotStatus = 'starting' | 'running' | 'ready' | 'failed';

const BRIGHT_DATA_SNAPSHOT_STATUSES: readonly BrightDataSnapshotStatus[] = [
  'starting',
  'running',
  'ready',
  'failed',
];

/** The useful part of Bright Data's response when an asynchronous job starts. */
export interface BrightDataTriggerResponse {
  snapshot_id: string;

  // Preserve additional response properties without pretending we know their shape yet.
  [key: string]: unknown;
}

/** The response returned while Bright Data is building the snapshot. */
interface BrightDataProgressResponse {
  snapshot_id: string;
  status: BrightDataSnapshotStatus;
  [key: string]: unknown;
}

/**
 * This is deliberately a temporary, permissive type.
 * We will replace it with our real profile interfaces after inspecting an
 * actual LinkedIn snapshot instead of guessing Bright Data's data shape.
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

/** Waits without blocking Node from doing other work. */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Reads a successful Bright Data response or includes its error message. */
async function readBrightDataResponseStatus(response: Response): Promise<unknown> {
  const responseData = await response.text();

  if (!response.ok) {
    throw new Error(
      `Bright Data request failed with status ${response.status}: ${responseData}`,
    );
  }

  try {
    return JSON.parse(responseData) as unknown;
  } catch (error: unknown) {
    throw new Error('Bright Data returned invalid JSON.', { cause: error });
  }
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
  const apiKey = getBrightDataApiKey();

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

  // Parse as unknown first because external API responses are not trusted types.
  const parsedResponse = await readBrightDataResponseStatus(response);

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

/** Confirms a parsed response has the shape of a Bright Data progress response. */
function isBrightDataProgressResponse(
  value: unknown,
): value is BrightDataProgressResponse {
  return (
    typeof value === 'object' && // is an object
    value !== null && // is not null
    'snapshot_id' in value && // contains snapshot_id
    typeof value.snapshot_id === 'string' && // snapshot_id is a string
    'status' in value && // contains status
    // status is one of the accepted values
    BRIGHT_DATA_SNAPSHOT_STATUSES.includes(
      value.status as BrightDataSnapshotStatus,
    )
  );
}

/** Gets the current state of an asynchronous Bright Data collection. */
async function getBrightDataSnapshotProgress(
  snapshotId: string,
): Promise<BrightDataProgressResponse> {
  const response = await fetch(
    `${BRIGHT_DATA_PROGRESS_URL_BASE}/${snapshotId}`,
    {
      headers: {
        Authorization: `Bearer ${getBrightDataApiKey()}`,
      },
    },
  );

  const progress = await readBrightDataResponseStatus(response);

  if (!isBrightDataProgressResponse(progress)) {
    throw new Error('Bright Data returned an unexpected progress response.');
  }

  return progress;
}

/** Polls until the snapshot can be downloaded or Bright Data reports failure. */
async function waitForBrightDataSnapshot(snapshotId: string): Promise<void> {
  while (true) {
    const progress = await getBrightDataSnapshotProgress(snapshotId);

    if (progress.status === 'ready') {
      return;
    }

    if (progress.status === 'failed') {
      throw new Error(`Bright Data collection ${snapshotId} failed.`);
    }

    console.log(`Bright Data snapshot status: ${progress.status}`);
    await wait(SNAPSHOT_POLL_INTERVAL_MS);
  }
}

/** Downloads and minimally validates the completed raw profile records. */
async function downloadBrightDataProfiles(
  snapshotId: string,
): Promise<RawBrightDataProfile[]> {
  const response = await fetch(
    `${BRIGHT_DATA_SNAPSHOT_URL_BASE}/${snapshotId}?format=json`,
    {
      headers: {
        Authorization: `Bearer ${getBrightDataApiKey()}`,
      },
    },
  );

  const snapshot = await readBrightDataResponseStatus(response);

  if (
    !Array.isArray(snapshot) ||
    !snapshot.every(
      (profile) => typeof profile === 'object' && profile !== null,
    )
  ) {
    throw new Error('Bright Data returned an unexpected snapshot format.');
  }

  return snapshot as RawBrightDataProfile[];
}

/**
 * Runs the complete async workflow and returns profile records—not the
 * snapshot ID—to the rest of our application.
 */
export async function collectBrightDataProfiles(
  profileLinks: readonly string[],
): Promise<RawBrightDataProfile[]> {
  const collection = await triggerBrightDataProfileCollection(profileLinks);

  await waitForBrightDataSnapshot(collection.snapshot_id);

  return downloadBrightDataProfiles(collection.snapshot_id);
}
