import type { ProfileImageAssessment } from '../image_extractor/index.js';

/**
 * Assessment payloads shaped like Gemini structured output, for tests that
 * must never call Gemini.
 *
 * The parser accepts a JSON string, so most fixtures are built as objects and
 * serialized on the way in. That keeps each invalid case readable as a single
 * overridden field rather than a hand-edited JSON blob.
 *
 * Each builder returns a fresh object, so a test that mutates a fixture cannot
 * leak into another test.
 */

/** Builds a valid assessment with every required field populated. */
export function validImageAssessment(): ProfileImageAssessment {
  return {
    hasFace: true,
    faceCount: 1,
    faceVisibility: 'clear',
    imageQuality: 'good',
    isBlurry: false,
    isPoorlyLit: false,
    photoType: 'professional_portrait',
    framing: 'headshot',
    background: 'plain',
    attire: 'business_casual',
    apparentAge: { bracket: '35_44', confidence: 'medium' },
    certainty: 'certain',
    reviewRequired: false,
    observations: ['Even lighting.', 'Subject centered.'],
  };
}

/** Serializes a valid assessment the way Gemini returns it. */
export function validImageAssessmentJson(): string {
  return JSON.stringify(validImageAssessment());
}

/**
 * Serializes a valid assessment with some fields replaced or removed.
 *
 * Pass `undefined` as a value to delete that key, which is how the "missing
 * required property" cases are built.
 */
export function imageAssessmentJsonWith(
  overrides: Record<string, unknown>,
): string {
  // Spread into a fresh literal: ProfileImageAssessment is an interface, so it
  // has no index signature and cannot be assigned to Record directly.
  const assessment: Record<string, unknown> = { ...validImageAssessment() };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete assessment[key];
      continue;
    }

    assessment[key] = value;
  }

  return JSON.stringify(assessment);
}
