import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasCareerColumns,
  mapLinkedHelperCsvProfile,
} from '../linked_helper_csv_profile_mapper.js';
import { toImportedCsvProfile } from '../../profile/index.js';
import { linkedHelperRow } from '../../test_support/linked_helper_csv_fixtures.js';

/** Career columns for two jobs and two schools, shaped like the real export. */
function careerColumns(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    summary: 'Runs regional logistics operations.',
    location_name: 'Campo Grande, Mato Grosso do Sul, Brasil',
    organization_1: 'Example Logistics',
    organization_title_1: 'Operations Lead',
    organization_start_1: '2024.05',
    organization_end_1: '',
    organization_location_1: 'Campo Grande, Mato Grosso do Sul, Brasil · Híbrido',
    position_description_1: 'Leads the distribution team.',
    organization_2: 'Old Freight Ltda.',
    organization_title_2: 'Coordinator',
    organization_start_2: '2019',
    organization_end_2: '2024.04',
    organization_location_2: '',
    position_description_2: 'CoordinatorOld Freight Ltda. · Tempo integral',
    education_1: 'Example University',
    education_degree_1: 'MBA',
    education_fos_1: 'Logistics',
    education_start_1: '2020.02',
    education_end_1: '2021.11',
    education_2: 'Example College',
    education_degree_2: '',
    education_fos_2: '',
    education_start_2: '',
    education_end_2: '',
    ...overrides,
  };
}

/** Maps one fixture row through the importer and the converter. */
function mapRow(overrides: Record<string, string> = {}) {
  const imported = toImportedCsvProfile(linkedHelperRow(careerColumns(overrides)));
  return mapLinkedHelperCsvProfile(imported, () => 'profile-1');
}

test('maps identity, About, photo and location from a Linked Helper row', () => {
  const profile = mapRow();

  assert.equal(profile.id, 'profile-1');
  assert.equal(profile.linkedHelperPublicId, 'test-person-001');
  assert.equal(profile.linkedinUrl, 'https://www.linkedin.com/in/test-person-001');
  assert.equal(profile.about, 'Runs regional logistics operations.');
  assert.equal(profile.photoSource, 'linkedHelper');
  assert.equal(profile.openToWork, true);
  assert.deepEqual(profile.location, {
    text: 'Campo Grande, Mato Grosso do Sul, Brasil',
    city: 'Campo Grande',
    state: 'Mato Grosso do Sul',
    country: 'Brasil',
    countryCode: 'BR',
  });
});

test('maps jobs newest first, leaving an open role without an end date', () => {
  const [current, previous] = mapRow().experience;

  assert.deepEqual(current, {
    position: 'Operations Lead',
    companyName: 'Example Logistics',
    location: 'Campo Grande, Mato Grosso do Sul, Brasil',
    workplaceType: 'Híbrido',
    description: 'Leads the distribution team.',
    startDate: { year: 2024, month: 5, text: '2024.05' },
  });
  assert.deepEqual(previous, {
    position: 'Coordinator',
    companyName: 'Old Freight Ltda.',
    employmentType: 'Tempo integral',
    startDate: { year: 2019, text: '2019' },
    endDate: { year: 2024, month: 4, text: '2024.04' },
  });
});

test('keeps a real description that merely starts with the subtitle', () => {
  const longText = `CoordinatorOld Freight Ltda. ${'and much more detail '.repeat(5)}`;
  const [, previous] = mapRow({ position_description_2: longText }).experience;

  assert.equal(previous?.description, longText.trim());
  assert.equal(previous?.employmentType, undefined);
});

test('maps schools and skips empty job and school groups', () => {
  const profile = mapRow({ organization_title_2: '' });

  assert.equal(profile.experience.length, 1);
  assert.deepEqual(profile.education, [
    {
      schoolName: 'Example University',
      degree: 'MBA',
      fieldOfStudy: 'Logistics',
      startDate: { year: 2020, month: 2, text: '2020.02' },
      endDate: { year: 2021, month: 11, text: '2021.11' },
    },
    { schoolName: 'Example College' },
  ]);
});

test('keeps a location without a Brazilian state as unsplit text', () => {
  assert.deepEqual(mapRow({ location_name: 'Lisbon, Portugal' }).location, {
    text: 'Lisbon, Portugal',
  });
});

test('keeps the city when it shares its name with the state', () => {
  assert.equal(
    mapRow({ location_name: 'São Paulo, São Paulo, Brasil' }).location?.city,
    'São Paulo',
  );
});

test('recognizes only exports that carry career columns', () => {
  assert.equal(hasCareerColumns(linkedHelperRow(careerColumns())), true);
  assert.equal(hasCareerColumns(linkedHelperRow()), false);
});
