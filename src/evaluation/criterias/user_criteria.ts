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

/** An estimated monthly-income range used by the later AI evaluation. */
export interface EstimatedIncomeCriteria {
  minimumMonthlyIncome?: number;
  maximumMonthlyIncome?: number;
}

/** An age-specific estimated-income range used by the later AI evaluation. */
export interface AgeIncomeBandCriteria {
  minimumAge?: number;
  maximumAge?: number;
  minimumMonthlyIncome?: number;
  maximumMonthlyIncome?: number;
}

/** An estimated net-worth range used by the later AI evaluation. */
export interface NetWorthCriteria {
  minimumNetWorth?: number;
  maximumNetWorth?: number;
}

/**
 * Campaign settings for the first pass plus prompts and ranges for later AI.
 *
 * The broad filter only applies hard excludes from location, reject-list
 * keywords, age, photo, and open-to-work. Money ranges stay here for Gemini.
 */
export interface FullEvaluationCriteria {
  location?: LocationCriteria;
  keywordLists?: KeywordList[];
  age?: AgeCriteria;
  estimatedIncome?: EstimatedIncomeCriteria;
  ageIncomeBands?: AgeIncomeBandCriteria[];
  netWorth?: NetWorthCriteria;
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
