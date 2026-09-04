import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { importedCsvDataFor } from '../../test_support/pipeline_fakes.js';
import type { FullProfile } from '../../profile/index.js';
import {
  DEFAULT_CACHED_PROFILES_PATH,
  buildCachedProfilePipelineResult,
  matchCachedProfilesToImport,
  parseCachedFullProfiles,
  readCachedProfilesFile,
  resolveCachedProfilesForImport,
} from '../cached_profiles.js';

const CACHED_PROFILE_ID = 'cached-profile-id';
const CACHED_PUBLIC_ID = 'imported-0';
const CACHED_LINKEDIN_URL = 'https://www.linkedin.com/in/cached-person';
const CACHED_PHOTO_URL = 'https://example.invalid/cached-person.jpg';

/** Builds one structurally valid cached profile for matcher tests. */
function cachedProfile(
  overrides: Partial<FullProfile> = {},
): FullProfile {
  return {
    id: CACHED_PROFILE_ID,
    linkedinUrl: CACHED_LINKEDIN_URL,
    firstName: 'Cached',
    lastName: 'Person',
    photo: CACHED_PHOTO_URL,
    experience: [{ position: 'Seller', companyName: 'Example' }],
    education: [{ schoolName: 'Example University' }],
    raw: {},
    linkedHelperPublicId: CACHED_PUBLIC_ID,
    ...overrides,
  };
}

test('matches cached profiles to the current import by LinkedIn URL', () => {
  const imported = importedCsvDataFor([CACHED_LINKEDIN_URL]);
  const matched = matchCachedProfilesToImport(
    [cachedProfile({ linkedHelperPublicId: 'stale-public-id' })],
    imported,
  );

  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.linkedHelperPublicId, 'imported-0');
  assert.equal(matched[0]?.linkedinUrl, CACHED_LINKEDIN_URL);
});

test('matches cached profiles by the stored Linked Helper public id', () => {
  const currentUrl = 'https://www.linkedin.com/in/current-alias';
  const imported = importedCsvDataFor([currentUrl]);
  const matched = matchCachedProfilesToImport(
    [
      cachedProfile({
        linkedinUrl: 'https://www.linkedin.com/in/previous-alias',
      }),
    ],
    imported,
  );

  assert.equal(matched[0]?.linkedinUrl, currentUrl);
  assert.equal(matched[0]?.linkedHelperPublicId, CACHED_PUBLIC_ID);
});

test('fails when the cache does not cover every imported URL', () => {
  assert.throws(
    () =>
      matchCachedProfilesToImport(
        [cachedProfile()],
        importedCsvDataFor([
          CACHED_LINKEDIN_URL,
          'https://www.linkedin.com/in/missing-person',
        ]),
      ),
    /cover 1 of 2 imported LinkedIn URLs/,
  );
});

test('rejects a cached artifact that is not a profile array', () => {
  assert.throws(
    () => parseCachedFullProfiles({ profiles: [] }),
    /must be a JSON array/,
  );
  assert.throws(
    () => parseCachedFullProfiles([{ firstName: 'Broken' }]),
    /Invalid full profile at index 0/,
  );
});

test('builds a collection-shaped result from reused profiles', () => {
  const now = new Date('2026-09-03T18:00:00.000Z');
  const result = buildCachedProfilePipelineResult(
    [
      cachedProfile(),
      cachedProfile({
        id: 'no-photo',
        linkedinUrl: 'https://www.linkedin.com/in/no-photo',
        photo: '',
      }),
    ],
    now,
  );

  assert.equal(result.profiles.length, 2);
  assert.equal(result.summary.requestedProfiles, 2);
  assert.equal(result.summary.profilesWithoutPhoto, 1);
  assert.equal(result.summary.successfulImageAnalyses, 0);
  assert.equal(result.summary.providerCollection.actorRuns, 0);
  assert.equal(result.summary.outputs.fullProfiles, DEFAULT_CACHED_PROFILES_PATH);
});

test('reads cached profiles from disk and resolves them for an import', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cached-profiles-'));
  const path = join(directory, 'full-profiles.json');

  try {
    await writeFile(path, JSON.stringify([cachedProfile()]));
    const profiles = await resolveCachedProfilesForImport(
      importedCsvDataFor([CACHED_LINKEDIN_URL]),
      {
        cachedProfilesPath: path,
        readCachedProfiles: readCachedProfilesFile,
      },
    );

    assert.equal(profiles[0]?.id, CACHED_PROFILE_ID);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('explains when the cached full-profile file is missing', async () => {
  await assert.rejects(
    () => readCachedProfilesFile('/tmp/leadscan-missing-full-profiles.json'),
    /were not found/,
  );
});
