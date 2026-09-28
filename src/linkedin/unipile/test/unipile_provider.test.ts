import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createUnipileProvider,
  requireUnipileWorkspace,
  UNIPILE_PROFILE_PROVIDER,
} from '../index.js';
import type { UnipileSdk, UnipileWorkspace } from '../index.js';

const WORKSPACE: UnipileWorkspace = {
  baseUrl: 'https://api0.unipile.test:1',
  accessToken: 'test-token',
};
const ACCOUNT_ID = 'account-1';
const MEMBER_ID = 'ACoAAMember';

/** One call the fake SDK received, by method name, with its input. */
interface RecordedCall {
  method: string;
  input: unknown;
}

/**
 * Builds a fake SDK that records every call and answers with canned data.
 *
 * The adapter only ever sees this slice of the SDK, so recording it is enough
 * to assert on exactly what would be sent to Unipile.
 */
function fakeSdk(responses: { send?: unknown } = {}): {
  sdk: UnipileSdk;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const sdk = {
    account: {
      createHostedAuthLink: async (input: unknown) => {
        calls.push({ method: 'createHostedAuthLink', input });
        return { object: 'HostedAuthUrl', url: 'https://connect.test/abc' };
      },
    },
    users: {
      getProfile: async (input: unknown) => {
        calls.push({ method: 'getProfile', input });
        return { provider_id: MEMBER_ID, first_name: 'Ana' };
      },
      sendInvitation: async (input: unknown) => {
        calls.push({ method: 'sendInvitation', input });
        return { object: 'UserInvitationSent', invitation_id: 'invitation-1' };
      },
    },
    request: {
      send: async (input: unknown) => {
        calls.push({ method: 'send', input });
        return responses.send ?? {};
      },
    },
  };
  return { sdk: sdk as unknown as UnipileSdk, calls };
}

test('creates a LinkedIn connect link against our own workspace', async () => {
  const { sdk, calls } = fakeSdk();
  const provider = createUnipileProvider({ workspace: WORKSPACE, sdk });
  const expiresAt = new Date('2026-10-01T12:00:00.000Z');

  const url = await provider.createConnectLink({
    accountLabel: 'client-7',
    expiresAt,
    notifyUrl: 'https://app.test/unipile/connected',
  });

  assert.equal(url, 'https://connect.test/abc');
  assert.deepEqual(calls[0]?.input, {
    type: 'create',
    providers: ['LINKEDIN'],
    api_url: WORKSPACE.baseUrl,
    expiresOn: expiresAt.toISOString(),
    name: 'client-7',
    notify_url: 'https://app.test/unipile/connected',
  });
});

test('asks Unipile for a proxy in the given country', async () => {
  const { sdk, calls } = fakeSdk();
  const provider = createUnipileProvider({ workspace: WORKSPACE, sdk });

  await provider.setAccountCountry(ACCOUNT_ID, 'br');

  assert.deepEqual(calls[0]?.input, {
    method: 'PATCH',
    path: ['accounts', ACCOUNT_ID],
    body: { country: 'BR' },
  });
});

test('searches from a pasted URL and maps only the people on the page', async () => {
  const { sdk, calls } = fakeSdk({
    send: {
      object: 'LinkedinSearch',
      items: [
        {
          type: 'PEOPLE',
          id: MEMBER_ID,
          public_identifier: 'ana-souza',
          public_profile_url: 'https://www.linkedin.com/in/ana-souza',
          name: 'Ana Souza',
          headline: 'Gerente comercial',
          location: 'Goiânia, Goiás',
          network_distance: 'DISTANCE_2',
          pending_invitation: false,
        },
        { type: 'COMPANY', id: 'company-1', name: 'Acme' },
        { type: 'PEOPLE', headline: 'No member id, so nothing can be done with it' },
      ],
      paging: { start: 0, page_count: 3, total_count: 640 },
      cursor: 'next-page',
    },
  });
  const provider = createUnipileProvider({ workspace: WORKSPACE, sdk });

  const page = await provider.searchPeople(ACCOUNT_ID, {
    searchUrl: 'https://www.linkedin.com/search/results/people/?keywords=vendas',
    cursor: 'this-page',
    limit: 10,
  });

  assert.deepEqual(calls[0]?.input, {
    method: 'POST',
    path: ['linkedin', 'search'],
    parameters: { account_id: ACCOUNT_ID, cursor: 'this-page', limit: '10' },
    body: { url: 'https://www.linkedin.com/search/results/people/?keywords=vendas' },
  });
  assert.deepEqual(page, {
    people: [
      {
        memberId: MEMBER_ID,
        headline: 'Gerente comercial',
        networkDistance: 'second',
        publicIdentifier: 'ana-souza',
        profileUrl: 'https://www.linkedin.com/in/ana-souza',
        name: 'Ana Souza',
        location: 'Goiânia, Goiás',
        pendingInvitation: false,
      },
    ],
    nextCursor: 'next-page',
    totalCount: 640,
  });
});

