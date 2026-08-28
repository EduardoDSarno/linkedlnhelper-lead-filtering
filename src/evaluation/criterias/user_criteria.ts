import type { ProfileLocation } from '../../profile/index.js';

/** A ProfileLocation key the campaign may compare against. */
export type LocationField = keyof ProfileLocation;

/** How a location or keyword list must match profile data. */
export type CriteriaMatch = 'any' | 'all';

/**
 * Allowed current locations for the first pass.
 *
 * A known mismatch excludes the profile. An uncertain location is sent to AI.
 */
export interface LocationCriteria {
  locations: string[];
  fields: LocationField[];
  match: CriteriaMatch;
}

/**
 * One reject-list of keywords.
 *
 * A match excludes the profile before AI. The user can submit several lists.
 */
export interface KeywordList {
  list?: string[];
  match: CriteriaMatch;
}

/**
 * Optional first-pass age cut, reused later by Gemini.
 *
 * Omit this field when age should not cut the first pass.
 */
export interface AgeCriteria {
  minimumAge?: number;
  maximumAge?: number;
}

/** Desired total monthly professional-compensation range for the campaign. */
export interface DesiredMonthlyCompensationCriteria {
  minimumMonthlyCompensation?: number;
  maximumMonthlyCompensation?: number;
}

/** A retained net-worth range that the current evaluator deliberately ignores. */
export interface NetWorthCriteria {
  minimumNetWorth?: number;
  maximumNetWorth?: number;
}

/** Inclusive bounds for a user-configured model-approval match percent. */
export const MODEL_APPROVAL_PERCENT = {
  minimum: 0,
  maximum: 100,
} as const;

/**
 * Lets the model approve profiles that are close enough to the campaign.
 *
 * Omit this field, or set `enabled` to false, to keep final approve/reject
 * with the user. When enabled, the model may approve only at or above
 * `minimumMatchPercent`.
 */
export interface ModelApprovalCriteria {
  enabled: boolean;
  minimumMatchPercent: number;
}

/**
 * Campaign settings for the first pass plus prompts and ranges for later AI.
 *
 * The broad filter only applies hard excludes from location, reject-list
 * keywords, age, photo, and open-to-work. Gemini estimates compensation, and
 * application code compares that estimate with the desired campaign range.
 */
export interface FullEvaluationCriteria {
  location?: LocationCriteria;
  keywordLists?: KeywordList[];
  age?: AgeCriteria;
  desiredMonthlyCompensation?: DesiredMonthlyCompensationCriteria;
  netWorth?: NetWorthCriteria;
  modelApproval?: ModelApprovalCriteria;
  /**
   * When true, profiles without a photo are excluded before AI.
   * Omit this field when photo presence should not cut the first pass.
   */
  requirePhoto?: boolean;
  /**
   * Two-way open-to-work cut. `true` keeps only people marked open to work;
   * `false` keeps only people marked not open to work. Omit to ignore the flag.
   * Unknown profile values still go to AI.
   */
  openToWork?: boolean;
  systemPrompt: string;
  userPrompt?: string;
}
