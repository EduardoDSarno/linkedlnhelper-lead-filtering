import assert from 'node:assert/strict';
import test from 'node:test';

import { markBebityNotFoundAsFailed } from '../bebity_profile_collector.js';
import { classifyProviderRecord } from '../../error_handling.js';

test('stamps an error field onto a Bebity NOT_FOUND record', () => {
  const record = {
    vanityName: 'fl',
    linkedinUrl: 'https://www.linkedin.com/in/felipe-balduino-camatta-paap',
    reason: 'DOES_NOT_EXIST',
    status: 'NOT_FOUND',
  };

  const marked = markBebityNotFoundAsFailed(record);

  assert.equal(marked['status'], 'NOT_FOUND');
  assert.match(String(marked['error']), /not found/i);
});

test('the stamped record is caught by the shared classifier as a permanent failure', () => {
  const record = {
    linkedinUrl: 'https://www.linkedin.com/in/felipe-balduino-camatta-paap',
    reason: 'DOES_NOT_EXIST',
    status: 'NOT_FOUND',
  };

  const descriptor = classifyProviderRecord(markBebityNotFoundAsFailed(record));

  assert.ok(descriptor, 'a NOT_FOUND record must not be classified as successful');
  assert.equal(descriptor?.category, 'not_found');
  assert.equal(descriptor?.retryable, false);
});

test('leaves a FOUND record untouched', () => {
  const record = {
    vanityName: 'arietamelo',
    linkedinUrl: 'https://www.linkedin.com/in/arietamelo',
    firstName: 'ARIETA',
    status: 'FOUND',
  };

  const marked = markBebityNotFoundAsFailed(record);

  assert.deepEqual(marked, record);
  assert.equal(classifyProviderRecord(marked), undefined);
});
