import assert from 'node:assert/strict';
import test from 'node:test';

import { ACCOUNT_CAPS, accountCap } from '../limits.js';

test('a cap above the hard limit in .env is lowered to the hard limit', () => {
  const tooHigh = String(ACCOUNT_CAPS.invite.hardLimit * 10);
  assert.equal(
    accountCap('invite', { [ACCOUNT_CAPS.invite.environmentKey]: tooHigh }),
    ACCOUNT_CAPS.invite.hardLimit,
  );
});

test('a cap under the hard limit in .env is used as written', () => {
  const lower = ACCOUNT_CAPS.invite.hardLimit - 1;
  assert.equal(
    accountCap('invite', { [ACCOUNT_CAPS.invite.environmentKey]: String(lower) }),
    lower,
  );
});

test('a missing or invalid cap uses the default', () => {
  assert.equal(accountCap('profile_fetch', {}), ACCOUNT_CAPS.profile_fetch.defaultLimit);
  assert.equal(
    accountCap('profile_fetch', { [ACCOUNT_CAPS.profile_fetch.environmentKey]: 'abc' }),
    ACCOUNT_CAPS.profile_fetch.defaultLimit,
  );
});

test('no default is above its hard limit', () => {
  for (const cap of Object.values(ACCOUNT_CAPS)) {
    assert.ok(cap.defaultLimit <= cap.hardLimit);
  }
});
