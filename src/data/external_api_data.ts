import { request } from 'node:https';
import type { RequestOptions } from 'node:https';

// Keeping provider-specific values here prevents them from leaking into CSV code.
const BRIGHT_DATA_HOSTNAME = 'api.brightdata.com';
const LINKEDIN_PROFILE_DATASET_ID = 'gd_l1viktl72bvl7bjuj0';

/** The useful part of Bright Data's response when an asynchronous job starts. */
export interface BrightDataTriggerResponse {
  snapshot_id: string;

  // Preserve additional response properties without pretending we know their shape yet.
  [key: string]: unknown;
}

/** Builds the HTTPS configuration shared by every profile-enrichment request. */
function createRequestOptions(apiKey: string): RequestOptions {
  return {
    hostname: BRIGHT_DATA_HOSTNAME,
    path:
      `/datasets/v3/trigger?dataset_id=${LINKEDIN_PROFILE_DATASET_ID}` +
      '&notify=false&include_errors=true',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };
}

/**
 * Starts an asynchronous Bright Data collection job for LinkedIn profile URLs.
 * It returns the snapshot ID; retrieving the completed snapshot will be a separate step.
 */
export async function triggerBrightDataProfileCollection(
  // readonly communicates that this function will not mutate the caller's array.
  profileLinks: readonly string[],

  // Supplying options is useful for tests; normal calls use the Bright Data defaults.
  options?: RequestOptions,
): Promise<BrightDataTriggerResponse> {
  // Clean the input and avoid paying to request the same URL more than once.
  const uniqueProfileLinks = [
    ...new Set(profileLinks.map((link) => link.trim()).filter(Boolean)),
  ];

  if (uniqueProfileLinks.length === 0) {
    throw new Error('At least one LinkedIn profile URL is required.');
  }

  // Use custom options when supplied. Otherwise, safely read the token at call time.
  const requestOptions = options ?? (() => {
    const apiKey = process.env['BRIGHTDATA_API_KEY'];

    if (!apiKey) {
      throw new Error('BRIGHTDATA_API_KEY is not configured.');
    }

    return createRequestOptions(apiKey);
  })();

  // Bright Data expects each URL as an object inside the `input` array.
  const requestBody = JSON.stringify({
    input: uniqueProfileLinks.map((url) => ({ url })),
    limit_per_input: null,
  });

  // https.request uses callbacks. Wrapping it in a Promise makes the function awaitable.
  return new Promise<BrightDataTriggerResponse>((resolve, reject) => {
    const req = request(
      {
        ...requestOptions,
        headers: {
          ...requestOptions.headers,

          // Content-Length is the body size in bytes, not JavaScript characters.
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      (res) => {
        let responseData = '';
        res.setEncoding('utf8');

        // HTTP response bodies can arrive in multiple chunks, so collect all of them.
        res.on('data', (chunk: string) => {
          responseData += chunk;
        });

        res.on('error', reject);

        // `end` fires after the complete response body has arrived.
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;

          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `Bright Data request failed with status ${statusCode}: ${responseData}`,
              ),
            );
            return;
          }

          try {
            // Parse as unknown first because external API responses are not trusted types.
            const parsedResponse: unknown = JSON.parse(responseData);

            // Runtime validation protects later code from a missing or invalid snapshot ID.
            if (
              typeof parsedResponse !== 'object' ||
              parsedResponse === null ||
              !('snapshot_id' in parsedResponse) ||
              typeof parsedResponse.snapshot_id !== 'string'
            ) {
              reject(new Error('Bright Data returned an unexpected response.'));
              return;
            }

            resolve(parsedResponse as BrightDataTriggerResponse);
          } catch (error: unknown) {
            reject(
              new Error('Bright Data returned invalid JSON.', { cause: error }),
            );
          }
        });
      },
    );

    // This catches failures that happen before a valid HTTP response exists.
    req.on('error', reject);

    // Send the serialized JSON body, then signal that the request is complete.
    req.write(requestBody);
    req.end();
  });
}
