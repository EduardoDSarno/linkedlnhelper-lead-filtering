import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_THRESHOLDS, parseNewCampaign, parsePeopleSearch } from '../campaigns.js';

const VALID_FORM = {
  linkedinAccountId: '1',
  name: 'Advisors SP',
  prompt: 'Financial advisors in São Paulo.',
  search: { keywords: 'advisor' },
};

test('search keeps known fields and drops blanks, unknown fields and bad degrees', () => {
  assert.deepEqual(
    parsePeopleSearch({
      keywords: '  advisor ',
      title: '',
      locationIds: ['100', '', 7],
      networkDistance: [2, 5],
      evil: 'x',
      titles: { '100': 'São Paulo' },
    }),
    { keywords: 'advisor', locationIds: ['100'], networkDistance: [2], titles: { '100': 'São Paulo' } },
  );
});

test('a valid form becomes automatic-policy criteria with the default thresholds', () => {
  const campaign = parseNewCampaign(VALID_FORM);
  assert.equal(campaign.criteria.systemPrompt, VALID_FORM.prompt);
  assert.deepEqual(campaign.criteria.decisionPolicy, {
    mode: 'automatic',
    minimumApprovalPercent: DEFAULT_THRESHOLDS.approve,
    minimumManualReviewPercent: DEFAULT_THRESHOLDS.review,
  });
  assert.equal('approvedTarget' in campaign, false);
});

test('blank optional numbers are left out; filled ones are kept', () => {
  const campaign = parseNewCampaign({ ...VALID_FORM, approvedTarget: '200', weeklyInviteLimit: '' });
  assert.equal(campaign.approvedTarget, 200);
  assert.equal('weeklyInviteLimit' in campaign, false);
});

test('missing prompt, empty search, bad numbers and inverted thresholds are refused', () => {
  assert.throws(() => parseNewCampaign({ ...VALID_FORM, prompt: ' ' }), /who you are looking for/);
  assert.throws(() => parseNewCampaign({ ...VALID_FORM, search: { keywords: '' } }), /search field/);
  assert.throws(() => parseNewCampaign({ ...VALID_FORM, approvedTarget: '1.5' }), /whole number/);
  assert.throws(() => parseNewCampaign({ ...VALID_FORM, approvalThreshold: '30', reviewThreshold: '60' }));
});
