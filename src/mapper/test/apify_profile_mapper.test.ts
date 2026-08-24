import assert from 'node:assert/strict';
import test from 'node:test';

import { mapApifyProfile } from '../index.js';
import {
  RAW_ONLY_SENTINEL,
  completeApifyProfile,
  duplicateEmploymentApifyProfile,
  incompleteEntriesApifyProfile,
  malformedApifyProfile,
  simultaneousCurrentRolesApifyProfile,
  sparseApifyProfile,
} from '../../test_support/apify_profile_fixtures.js';

test('maps every normalized field from a complete provider payload', () => {
  const profile = mapApifyProfile(completeApifyProfile(), 'profile-1');

  assert.equal(profile.id, 'profile-1');
  assert.equal(
    profile.linkedinUrl,
    'https://www.linkedin.com/in/test-person-001',
  );
  assert.equal(profile.firstName, 'Avery');
  assert.equal(profile.lastName, 'Stone');
  assert.equal(profile.headline, 'Operations Lead at Example Logistics');
  assert.equal(
    profile.photo,
    'https://example.invalid/photos/test-person-001.jpg',
  );
  assert.equal(profile.openToWork, true);
  assert.deepEqual(profile.location, {
    text: 'Lisbon, Lisbon, Portugal',
    city: 'Lisbon',
    state: 'Lisbon',
    country: 'Portugal',
    countryCode: 'PT',
  });
  assert.equal(profile.experience.length, 2);
  assert.equal(profile.education.length, 1);
});

test('prefers the LinkedIn location text over the parsed text', () => {
  const profile = mapApifyProfile(completeApifyProfile());

  // Both are present in the fixture; the original LinkedIn string wins so the
  // reviewer sees exactly what the profile displays.
  assert.equal(profile.location?.text, 'Lisbon, Lisbon, Portugal');
});

test('maps a sparse payload to empty arrays and omits optional fields', () => {
  const profile = mapApifyProfile(sparseApifyProfile());

  assert.equal(
    profile.linkedinUrl,
    'https://www.linkedin.com/in/test-person-002',
  );
  assert.deepEqual(profile.experience, []);
  assert.deepEqual(profile.education, []);
  assert.equal('firstName' in profile, false);
  assert.equal('lastName' in profile, false);
  assert.equal('headline' in profile, false);
  assert.equal('photo' in profile, false);
  assert.equal('openToWork' in profile, false);
  assert.equal('location' in profile, false);
});

test('rejects a payload without the required LinkedIn URL', () => {
  assert.throws(
    () => mapApifyProfile(malformedApifyProfile()),
    /without linkedinUrl/,
  );
});

test('preserves a supplied profile ID and generates one when omitted', () => {
  const supplied = mapApifyProfile(sparseApifyProfile(), 'existing-id');
  assert.equal(supplied.id, 'existing-id');

  // The generated value is random, so assert only that identity exists and is
  // not shared between two separate mappings of the same payload.
  const generated = mapApifyProfile(sparseApifyProfile());
  const alsoGenerated = mapApifyProfile(sparseApifyProfile());
  assert.equal(typeof generated.id, 'string');
  assert.ok(generated.id.length > 0);
  assert.notEqual(generated.id, alsoGenerated.id);
});

test('generates an ID when the supplied one is blank', () => {
  const profile = mapApifyProfile(sparseApifyProfile(), '   ');

  assert.notEqual(profile.id, '   ');
  assert.ok(profile.id.length > 0);
});

test('maps every supported partial date form', () => {
  const profile = mapApifyProfile({
    linkedinUrl: 'https://www.linkedin.com/in/test-dates',
    experience: [
      {
        position: 'Numeric year and numeric month',
        companyName: 'Example',
        startDate: { year: 2020, month: 4 },
      },
      {
        position: 'String year and abbreviated month',
        companyName: 'Example',
        startDate: { year: '2019', month: 'Jun' },
      },
      {
        position: 'Full month name',
        companyName: 'Example',
        startDate: { year: 2018, month: 'September' },
      },
      {
        position: 'Year without month',
        companyName: 'Example',
        startDate: { year: 2017 },
      },
      {
        position: 'Present text only',
        companyName: 'Example',
        endDate: { text: 'Present' },
      },
    ],
  });

  assert.deepEqual(profile.experience[0]?.startDate, { year: 2020, month: 4 });
  assert.deepEqual(profile.experience[1]?.startDate, { year: 2019, month: 6 });
  assert.deepEqual(profile.experience[2]?.startDate, { year: 2018, month: 9 });
  assert.deepEqual(profile.experience[3]?.startDate, { year: 2017 });

  // "Present" must not invent a year or month.
  assert.deepEqual(profile.experience[4]?.endDate, { text: 'Present' });
  assert.equal(profile.experience[4]?.startDate, undefined);
});

