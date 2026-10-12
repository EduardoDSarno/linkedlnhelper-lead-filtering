import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLinkedinMode } from '../client.js';
import { createFakeLinkedinClient } from '../fake/fake_client.js';
import {
  createUnipileLinkedinClient,
  searchBody,
  searchPage,
} from '../unipile/linkedin_client.js';
import type { FetchFunction } from '../unipile/request.js';

const WORKSPACE = { baseUrl: 'https://api0.unipile.test:1', accessToken: 'test-token' };

test('search body keeps only the filters that are set', () => {
  assert.deepEqual(
    searchBody({ keywords: 'advisor', locationIds: ['100'], industryIds: [], title: 'Sales' }),
    {
      api: 'classic',
      category: 'people',
      keywords: 'advisor',
      location: ['100'],
      advanced_keywords: { title: 'Sales' },
    },
  );
});

test('search page reads people and skips items without an id or name', () => {
  const page = searchPage({
    items: [
      {
        id: 'ACo1',
        name: 'Ana Silva',
        headline: 'Advisor',
        premium: true,
        current_positions: [{ company: 'XP', role: 'Advisor', location: null, description: null }],
      },
      { id: 'ACo2' },
    ],
    cursor: 'next',
  });

  assert.deepEqual(page, {
    people: [
      {
        linkedinMemberId: 'ACo1',
        name: 'Ana Silva',
        headline: 'Advisor',
        currentPositions: [{ company: 'XP', role: 'Advisor', location: null, description: null }],
        premium: true,
      },
    ],
    cursor: 'next',
  });
});

test('unipile search sends the account, cursor and body to the search route', async () => {
  const urls: string[] = [];
  const fetchFunction = (async (url: URL | string) => {
    urls.push(String(url));
    return Response.json({ items: [], cursor: null });
  }) as FetchFunction;

  const client = createUnipileLinkedinClient(WORKSPACE, fetchFunction);
  const page = await client.searchPeople('acc-1', { keywords: 'x' }, 'c-2');

  assert.equal(urls[0], 'https://api0.unipile.test:1/api/v1/linkedin/search?account_id=acc-1&cursor=c-2');
  assert.deepEqual(page, { people: [], cursor: null });
});

test('fake search pages through the same people every time, then stops', async () => {
  const client = createFakeLinkedinClient();
  const first = await client.searchPeople('acc', {});
  const again = await client.searchPeople('acc', {});
  assert.deepEqual(first, again);

  let cursor = first.cursor;
  let total = first.people.length;
  while (cursor) {
    const page = await client.searchPeople('acc', {}, cursor);
    total += page.people.length;
    cursor = page.cursor;
  }
  assert.ok(total > first.people.length);
});

test('fake profile matches its search card and refuses non-fake ids', async () => {
  const client = createFakeLinkedinClient();
  const [person] = (await client.searchPeople('acc', {})).people;
  assert.ok(person);

  const profile = await client.getProfile('acc', person.linkedinMemberId);
  assert.equal(profile['provider_id'], person.linkedinMemberId);
  assert.equal(`${profile['first_name']} ${profile['last_name']}`, person.name);

  await assert.rejects(client.getProfile('acc', 'ACoRealPerson'));
});

test('mode defaults to fake and refuses unknown values', () => {
  assert.equal(resolveLinkedinMode({}), 'fake');
  assert.equal(resolveLinkedinMode({ LINKEDIN_MODE: 'unipile' }), 'unipile');
  assert.throws(() => resolveLinkedinMode({ LINKEDIN_MODE: 'unipille' }));
});
