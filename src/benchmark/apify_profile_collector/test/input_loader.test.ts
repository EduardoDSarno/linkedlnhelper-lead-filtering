import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadApifyBenchmarkInput } from '../input_loader.js';
import type { ApifyBenchmarkArguments } from '../types.js';

/** Builds the common dry-run arguments used to exercise one file adapter. */
function fileArguments(inputPath: string): ApifyBenchmarkArguments {
  return {
    inputPath,
    profileLinks: [],
    execute: false,
    offset: 0,
    collectorOptions: {},
  };
}

test('loads direct URLs without reading a CSV or creating source identities', async () => {
  const profileLinks = [
    'https://www.linkedin.com/in/alpha',
    'https://linkedin.com/in/bravo',
  ];
  const input = await loadApifyBenchmarkInput({
    profileLinks,
    execute: false,
    offset: 0,
    collectorOptions: {},
  });

  assert.equal(input.sourceKind, 'direct_links');
  assert.equal(input.sourcePath, 'command-line');
  assert.deepEqual(input.profileLinks, profileLinks);
  assert.deepEqual(input.expectedIdentities, []);
});

test('loads a text file containing only profile links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apify-links-text-'));
  const inputPath = join(directory, 'profiles.txt');

  try {
    await writeFile(
      inputPath,
      [
        'https://www.linkedin.com/in/alpha',
        '',
        'https://www.linkedin.com/in/bravo',
      ].join('\n'),
    );
    const input = await loadApifyBenchmarkInput(fileArguments(inputPath));

    assert.equal(input.sourceKind, 'link_file');
    assert.deepEqual(input.profileLinks, [
      'https://www.linkedin.com/in/alpha',
      'https://www.linkedin.com/in/bravo',
    ]);
    assert.deepEqual(input.expectedIdentities, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('loads JSON objects with optional names for identity comparison', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apify-links-json-'));
  const inputPath = join(directory, 'profiles.json');

  try {
    await writeFile(
      inputPath,
      JSON.stringify([
        {
          linkedinUrl: 'https://www.linkedin.com/in/alpha',
          fullName: 'Alpha Person',
        },
        'https://www.linkedin.com/in/bravo',
      ]),
    );
    const input = await loadApifyBenchmarkInput(fileArguments(inputPath));

    assert.deepEqual(input.profileLinks, [
      'https://www.linkedin.com/in/alpha',
      'https://www.linkedin.com/in/bravo',
    ]);
    assert.deepEqual(input.expectedIdentities, [
      {
        linkedinUrl: 'https://www.linkedin.com/in/alpha',
        fullName: 'Alpha Person',
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('loads a link-only CSV independently from Linked Helper fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apify-links-csv-'));
  const inputPath = join(directory, 'profiles.csv');

  try {
    await writeFile(
      inputPath,
      [
        'linkedinUrl,fullName',
        'https://www.linkedin.com/in/alpha,Alpha Person',
        'https://www.linkedin.com/in/bravo,Bravo Person',
      ].join('\n'),
    );
    const input = await loadApifyBenchmarkInput(fileArguments(inputPath));

    assert.equal(input.sourceKind, 'link_file');
    assert.equal(input.expectedIdentities.length, input.profileLinks.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reads only links and names from a Linked Helper CSV', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apify-linked-helper-'));
  const inputPath = join(directory, 'profiles.csv');

  try {
    await writeFile(
      inputPath,
      [
        'public_id;lh_id;profile_url;full_name;first_name;last_name;headline',
        'alpha;lh-alpha;https://www.linkedin.com/in/alpha;Alpha Person;Alpha;Person;Ignored headline',
      ].join('\n'),
    );
    const input = await loadApifyBenchmarkInput(fileArguments(inputPath));

    assert.equal(input.sourceKind, 'linked_helper_csv');
    assert.deepEqual(input.profileLinks, [
      'https://www.linkedin.com/in/alpha',
    ]);
    assert.deepEqual(input.expectedIdentities, [
      {
        linkedinUrl: 'https://www.linkedin.com/in/alpha',
        fullName: 'Alpha Person',
        firstName: 'Alpha',
        lastName: 'Person',
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects non-LinkedIn and non-profile URLs before collection', async () => {
  await assert.rejects(
    loadApifyBenchmarkInput({
      profileLinks: ['https://example.com/in/not-linkedin'],
      execute: false,
      offset: 0,
      collectorOptions: {},
    }),
    /Invalid LinkedIn profile URL/,
  );
});
