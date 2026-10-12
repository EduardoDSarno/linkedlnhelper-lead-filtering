import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HARD_MINIMUM_ACTION_DELAY_MS,
  HARD_MINIMUM_INVITE_GAP_MS,
  inviteGapMs,
  isWorkingTime,
  loadPipelineConfig,
} from '../config.js';

test('action delays never go below the hard minimum, and max is never below min', () => {
  const config = loadPipelineConfig({ ACTION_DELAY_MIN_MS: '0', ACTION_DELAY_MAX_MS: '1' });
  assert.equal(config.actionDelayMinMs, HARD_MINIMUM_ACTION_DELAY_MS);
  assert.equal(config.actionDelayMaxMs, HARD_MINIMUM_ACTION_DELAY_MS);
});

test('work days keep only valid ISO weekdays and fall back when none are valid', () => {
  assert.deepEqual(loadPipelineConfig({ WORK_DAYS: '1, 3, 9, x, 3' }).workDays, [1, 3]);
  assert.deepEqual(loadPipelineConfig({ WORK_DAYS: 'none' }).workDays, loadPipelineConfig({}).workDays);
});

test('working time is read in the configured timezone, not the server one', () => {
  const config = loadPipelineConfig({ WORK_TIMEZONE: 'America/Sao_Paulo', WORK_START_HOUR: '9', WORK_END_HOUR: '18' });
  // Wednesday 2026-10-14: 12:00 UTC is 09:00 in São Paulo (UTC-3), 21:30 UTC is 18:30.
  assert.equal(isWorkingTime(new Date('2026-10-14T12:00:00Z'), config), true);
  assert.equal(isWorkingTime(new Date('2026-10-14T11:59:00Z'), config), false);
  assert.equal(isWorkingTime(new Date('2026-10-14T21:30:00Z'), config), false);
  // Saturday 2026-10-17 at noon São Paulo time.
  assert.equal(isWorkingTime(new Date('2026-10-17T15:00:00Z'), config), false);
});

test('invite gaps spread the daily share over working hours but never drop below the hard minimum', () => {
  const config = loadPipelineConfig({ WORK_START_HOUR: '9', WORK_END_HOUR: '18' });
  const evenSpacingMs = ((18 - 9) * 60 * 60 * 1000) / 20;
  for (let i = 0; i < 50; i++) {
    const gap = inviteGapMs(config, 20);
    assert.ok(gap >= evenSpacingMs * 0.5 && gap <= evenSpacingMs * 1.5);
  }
  assert.equal(inviteGapMs(config, 100_000), HARD_MINIMUM_INVITE_GAP_MS);
});