test('drops unusable date components instead of guessing', () => {
  const profile = mapApifyProfile({
    linkedinUrl: 'https://www.linkedin.com/in/test-bad-dates',
    experience: [
      {
        position: 'Out of range month',
        companyName: 'Example',
        startDate: { year: 2020, month: 13 },
      },
      {
        position: 'Two digit year',
        companyName: 'Example',
        startDate: { year: '20' },
      },
      {
        position: 'Entirely unusable date',
        companyName: 'Example',
        startDate: { year: null, month: 'notamonth' },
      },
    ],
  });

  assert.deepEqual(profile.experience[0]?.startDate, { year: 2020 });
  assert.equal(profile.experience[1]?.startDate, undefined);
  assert.equal(profile.experience[2]?.startDate, undefined);
});

test('collapses only exact duplicate employment entries', () => {
  const profile = mapApifyProfile(duplicateEmploymentApifyProfile());

  // Five raw entries, of which the first two are the same job written
  // differently. The other three each differ in one identity component.
  assert.equal(profile.experience.length, 4);
  assert.deepEqual(
    profile.experience.map((item) => `${item.position}@${item.companyName}`),
    [
      'Operations Lead@Example Logistics',
      'Operations Lead@Sample Freight',
      'Operations Director@Example Logistics',
      'Operations Lead@Example Logistics',
    ],
  );

  // The surviving copy keeps the original formatting, not the normalized
  // identity text used for comparison.
  assert.equal(profile.experience[0]?.position, 'Operations Lead');
});

test('keeps simultaneous current roles as separate jobs', () => {
  const profile = mapApifyProfile(simultaneousCurrentRolesApifyProfile());

  assert.equal(profile.experience.length, 2);
  assert.equal(profile.experience[0]?.companyName, 'Example Logistics');
  assert.equal(profile.experience[1]?.companyName, 'Sample Ventures');
});

test('omits entries missing the fields the normalized arrays require', () => {
  const profile = mapApifyProfile(incompleteEntriesApifyProfile());

  assert.deepEqual(profile.experience, []);
  assert.deepEqual(profile.education, []);
});

test('maps education from a school alone and with optional fields', () => {
  const profile = mapApifyProfile({
    linkedinUrl: 'https://www.linkedin.com/in/test-education',
    education: [
      { schoolName: 'Example University' },
      {
        schoolName: 'Sample Institute',
        degree: 'MSc',
        fieldOfStudy: 'Logistics',
        startDate: { year: 2019 },
        endDate: { year: 2021, month: 'jun' },
      },
    ],
  });

  assert.deepEqual(profile.education[0], { schoolName: 'Example University' });
  assert.deepEqual(profile.education[1], {
    schoolName: 'Sample Institute',
    degree: 'MSc',
    fieldOfStudy: 'Logistics',
    startDate: { year: 2019 },
    endDate: { year: 2021, month: 6 },
  });
});

test('keeps the exact raw object supplied by the collector', () => {
  const raw = completeApifyProfile();
  const profile = mapApifyProfile(raw);

  // Object identity, not deep equality: the mapper must not clone the payload.
  assert.equal(profile.raw, raw);
  assert.equal(
    (profile.raw as Record<string, unknown>)[RAW_ONLY_SENTINEL],
    'provider-only value the mapper must not touch',
  );
});

test('ignores non-array experience and education values', () => {
  const profile = mapApifyProfile({
    linkedinUrl: 'https://www.linkedin.com/in/test-non-array',
    experience: 'not an array',
    education: { schoolName: 'Not an array either' },
  });

  assert.deepEqual(profile.experience, []);
  assert.deepEqual(profile.education, []);
});

test('ignores a non-boolean openToWork value', () => {
  const profile = mapApifyProfile({
    linkedinUrl: 'https://www.linkedin.com/in/test-open-to-work',
    openToWork: 'true',
  });

  assert.equal('openToWork' in profile, false);
});

test('omits a location that has no usable text', () => {
  const profile = mapApifyProfile({
    linkedinUrl: 'https://www.linkedin.com/in/test-location',
    location: { countryCode: 'PT', parsed: { city: 'Lisbon' } },
  });

  assert.equal('location' in profile, false);
});
