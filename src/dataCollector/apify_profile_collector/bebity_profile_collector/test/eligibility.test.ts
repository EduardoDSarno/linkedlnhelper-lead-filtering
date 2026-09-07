import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isBebityCompatibleProfileUrl,
  partitionProfileLinksForBebity,
} from '../eligibility.js';

test('accepts slugs made only of letters, digits, and hyphens', () => {
  assert.equal(
    isBebityCompatibleProfileUrl('https://www.linkedin.com/in/jane-doe-123/'),
    true,
  );
  assert.equal(
    isBebityCompatibleProfileUrl('https://www.linkedin.com/in/caiogibbs'),
    true,
  );
});

test('rejects slugs with accented letters, symbols, or other non-ASCII characters', () => {
  assert.equal(
    isBebityCompatibleProfileUrl('https://www.linkedin.com/in/césar-briceño-44b3562b/'),
    false,
  );
  assert.equal(
    isBebityCompatibleProfileUrl(
      'https://www.linkedin.com/in/felipe-camatta-paap®-40a2761b8/',
    ),
    false,
  );
});

test('rejects percent-encoded non-ASCII characters the same as raw ones', () => {
  const raw = 'https://www.linkedin.com/in/joão-felipe-amato-523jfpa/';
  const encoded = encodeURI(raw);

  assert.equal(isBebityCompatibleProfileUrl(raw), false);
  assert.equal(isBebityCompatibleProfileUrl(encoded), false);
});

test('routes malformed or non-profile URLs to Harvest rather than dropping them', () => {
  assert.equal(isBebityCompatibleProfileUrl('not-a-url'), false);
  assert.equal(
    isBebityCompatibleProfileUrl('https://www.linkedin.com/company/example'),
    false,
  );
});

test('partitions a mixed batch without losing or duplicating any link', () => {
  const profileLinks = [
    'https://www.linkedin.com/in/jane-doe-123/',
    'https://www.linkedin.com/in/césar-briceño-44b3562b/',
    'https://www.linkedin.com/in/caiogibbs',
    'https://www.linkedin.com/in/josé-ilário-6a67998b/',
  ];

  const { bebityCompatible, requiresHarvest } =
    partitionProfileLinksForBebity(profileLinks);

  assert.deepEqual(bebityCompatible, [
    'https://www.linkedin.com/in/jane-doe-123/',
    'https://www.linkedin.com/in/caiogibbs',
  ]);
  assert.deepEqual(requiresHarvest, [
    'https://www.linkedin.com/in/césar-briceño-44b3562b/',
    'https://www.linkedin.com/in/josé-ilário-6a67998b/',
  ]);
});
