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

test('accepts accented letters, which Bebity now resolves correctly', () => {
  // Verified live against Bebity: these come back with the full slug intact
  // rather than truncated at the first accent, as they once did.
  for (const url of [
    'https://www.linkedin.com/in/césar-briceño-44b3562b/',
    'https://www.linkedin.com/in/joão-felipe-amato-523jfpa/',
    'https://www.linkedin.com/in/josé-ilário-6a67998b/',
    'https://www.linkedin.com/in/r-frança-04323b81/',
  ]) {
    assert.equal(isBebityCompatibleProfileUrl(url), true, url);
  }
});

test('accepts a percent-encoded accented slug the same as a raw one', () => {
  const raw = 'https://www.linkedin.com/in/joão-felipe-amato-523jfpa/';

  assert.equal(isBebityCompatibleProfileUrl(raw), true);
  assert.equal(isBebityCompatibleProfileUrl(encodeURI(raw)), true);
});

test('still rejects the non-letter characters that truncate', () => {
  // One per class found in real data, each confirmed live to still fail while
  // an accented control succeeded in the same batch.
  const stillBroken = {
    'registered sign': 'https://www.linkedin.com/in/roberto-alencar-cfp®-cpro-i-892529a/',
    'right quotation mark': 'https://www.linkedin.com/in/ana-paula-d’avila-45549964/',
    'emoji with joiner': 'https://www.linkedin.com/in/samara-batista-dayoub-🏳‍🌈-83451958/',
    'zero-width space': 'https://www.linkedin.com/in/ricardo-prazeres-​-b0b763b9/',
  };

  for (const [label, url] of Object.entries(stillBroken)) {
    assert.equal(isBebityCompatibleProfileUrl(url), false, label);
  }
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
    'https://www.linkedin.com/in/roberto-alencar-cfp®-cpro-i-892529a/',
    'https://www.linkedin.com/in/josé-ilário-6a67998b/',
  ];

  const { bebityCompatible, requiresHarvest } =
    partitionProfileLinksForBebity(profileLinks);

  assert.deepEqual(bebityCompatible, [
    'https://www.linkedin.com/in/jane-doe-123/',
    'https://www.linkedin.com/in/césar-briceño-44b3562b/',
    'https://www.linkedin.com/in/josé-ilário-6a67998b/',
  ]);
  assert.deepEqual(requiresHarvest, [
    'https://www.linkedin.com/in/roberto-alencar-cfp®-cpro-i-892529a/',
  ]);
});
