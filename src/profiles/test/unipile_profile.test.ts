import assert from 'node:assert/strict';
import test from 'node:test';

import { mapEvaluationProfileData } from '../../evaluation/mapper.js';
import { createFakeLinkedinClient } from '../../linkedin/fake/fake_client.js';
import { mapUnipileProfile, unipileDate } from '../sources/unipile/unipile_profile.js';

test('dates in every shape seen are read; unknown text is kept as text', () => {
  assert.deepEqual(unipileDate('3/2021'), { month: 3, year: 2021 });
  assert.deepEqual(unipileDate('2021-03-01T00:00:00.000Z'), { year: 2021, month: 3 });
  assert.deepEqual(unipileDate('2021'), { year: 2021 });
  assert.deepEqual(unipileDate('soon'), { text: 'soon' });
  assert.equal(unipileDate(null), undefined);
});

test('a Unipile profile maps to what the evaluation reads, keyed by member id', async () => {
  const client = createFakeLinkedinClient();
  const data = await client.getProfile('acc', 'fake-member-0');
  const profile = mapUnipileProfile('fake-member-0', data);

  assert.equal(profile.id, 'fake-member-0');
  assert.equal(profile.experience[0]?.endDate?.text, 'Present');
  assert.ok(profile.education.length > 0);

  const evaluation = mapEvaluationProfileData(profile);
  assert.equal(evaluation.profileId, 'fake-member-0');
  assert.equal(evaluation.careerTimeline.isCurrentlyEmployed, true);
  assert.ok(evaluation.about);
  assert.equal(evaluation.hasPhoto, false);
});
