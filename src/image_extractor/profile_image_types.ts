export const PROFILE_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/avif',
] as const;

export type ProfileImageMimeType =
  (typeof PROFILE_IMAGE_MIME_TYPES)[number];

export type ProfileImageSource =
  | {
      kind: 'url';
      url: string;
    }
  | {
      kind: 'file';
      path: string;
      mimeType?: ProfileImageMimeType;
    }
  | {
      kind: 'bytes';
      data: Uint8Array;
      mimeType: ProfileImageMimeType;
    };

export type ProfileImageResolution = 'low' | 'medium' | 'high';

/**
 * Brackets rather than a number, because a vision model cannot support the
 * precision an exact age would imply.
 */
export const APPARENT_AGE_BRACKETS = [
  'under_25',
  '25_34',
  '35_44',
  '45_54',
  '55_64',
  '65_plus',
  'unknown',
] as const;

export type ApparentAgeBracket = (typeof APPARENT_AGE_BRACKETS)[number];

export const APPARENT_AGE_CONFIDENCE_VALUES = [
  'high',
  'medium',
  'low',
  'unassessable',
] as const;

export type ApparentAgeConfidence =
  (typeof APPARENT_AGE_CONFIDENCE_VALUES)[number];

/**
 * An impression of how old the person looks, not a fact about them.
 *
 * Apparent age is a protected attribute in hiring, credit and housing
 * decisions, and this estimate is unreliable on top of that. Use it to order
 * manual review, never as an automated accept/reject rule.
 */
export interface ApparentAgeEstimate {
  bracket: ApparentAgeBracket;
  confidence: ApparentAgeConfidence;
}

export interface ProfileImageAssessment {
  hasFace: boolean;
  faceCount: number;

  faceVisibility: 'clear' | 'partial' | 'unclear' | 'not_applicable';
  imageQuality: 'good' | 'usable' | 'poor';

  isBlurry: boolean;
  isPoorlyLit: boolean;

  photoType:
    | 'professional_portrait'
    | 'selfie'
    | 'mirror_selfie'
    | 'group_photo'
    | 'other';

  framing:
    | 'headshot'
    | 'upper_body'
    | 'full_body'
    | 'unclear';

  background:
    | 'plain'
    | 'workplace'
    | 'outdoor'
    | 'domestic'
    | 'other'
    | 'unclear';

  attire:
    | 'formal'
    | 'business_casual'
    | 'casual'
    | 'unclear';

  apparentAge: ApparentAgeEstimate;

  certainty: 'certain' | 'uncertain' | 'unassessable';
  reviewRequired: boolean;

  /** Short, neutral observations about composition or image quality only. */
  observations: string[];
}

export interface GeminiTokenUsage {
  promptTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
}

export interface ProfileImageExtractionResult {
  assessment: ProfileImageAssessment;
  model: string;
  resolution: ProfileImageResolution;
  usage?: GeminiTokenUsage;
}

export interface ProfileImageExtractionOptions {
  model?: string;
  resolution?: ProfileImageResolution;
  requestTimeoutMs?: number;
  imageDownloadTimeoutMs?: number;
  maxImageBytes?: number;
  maxRetries?: number;
}

export interface ProfileImageJob {
  /** Profile ID or another caller-owned correlation value. */
  id: string;
  source: ProfileImageSource;
}

export type ProfileImageJobResult =
  | {
      id: string;
      status: 'fulfilled';
      result: ProfileImageExtractionResult;
    }
  | {
      id: string;
      status: 'rejected';
      error: string;
    };

export interface ProfileImageBatchOptions
  extends ProfileImageExtractionOptions {
  concurrency?: number;
}

/** JSON Schema sent to Gemini so the response is machine-readable. */
export const PROFILE_IMAGE_ASSESSMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hasFace: {
      type: 'boolean',
      description: 'Whether at least one human face is visibly present.',
    },
    faceCount: {
      type: 'integer',
      minimum: 0,
      maximum: 20,
      description: 'Number of clearly visible human faces.',
    },
    faceVisibility: {
      type: 'string',
      enum: ['clear', 'partial', 'unclear', 'not_applicable'],
    },
    imageQuality: {
      type: 'string',
      enum: ['good', 'usable', 'poor'],
    },
    isBlurry: { type: 'boolean' },
    isPoorlyLit: { type: 'boolean' },
    photoType: {
      type: 'string',
      enum: [
        'professional_portrait',
        'selfie',
        'mirror_selfie',
        'group_photo',
        'other',
      ],
    },
    framing: {
      type: 'string',
      enum: ['headshot', 'upper_body', 'full_body', 'unclear'],
    },
    background: {
      type: 'string',
      enum: [
        'plain',
        'workplace',
        'outdoor',
        'domestic',
        'other',
        'unclear',
      ],
    },
    attire: {
      type: 'string',
      enum: ['formal', 'business_casual', 'casual', 'unclear'],
    },
    apparentAge: {
      type: 'object',
      additionalProperties: false,
      description:
        'Apparent age bracket judged from visible facial appearance only.',
      properties: {
        bracket: {
          type: 'string',
          enum: APPARENT_AGE_BRACKETS,
          description:
            'Use "unknown" when no face is visible or the face is too unclear to judge.',
        },
        confidence: {
          type: 'string',
          enum: APPARENT_AGE_CONFIDENCE_VALUES,
          description:
            'Use "unassessable" together with the "unknown" bracket.',
        },
      },
      required: ['bracket', 'confidence'],
    },
    certainty: {
      type: 'string',
      enum: ['certain', 'uncertain', 'unassessable'],
    },
    reviewRequired: { type: 'boolean' },
    observations: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string' },
      description:
        'Short, neutral facts about composition or image quality. No personal judgments.',
    },
  },
  required: [
    'hasFace',
    'faceCount',
    'faceVisibility',
    'imageQuality',
    'isBlurry',
    'isPoorlyLit',
    'photoType',
    'framing',
    'background',
    'attire',
    'apparentAge',
    'certainty',
    'reviewRequired',
    'observations',
  ],
} as const;
