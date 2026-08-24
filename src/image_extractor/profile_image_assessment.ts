import {
  APPARENT_AGE_BRACKETS,
  APPARENT_AGE_CONFIDENCE_VALUES,
} from './profile_image_types.js';
import { PROFILE_IMAGE_LIMITS } from './config.js';
import type {
  ApparentAgeEstimate,
  ProfileImageAssessment,
} from './profile_image_types.js';

const FACE_VISIBILITY_VALUES = [
  'clear',
  'partial',
  'unclear',
  'not_applicable',
] as const;
const IMAGE_QUALITY_VALUES = ['good', 'usable', 'poor'] as const;
const PHOTO_TYPE_VALUES = [
  'professional_portrait',
  'selfie',
  'mirror_selfie',
  'group_photo',
  'other',
] as const;
const FRAMING_VALUES = [
  'headshot',
  'upper_body',
  'full_body',
  'unclear',
] as const;
const BACKGROUND_VALUES = [
  'plain',
  'workplace',
  'outdoor',
  'domestic',
  'other',
  'unclear',
] as const;
const ATTIRE_VALUES = [
  'formal',
  'business_casual',
  'casual',
  'unclear',
] as const;
const CERTAINTY_VALUES = ['certain', 'uncertain', 'unassessable'] as const;

/** Narrows parsed JSON to a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks one provider value against a readonly string enum. */
function isOneOf<const T extends readonly string[]>(
  value: unknown,
  accepted: T,
): value is T[number] {
  return typeof value === 'string' && accepted.includes(value);
}

/** Validates and reconciles Gemini's apparent-age bracket and confidence. */
function validateApparentAge(value: unknown): ApparentAgeEstimate {
  if (
    !isRecord(value) ||
    !isOneOf(value['bracket'], APPARENT_AGE_BRACKETS) ||
    !isOneOf(value['confidence'], APPARENT_AGE_CONFIDENCE_VALUES)
  ) {
    throw new Error('Gemini returned an invalid apparent age estimate.');
  }

  // An "unknown" bracket cannot carry a real confidence, and a confident
  // reading cannot be unassessable. Normalize rather than reject, because the
  // rest of the assessment is still usable when only this pair disagrees.
  if (
    value['bracket'] === 'unknown' ||
    value['confidence'] === 'unassessable'
  ) {
    return { bracket: 'unknown', confidence: 'unassessable' };
  }

  return {
    bracket: value['bracket'],
    confidence: value['confidence'],
  };
}

/** Validates every required assessment field before it enters the domain. */
function validateAssessment(value: unknown): ProfileImageAssessment {
  if (!isRecord(value)) {
    throw new Error('Gemini returned a non-object image assessment.');
  }

  if (
    typeof value['hasFace'] !== 'boolean' ||
    typeof value['faceCount'] !== 'number' ||
    !Number.isInteger(value['faceCount']) ||
    value['faceCount'] < 0 ||
    value['faceCount'] > PROFILE_IMAGE_LIMITS.faceCount ||
    !isOneOf(value['faceVisibility'], FACE_VISIBILITY_VALUES) ||
    !isOneOf(value['imageQuality'], IMAGE_QUALITY_VALUES) ||
    typeof value['isBlurry'] !== 'boolean' ||
    typeof value['isPoorlyLit'] !== 'boolean' ||
    !isOneOf(value['photoType'], PHOTO_TYPE_VALUES) ||
    !isOneOf(value['framing'], FRAMING_VALUES) ||
    !isOneOf(value['background'], BACKGROUND_VALUES) ||
    !isOneOf(value['attire'], ATTIRE_VALUES) ||
    !isOneOf(value['certainty'], CERTAINTY_VALUES) ||
    typeof value['reviewRequired'] !== 'boolean' ||
    !Array.isArray(value['observations']) ||
    value['observations'].length > PROFILE_IMAGE_LIMITS.observationCount ||
    !value['observations'].every(
      (observation) => typeof observation === 'string',
    )
  ) {
    throw new Error('Gemini returned an invalid image assessment shape.');
  }

  return {
    hasFace: value['hasFace'],
    faceCount: value['faceCount'],
    faceVisibility: value['faceVisibility'],
    imageQuality: value['imageQuality'],
    isBlurry: value['isBlurry'],
    isPoorlyLit: value['isPoorlyLit'],
    photoType: value['photoType'],
    framing: value['framing'],
    background: value['background'],
    attire: value['attire'],
    apparentAge: validateApparentAge(value['apparentAge']),
    certainty: value['certainty'],
    reviewRequired: value['reviewRequired'],
    observations: value['observations'],
  };
}

/**
 * Validates one Gemini response into a profile image assessment.
 *
 * The response is structured output, but structured output is a request rather
 * than a guarantee, so every field is checked before it enters the application
 * model. Only known fields are copied across; anything the provider adds is
 * dropped rather than passed through.
 *
 * @param responseText - Raw JSON text returned by Gemini.
 * @returns A fully validated assessment.
 * @throws When the text is not JSON, is not an object, or fails validation.
 */
export function parseProfileImageAssessment(
  responseText: string,
): ProfileImageAssessment {
  try {
    return validateAssessment(JSON.parse(responseText));
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new Error('Gemini returned malformed JSON for the image assessment.');
    }
    throw error;
  }
}
