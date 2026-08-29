import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  getLinkedlnProfileDataFromExternalProvidor,
  loadProfilesFromCsv,
} from '../csvdata.js';
import {
  linkedHelperCsv,
  linkedHelperRow,
  sparseLinkedHelperRow,
} from '../../../test_support/linked_helper_csv_fixtures.js';

/** Writes one CSV into a temporary directory and loads it, then cleans up. */
async function withCsv<T>(
  contents: string,
  run: (path: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'linked-helper-csv-'));
  const path = join(directory, 'export.csv');

  try {
    await writeFile(path, contents, 'utf-8');
    return await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('imports a complete row into a normalized profile', async () => {
  const data = await withCsv(
    linkedHelperCsv([linkedHelperRow()]),
    loadProfilesFromCsv,
  );

  assert.equal(data.total_rows, 1);
  assert.equal(data.total_profiles, 1);
  assert.equal(data.duplicated_profiles, 0);

  const profile = data.records['test-person-001'];
  assert.ok(profile);
  assert.deepEqual(profile.summary, {
    publicId: 'test-person-001',
    profileUrl: 'https://www.linkedin.com/in/test-person-001',
    linkedHelperId: 'lh-001',
    memberId: 'member-001',
    hashId: 'hash-001',
    fullName: 'Avery Stone',
    firstName: 'Avery',
    lastName: 'Stone',
    headline: 'Operations Lead at Example Logistics',
    avatarUrl: 'https://example.invalid/photos/test-person-001.jpg',
    location: 'Lisbon, Portugal',
    openToWork: true,
    hiring: false,
    premium: true,
    influencer: false,
    memberDistance: 'DISTANCE_2',
    mutualConnections: { count: 2, names: ['Blake Rivers', 'Casey Meadows'] },
    addedToTargetAt: '2026-01-15T10:00:00Z',
    observedCurrentEmployment: {
      companyName: 'Example Logistics',
      position: 'Operations Lead',
      observedAt: '2026-01-10',
    },
  });
});

test('keeps the complete source row alongside the summary', async () => {
  const data = await withCsv(
    linkedHelperCsv([linkedHelperRow()]),
    loadProfilesFromCsv,
  );

  // Columns the summary ignores must remain reachable for later mappings.
  const raw = data.records['test-person-001']?.raw;
  assert.equal(raw?.['add_to_target_date'], '15/01/2026');
  assert.equal(raw?.['current_company_actual_at'], '2026-01-10');
});

test('strips the UTF-8 BOM from the first column name', async () => {
  // Without BOM handling the first header becomes "﻿public_id" and every
  // profile silently loses its identity.
  const withBom = await withCsv(
    linkedHelperCsv([linkedHelperRow()], { bom: true }),
    loadProfilesFromCsv,
  );
  const withoutBom = await withCsv(
    linkedHelperCsv([linkedHelperRow()], { bom: false }),
    loadProfilesFromCsv,
  );

  assert.equal(withBom.total_profiles, 1);
  assert.deepEqual(
    Object.keys(withBom.records),
    Object.keys(withoutBom.records),
  );
});

test('omits optional fields that the export left blank', async () => {
  const data = await withCsv(
    linkedHelperCsv([sparseLinkedHelperRow()]),
    loadProfilesFromCsv,
  );

  const summary = data.records['test-person-002']?.summary;
  assert.ok(summary);
  assert.equal(summary.fullName, '');
  assert.equal(summary.openToWork, false);
  assert.equal('headline' in summary, false);
  assert.equal('avatarUrl' in summary, false);
  assert.equal('location' in summary, false);
  assert.equal('mutualConnections' in summary, false);
  assert.equal('observedCurrentEmployment' in summary, false);
});

test('builds a full name from the parts when the export omits it', async () => {
  const data = await withCsv(
    linkedHelperCsv([
      linkedHelperRow({ full_name: '', first_name: 'Avery', last_name: 'Stone' }),
    ]),
    loadProfilesFromCsv,
  );

  assert.equal(data.records['test-person-001']?.summary.fullName, 'Avery Stone');
});

test('treats only the literal "true" as a set badge', async () => {
  const data = await withCsv(
    linkedHelperCsv([
      linkedHelperRow({
        badges_job_seeker: 'TRUE',
        badges_hiring: '1',
        badges_premium: 'yes',
        badges_influencer: '  true  ',
      }),
    ]),
    loadProfilesFromCsv,
  );

  const summary = data.records['test-person-001']?.summary;

  // Casing and surrounding spaces are tolerated; other truthy-looking values
  // are not, because Linked Helper only ever writes true or false.
  assert.equal(summary?.openToWork, true);
  assert.equal(summary?.influencer, true);
  assert.equal(summary?.hiring, false);
  assert.equal(summary?.premium, false);
});

test('drops rows that have no public ID', async () => {
  const data = await withCsv(
    linkedHelperCsv([
      linkedHelperRow(),
      linkedHelperRow({ public_id: '', profile_url: 'https://x.invalid/a' }),
      linkedHelperRow({ public_id: '   ', profile_url: 'https://x.invalid/b' }),
    ]),
    loadProfilesFromCsv,
  );

  // All three rows were read, but only the keyed one becomes a profile.
  assert.equal(data.total_rows, 3);
  assert.equal(data.total_profiles, 1);
  assert.equal(data.duplicated_profiles, 0);
});

test('keeps the first row for a repeated public ID and counts the rest', async () => {
  const data = await withCsv(
    linkedHelperCsv([
      linkedHelperRow({ headline: 'First occurrence' }),
      linkedHelperRow({ headline: 'Second occurrence' }),
      linkedHelperRow({ headline: 'Third occurrence' }),
    ]),
    loadProfilesFromCsv,
  );

  assert.equal(data.total_rows, 3);
  assert.equal(data.total_profiles, 1);
  assert.equal(data.duplicated_profiles, 2);
  assert.equal(
    data.records['test-person-001']?.summary.headline,
    'First occurrence',
  );
});

test('reads semicolon-delimited values, including quoted ones', async () => {
  const data = await withCsv(
    linkedHelperCsv([
      linkedHelperRow({ headline: 'Operations; Logistics; Freight' }),
    ]),
    loadProfilesFromCsv,
  );

  assert.equal(
    data.records['test-person-001']?.summary.headline,
    'Operations; Logistics; Freight',
  );
});

test('derives a mutual connection count from the names when absent', async () => {
  const data = await withCsv(
    linkedHelperCsv([
      linkedHelperRow({
        mutual_count: '',
        mutual_first_fullname: 'Blake Rivers',
        mutual_second_fullname: '',
      }),
    ]),
    loadProfilesFromCsv,
  );

  assert.deepEqual(
    data.records['test-person-001']?.summary.mutualConnections,
    { count: 1, names: ['Blake Rivers'] },
  );
});

test('does not repeat an identical mutual connection name', async () => {
  const data = await withCsv(
    linkedHelperCsv([
      linkedHelperRow({
        mutual_count: '2',
        mutual_first_fullname: 'Blake Rivers',
        mutual_second_fullname: 'Blake Rivers',
      }),
    ]),
    loadProfilesFromCsv,
  );

  assert.deepEqual(
    data.records['test-person-001']?.summary.mutualConnections,
    { count: 2, names: ['Blake Rivers'] },
  );
});

test('prefers the ISO added-to-target date over the display date', async () => {
  const data = await withCsv(
    linkedHelperCsv([linkedHelperRow()]),
    loadProfilesFromCsv,
  );
  const fallback = await withCsv(
    linkedHelperCsv([linkedHelperRow({ add_to_target_date_iso: '' })]),
    loadProfilesFromCsv,
  );

  assert.equal(
    data.records['test-person-001']?.summary.addedToTargetAt,
    '2026-01-15T10:00:00Z',
  );
  assert.equal(
    fallback.records['test-person-001']?.summary.addedToTargetAt,
    '15/01/2026',
  );
});

test('records current employment without its optional parts', async () => {
  const data = await withCsv(
    linkedHelperCsv([
      linkedHelperRow({
        current_company_position: '',
        current_company_actual_at: '',
      }),
    ]),
    loadProfilesFromCsv,
  );

  assert.deepEqual(
    data.records['test-person-001']?.summary.observedCurrentEmployment,
    { companyName: 'Example Logistics' },
  );
});

test('returns an empty import for a header-only file', async () => {
  const data = await withCsv(linkedHelperCsv([]), loadProfilesFromCsv);

  assert.deepEqual(data, {
    total_rows: 0,
    total_profiles: 0,
    duplicated_profiles: 0,
    records: {},
  });
});

test('rejects a missing file', async () => {
  await assert.rejects(
    () => loadProfilesFromCsv(join(tmpdir(), 'does-not-exist-export.csv')),
    /ENOENT/,
  );
});

test('extracts profile URLs in record order', async () => {
  const data = await withCsv(
    linkedHelperCsv([
      linkedHelperRow(),
      linkedHelperRow({
        public_id: 'test-person-003',
        profile_url: 'https://www.linkedin.com/in/test-person-003',
      }),
    ]),
    loadProfilesFromCsv,
  );

  assert.deepEqual(getLinkedlnProfileDataFromExternalProvidor(data.records), [
    'https://www.linkedin.com/in/test-person-001',
    'https://www.linkedin.com/in/test-person-003',
  ]);
});

test('extracts nothing from an empty record set', () => {
  assert.deepEqual(getLinkedlnProfileDataFromExternalProvidor({}), []);
});

test('exposes only URLs, never the raw rows', async () => {
  const data = await withCsv(
    linkedHelperCsv([linkedHelperRow()]),
    loadProfilesFromCsv,
  );
  const urls = getLinkedlnProfileDataFromExternalProvidor(data.records);

  // The provider receives URLs alone; personal CSV fields must not travel with
  // them.
  assert.ok(urls.every((url) => typeof url === 'string'));
  assert.equal(urls.length, 1);
});
