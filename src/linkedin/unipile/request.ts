import type { UnipileWorkspace } from './config.js';

/** Every endpoint we call lives under this version prefix. */
const API_PREFIX = '/api/v1';

/**
 * How long one request may take before it is abandoned.
 *
 * A request to Unipile drives a real LinkedIn session behind it, so it can be
 * slow, but one that hangs must not hold its caller forever.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** How much of an error response is kept in the thrown message. */
const ERROR_BODY_EXCERPT_LENGTH = 500;

/** One call to the Unipile API, described without any HTTP plumbing. */
export interface UnipileRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path after the version prefix, e.g. `/hosted/accounts/link`. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  /** Sent as JSON when present. */
  readonly body?: unknown;
}

/** The fetch function used, injectable so tests never reach the network. */
export type FetchFunction = typeof fetch;

/** A Unipile response outside the 2xx range, with what Unipile said about it. */
export class UnipileRequestError extends Error {
  /** The HTTP status Unipile answered with. */
  readonly status: number;

  /** Builds the error from the request that failed and Unipile's reply. */
  constructor(request: UnipileRequest, status: number, responseText: string) {
    const excerpt = responseText.slice(0, ERROR_BODY_EXCERPT_LENGTH);
    super(`Unipile ${request.method} ${request.path} failed with ${status}: ${excerpt}`);
    this.name = 'UnipileRequestError';
    this.status = status;
  }
}

/**
 * Sends one request to our Unipile workspace and returns its parsed JSON.
 *
 * Every endpoint function goes through here, so the URL, the API key header,
 * JSON handling, the timeout, and error reporting are written once. The
 * result is returned as `unknown` on purpose: each endpoint function checks
 * the fields it actually uses instead of trusting a cast.
 *
 * @throws UnipileRequestError when Unipile answers outside the 2xx range.
 */
export async function unipileRequest(
  workspace: UnipileWorkspace,
  request: UnipileRequest,
  fetchFunction: FetchFunction = fetch,
): Promise<unknown> {
  const response = await fetchFunction(requestUrl(workspace, request), {
    method: request.method,
    headers: {
      'X-API-KEY': workspace.accessToken,
      accept: 'application/json',
      ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) throw new UnipileRequestError(request, response.status, text);

  return text ? (JSON.parse(text) as unknown) : undefined;
}

/** Builds the full URL: workspace base, version prefix, path, and query. */
function requestUrl(workspace: UnipileWorkspace, request: UnipileRequest): URL {
  const url = new URL(`${API_PREFIX}${request.path}`, workspace.baseUrl);
  for (const [name, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(name, value);
  }
  return url;
}
