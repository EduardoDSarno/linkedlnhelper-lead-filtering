import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProfileImageAssessment } from '../profile_image_assessment.js';
import {
  imageAssessmentJsonWith,
  validImageAssessment,
  validImageAssessmentJson,
} from '../../test_support/image_assessment_fixtures.js';

const INVALID_SHAPE = /invalid image assessment shape/;
const MALFORMED_JSON = /malformed JSON/;

test('parses a complete valid assessment', () => {
  const parsed = parseProfileImageAssessment(validImageAssessmentJson());

  assert.deepEqual(parsed, validImageAssessment());
});

test('copies only the known fields out of the response', () => {
  const parsed = parseProfileImageAssessment(
    imageAssessmentJsonWith({ unexpectedField: 'should not survive' }),
  );

  // The parser builds a new object field by field, so provider additions are
  // dropped rather than passed through into the application model.
  assert.equal('unexpectedField' in parsed, false);
  assert.deepEqual(parsed, validImageAssessment());
});

test('rejects malformed JSON with a dedicated message', () => {
  assert.throws(
    () => parseProfileImageAssessment('{ not json'),
    MALFORMED_JSON,
  );
  assert.throws(() => parseProfileImageAssessment(''), MALFORMED_JSON);
});

test('rejects JSON that is not an object', () => {
  for (const responseText of ['null', '"text"', '42', 'true', '[]']) {
    assert.throws(
      () => parseProfileImageAssessment(responseText),
      /non-object image assessment|invalid image assessment shape/,
      `expected ${responseText} to be rejected`,
    );
  }
});

test('rejects a response missing any required property', () => {
  const requiredFields = Object.keys(validImageAssessment());

  for (const field of requiredFields) {
    assert.throws(
      () => parseProfileImageAssessment(imageAssessmentJsonWith({
        [field]: undefined,
      })),
      /invalid image assessment shape|invalid apparent age estimate/,
      `expected a missing ${field} to be rejected`,
    );
  }
});

test('rejects unsupported enum values', () => {
  const unsupported: Record<string, unknown> = {
    faceVisibility: 'mostly_clear',
    imageQuality: 'excellent',
    photoType: 'portrait',
    framing: 'close_up',
    background: 'office',
    attire: 'smart',
    certainty: 'confident',
  };

  for (const [field, value] of Object.entries(unsupported)) {
    assert.throws(
      () => parseProfileImageAssessment(imageAssessmentJsonWith({
        [field]: value,
      })),
      INVALID_SHAPE,
      `expected ${field}: ${String(value)} to be rejected`,
    );
  }
});

test('rejects unusable face counts', () => {
  for (const faceCount of [-1, 1.5, 21, Number.NaN, '1']) {
    assert.throws(
      () => parseProfileImageAssessment(imageAssessmentJsonWith({ faceCount })),
      INVALID_SHAPE,
      `expected faceCount ${String(faceCount)} to be rejected`,
    );
  }
});

test('accepts the boundary face counts', () => {
  // Zero faces is a real result for a logo or a landscape photo, and the
  // documented ceiling must itself remain valid.
  assert.equal(
    parseProfileImageAssessment(imageAssessmentJsonWith({ faceCount: 0 }))
      .faceCount,
    0,
  );
  assert.equal(
    parseProfileImageAssessment(imageAssessmentJsonWith({ faceCount: 20 }))
      .faceCount,
    20,
  );
});

test('rejects non-boolean flags', () => {
  for (const field of ['hasFace', 'isBlurry', 'isPoorlyLit', 'reviewRequired']) {
    assert.throws(
      () => parseProfileImageAssessment(imageAssessmentJsonWith({
        [field]: 'true',
      })),
      INVALID_SHAPE,
      `expected a string ${field} to be rejected`,
    );
  }
});

test('rejects observations that are not short string arrays', () => {
  const invalidObservations: unknown[] = [
    'a single string',
    [1, 2],
    [{ text: 'object' }],
    ['one', 'two', 'three', 'four', 'five', 'six'],
  ];

  for (const observations of invalidObservations) {
    assert.throws(
      () => parseProfileImageAssessment(imageAssessmentJsonWith({
        observations,
      })),
      INVALID_SHAPE,
      `expected ${JSON.stringify(observations)} to be rejected`,
    );
  }
});

test('accepts the observation count boundaries', () => {
  assert.deepEqual(
    parseProfileImageAssessment(imageAssessmentJsonWith({ observations: [] }))
      .observations,
    [],
  );

  const five = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(
    parseProfileImageAssessment(
      imageAssessmentJsonWith({ observations: five }),
    ).observations,
    five,
  );
});

test('rejects an apparent age that is missing or misshapen', () => {
  const invalid: unknown[] = [
    undefined,
    {},
    { bracket: '35_44' },
    { confidence: 'medium' },
    { bracket: 'middle_aged', confidence: 'medium' },
    { bracket: '35_44', confidence: 'very_sure' },
    'unknown',
  ];

  for (const apparentAge of invalid) {
    assert.throws(
      () => parseProfileImageAssessment(imageAssessmentJsonWith({
        apparentAge,
      })),
      /invalid apparent age estimate|invalid image assessment shape/,
      `expected ${JSON.stringify(apparentAge)} to be rejected`,
    );
  }
});

test('normalizes an unknown bracket to unassessable confidence', () => {
  // A bracket of "unknown" cannot carry a real confidence, so the pair is
  // corrected rather than rejected: the rest of the assessment is still usable.
  const parsed = parseProfileImageAssessment(
    imageAssessmentJsonWith({
      apparentAge: { bracket: 'unknown', confidence: 'high' },
    }),
  );

  assert.deepEqual(parsed.apparentAge, {
    bracket: 'unknown',
    confidence: 'unassessable',
  });
});

test('normalizes unassessable confidence to the unknown bracket', () => {
  const parsed = parseProfileImageAssessment(
    imageAssessmentJsonWith({
      apparentAge: { bracket: '25_34', confidence: 'unassessable' },
    }),
  );

  assert.deepEqual(parsed.apparentAge, {
    bracket: 'unknown',
    confidence: 'unassessable',
  });
});

test('keeps a consistent apparent age pair unchanged', () => {
  const parsed = parseProfileImageAssessment(
    imageAssessmentJsonWith({
      apparentAge: { bracket: '55_64', confidence: 'low' },
    }),
  );

  assert.deepEqual(parsed.apparentAge, {
    bracket: '55_64',
    confidence: 'low',
  });
});

test('accepts every documented bracket and confidence combination', () => {
  const brackets = ['under_25', '25_34', '35_44', '45_54', '55_64', '65_plus'];

  for (const bracket of brackets) {
    for (const confidence of ['high', 'medium', 'low']) {
      const parsed = parseProfileImageAssessment(
        imageAssessmentJsonWith({ apparentAge: { bracket, confidence } }),
      );

      assert.deepEqual(parsed.apparentAge, { bracket, confidence });
    }
  }
});

test('tolerates surrounding whitespace in the response text', () => {
  const parsed = parseProfileImageAssessment(
    `\n  ${validImageAssessmentJson()}\n`,
  );

  assert.deepEqual(parsed, validImageAssessment());
});
