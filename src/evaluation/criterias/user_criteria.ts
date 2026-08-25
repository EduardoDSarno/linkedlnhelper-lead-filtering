/** The action a campaign takes when one criterion matches a profile. */
export const EVALUATION_EFFECTS = ['include', 'exclude', 'review'] as const;

/** The action a campaign takes when one criterion matches a profile. */
export type EvaluationEffect = (typeof EVALUATION_EFFECTS)[number];

/** The normalized location fields a campaign may compare against. */
export const LOCATION_FIELDS = [
  'text',
  'city',
  'state',
  'country',
  'countryCode',
] as const;

/** One normalized location field available on a profile. */
export type LocationField = (typeof LOCATION_FIELDS)[number];

/** Controls how a location list matches the selected location fields. */
export type LocationMatch = 'any' | 'all';

/** Selects profiles whose reported location matches configured values. */
export interface LocationCriteria {
  locations: string[];
  fields: LocationField[];
  match: LocationMatch;
  effect: EvaluationEffect;
}


/** Controls whether a keyword group needs one or every configured term. */
export type KeywordMatch = 'any' | 'all' | 'none';

/** Keyword single list (user can submit mutliple lists)*/
export interface KeywordList
{
  list?: string[];
  effect: EvaluationEffect;
  match: KeywordMatch;
}

/** Matches an estimated age range for a campaign. */
export interface AgeCriteria {
  minimumAge?: number;
  maximumAge?: number;
  effect: EvaluationEffect;
}

/** Matches an estimated monthly income range for a campaign. */
export interface EstimatedIncomeCriteria {
  minimumMonthlyIncome?: number;
  maximumMonthlyIncome?: number;
  effect: EvaluationEffect;
}

/** Defines an age-specific estimated-income range for a campaign. */
export interface AgeIncomeBandCriteria {
  minimumAge?: number;
  maximumAge?: number;
  minimumMonthlyIncome?: number;
  maximumMonthlyIncome?: number;
  effect: EvaluationEffect;
}

/** Matches an estimated net-worth range when an evaluation can provide one. */
export interface NetWorthCriteria {
  minimumNetWorth?: number;
  maximumNetWorth?: number;
  effect: EvaluationEffect;
}
//. 
/** Configures matching against neutral properties of an analyzed profile photo. */
export interface PhotoReviewCriteria {
  requirePhoto?: boolean;
  requireReview?: boolean;
  effect: EvaluationEffect;
}

/** Matches the profile's reported open-to-work state. */
export interface OpenToWorkCriteria {
  expectedValue: boolean;
  effect: EvaluationEffect;
}

/** The optional criteria a user combines for one profile evaluation. */
export interface FullEvaluationCriteria {
  location?: LocationCriteria;
  keywordLists?: KeywordList[];
  age?: AgeCriteria;
  estimatedIncome?: EstimatedIncomeCriteria;
  ageIncomeBands?: AgeIncomeBandCriteria[];
  netWorth?: NetWorthCriteria;
  photoReview?: PhotoReviewCriteria;
  openToWork?: OpenToWorkCriteria;
  systemPrompt: string;
  userPrompt: string;
}
