import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createConnectLink,
  requireUnipileWorkspace,
  unipileRequest,
  UnipileRequestError,
} from '../index.js';
import type { FetchFunction, UnipileWorkspace } from '../index.js';

const WORKSPACE: UnipileWorkspace = {
  baseUrl: 'https://api0.unipile.test:1',
  accessToken: 'test-token',
};

/** One request the fake fetch received. */
interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

/**
 * Builds a fetch that records each request and answers with one response.
 *
 * Real `Response` objects are used, so status handling and body reading
 * behave exactly as they would against Unipile.
 */
function fakeFetch(response: Response): {
  fetchFunction: FetchFunction;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchFunction = (async (url: URL | string, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return response;
  }) as FetchFunction;
  return { fetchFunction, requests };
}

/** Reads the JSON body a recorded request carried. */
function sentBody(request: RecordedRequest | undefined): unknown {
  return JSON.parse(String(request?.init?.body));
}

test('sends the API key, JSON, and query to the workspace URL', async () => {
  const { fetchFunction, requests } = fakeFetch(Response.json({ ok: true }));

  const result = await unipileRequest(
    WORKSPACE,
    { method: 'POST', path: '/linkedin/search', query: { account_id: 'a1' }, body: { x: 1 } },
    fetchFunction,
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(requests[0]?.url, 'https://api0.unipile.test:1/api/v1/linkedin/search?account_id=a1');
  assert.equal(requests[0]?.init?.method, 'POST');
  assert.deepEqual(requests[0]?.init?.headers, {
    'X-API-KEY': 'test-token',
    accept: 'application/json',
    'content-type': 'application/json',
  });
  assert.deepEqual(sentBody(requests[0]), { x: 1 });
});

test('sends no body or content type when a request has none', async () => {
  const { fetchFunction, requests } = fakeFetch(Response.json({}));

  await unipileRequest(WORKSPACE, { method: 'GET', path: '/accounts' }, fetchFunction);

  assert.equal(requests[0]?.init?.body, undefined);
  assert.deepEqual(requests[0]?.init?.headers, {
    'X-API-KEY': 'test-token',
    accept: 'application/json',
  });
});

test('turns a non-2xx answer into an error carrying the status and Unipile\'s reply', async () => {
  const { fetchFunction } = fakeFetch(
    new Response('{"title":"Unauthorized"}', { status: 401 }),
  );

  await assert.rejects(
    () => unipileRequest(WORKSPACE, { method: 'GET', path: '/accounts' }, fetchFunction),
    (error: unknown) =>
      error instanceof UnipileRequestError &&
      error.status === 401 &&
      error.message.includes('Unauthorized'),
  );
});

test('reads Unipile\'s error fields into a message that says what to fix', async () => {
  const { fetchFunction } = fakeFetch(
    Response.json(
      {
        title: 'Invalid parameters',
        detail: 'expiresOn must be in the future',
        instance: '/api/v1/hosted/accounts/link',
        type: 'errors/invalid_parameters',
        status: 400,
      },
      { status: 400 },
    ),
  );

  await assert.rejects(
    () => unipileRequest(WORKSPACE, { method: 'POST', path: '/hosted/accounts/link' }, fetchFunction),
    (error: unknown) =>
      error instanceof UnipileRequestError &&
      error.status === 400 &&
      error.type === 'errors/invalid_parameters' &&
      error.message ===
        'Unipile POST /hosted/accounts/link failed with 400 (errors/invalid_parameters): ' +
          'Invalid parameters — expiresOn must be in the future',
  );
});

test('quotes a failed reply as it came when it is not Unipile\'s JSON', async () => {
  const { fetchFunction } = fakeFetch(new Response('<html>Bad Gateway</html>', { status: 502 }));

  await assert.rejects(
    () => unipileRequest(WORKSPACE, { method: 'GET', path: '/accounts' }, fetchFunction),
    (error: unknown) =>
      error instanceof UnipileRequestError &&
      error.type === undefined &&
      error.message === 'Unipile GET /accounts failed with 502: <html>Bad Gateway</html>',
  );
});

test('creates a LinkedIn connect link with the documented body', async () => {
  const { fetchFunction, requests } = fakeFetch(
    Response.json({ object: 'HostedAuthUrl', url: 'https://account.unipile.com/link' }),
  );
  const expiresAt = new Date('2026-10-01T12:00:00.000Z');

  const url = await createConnectLink(
    WORKSPACE,
    { accountLabel: 'client-7', expiresAt, notifyUrl: 'https://app.test/webhooks/unipile' },
    fetchFunction,
  );

  assert.equal(url, 'https://account.unipile.com/link');
  assert.equal(requests[0]?.url, 'https://api0.unipile.test:1/api/v1/hosted/accounts/link');
  assert.deepEqual(sentBody(requests[0]), {
    type: 'create',
    providers: ['LINKEDIN'],
    api_url: WORKSPACE.baseUrl,
    expiresOn: expiresAt.toISOString(),
    name: 'client-7',
    notify_url: 'https://app.test/webhooks/unipile',
  });
});

test('fails clearly when Unipile returns no link', async () => {
  const { fetchFunction } = fakeFetch(Response.json({ object: 'HostedAuthUrl' }));

  await assert.rejects(
    () =>
      createConnectLink(
        WORKSPACE,
        { accountLabel: 'client-7', expiresAt: new Date() },
        fetchFunction,
      ),
    /no connect link URL/,
  );
});

test('reads the workspace from the environment, adding the scheme the dashboard omits', () => {
  assert.deepEqual(
    requireUnipileWorkspace({ UNIPILE_DSN: 'api8.unipile.com:13851', UNIPILE_ACCESS_TOKEN: ' t ' }),
    { baseUrl: 'https://api8.unipile.com:13851', accessToken: 't' },
  );
  assert.throws(
    () => requireUnipileWorkspace({ UNIPILE_ACCESS_TOKEN: 't' }),
    /UNIPILE_DSN is not configured/,
  );
  assert.throws(
    () => requireUnipileWorkspace({ UNIPILE_DSN: 'api8.unipile.com:13851' }),
    /UNIPILE_ACCESS_TOKEN is not configured/,
  );
});