test('reports the last search page by leaving the cursor out', async () => {
  const { sdk, calls } = fakeSdk({ send: { items: [], cursor: null } });
  const provider = createUnipileProvider({ workspace: WORKSPACE, sdk });

  const page = await provider.searchPeople(ACCOUNT_ID, {
    searchUrl: 'https://www.linkedin.com/search/results/people/',
  });

  assert.deepEqual(page, { people: [] });
  assert.deepEqual(
    (calls[0]?.input as { parameters: unknown }).parameters,
    { account_id: ACCOUNT_ID },
  );
});

test('fetches a profile silently, with only the sections evaluation reads', async () => {
  const { sdk, calls } = fakeSdk();
  const provider = createUnipileProvider({ workspace: WORKSPACE, sdk });

  const profile = await provider.getProfile(ACCOUNT_ID, MEMBER_ID);

  assert.deepEqual(calls[0]?.input, {
    account_id: ACCOUNT_ID,
    identifier: MEMBER_ID,
    linkedin_sections: ['experience', 'education'],
    notify: false,
  });
  assert.deepEqual(profile, {
    provider: UNIPILE_PROFILE_PROVIDER,
    record: { provider_id: MEMBER_ID, first_name: 'Ana' },
  });
});

test('sends an invitation with a note, and without one when none is given', async () => {
  const { sdk, calls } = fakeSdk();
  const provider = createUnipileProvider({ workspace: WORKSPACE, sdk });

  const sent = await provider.sendInvitation(ACCOUNT_ID, MEMBER_ID, 'Olá, Ana!');
  await provider.sendInvitation(ACCOUNT_ID, MEMBER_ID);

  assert.deepEqual(sent, { invitationId: 'invitation-1' });
  assert.deepEqual(calls[0]?.input, {
    account_id: ACCOUNT_ID,
    provider_id: MEMBER_ID,
    message: 'Olá, Ana!',
  });
  assert.deepEqual(calls[1]?.input, {
    account_id: ACCOUNT_ID,
    provider_id: MEMBER_ID,
  });
});

test('reads the workspace from the environment, adding the scheme the dashboard omits', () => {
  assert.deepEqual(
    requireUnipileWorkspace({
      UNIPILE_DSN: 'api8.unipile.com:13851',
      UNIPILE_ACCESS_TOKEN: ' token ',
    }),
    { baseUrl: 'https://api8.unipile.com:13851', accessToken: 'token' },
  );
  assert.equal(
    requireUnipileWorkspace({
      UNIPILE_DSN: 'https://api8.unipile.com:13851',
      UNIPILE_ACCESS_TOKEN: 'token',
    }).baseUrl,
    'https://api8.unipile.com:13851',
  );
});

test('refuses to start without both workspace values', () => {
  assert.throws(
    () => requireUnipileWorkspace({ UNIPILE_ACCESS_TOKEN: 'token' }),
    /UNIPILE_DSN is not configured/,
  );
  assert.throws(
    () => requireUnipileWorkspace({ UNIPILE_DSN: 'api8.unipile.com:13851' }),
    /UNIPILE_ACCESS_TOKEN is not configured/,
  );
});
