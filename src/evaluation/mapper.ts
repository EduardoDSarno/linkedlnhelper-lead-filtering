/** This file contains the mapper functions for the evaluation pipeline.
 * That maps the raw provider data to the evaluation profile data, and 
 * full profile data to the evaluation profile data.
 */

import { asRecord, asString } from '../helpers/index.js';
import type { ProfileImageAssessment } from '../imageExtractor/index.js';
import type {
  FullProfile,
  ProfileEducation,
  ProfileExperience,
  ProfileLocation,
} from '../profile/index.js';

/**
 * Recursively marks shared profile values as read-only.
 *
 * Evaluation stages inspect normalized profile data owned by FullProfile. The
 * read-only contract prevents accidental mutation without defensively cloning
 * every nested value.
 */
type ReadonlyEvaluationValue<T> = T extends readonly (infer Item)[]
  ? readonly ReadonlyEvaluationValue<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: ReadonlyEvaluationValue<T[Key]> }
    : T;

/** Supplementary provider fields that help interpret one position. */
export interface EvaluationWorkDetails {
  readonly position: string;
  readonly companyName: string;
  readonly description?: string;
  readonly employmentType?: string;
  readonly workplaceType?: string;
}

/**
 * The compact profile data sent to the future AI evaluator.
 *
 * Every field is read-only because filtering and AI stages may inspect shared
 * profile data but must never modify the canonical FullProfile.
 */
export interface EvaluationProfileData {
  readonly profileId: string;
  readonly linkedHelperPublicId?: string;
  readonly headline?: string;
  readonly location?: ReadonlyEvaluationValue<ProfileLocation>;
  readonly openToWork?: boolean;
  readonly hasPhoto: boolean;
  readonly experience: ReadonlyEvaluationValue<ProfileExperience[]>;
  readonly education: ReadonlyEvaluationValue<ProfileEducation[]>;
  readonly imageAnalysis?: ReadonlyEvaluationValue<ProfileImageAssessment>;
  readonly about?: string;
  readonly workDetails?: ReadonlyEvaluationValue<EvaluationWorkDetails[]>;
}

/** Reports whether the profile includes a usable photo URL. */
function hasProfilePhoto(photo: FullProfile['photo']): boolean {
  return typeof photo === 'string' && photo.length > 0;
}

/** Reads the About text from the untouched provider payload, when present. */
function aboutFromRaw(raw: unknown): string | undefined {
  const rawProfile = asRecord(raw);
  return rawProfile ? asString(rawProfile['about']) : undefined;
}

/** Maps one raw experience object into compact work details, or skips it. */
function mapWorkDetail(value: unknown): EvaluationWorkDetails | undefined {
  const experience = asRecord(value);
  if (!experience) return undefined;

  const position = asString(experience['position']);
  const companyName = asString(experience['companyName']);
  const description = asString(experience['description']);
  const employmentType = asString(experience['employmentType']);
  const workplaceType = asString(experience['workplaceType']);

  if (!position || !companyName) return undefined;
  if (!description && !employmentType && !workplaceType) return undefined;

  return {
    position,
    companyName,
    ...(description ? { description } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(workplaceType ? { workplaceType } : {}),
  };
}

/** Reads the short provider fields that add meaning beyond normalized work data. */
export function mapWorkDetailsFromRaw(raw: unknown): EvaluationWorkDetails[] {
  const rawExperience = asRecord(raw)?.['experience'];
  if (!Array.isArray(rawExperience)) return [];

  const workDetails: EvaluationWorkDetails[] = [];

  for (const value of rawExperience) {
    const workDetail = mapWorkDetail(value);
    if (workDetail) workDetails.push(workDetail);
  }

  return workDetails;
}

/**
 * Builds the compact evaluation profile from a FullProfile.
 *
 * Optional fields are omitted when absent so the later AI payload stays small
 * and never includes the complete provider record.
 */
export function mapEvaluationProfileData(
  fullProfile: FullProfile,
): EvaluationProfileData {
  const about = aboutFromRaw(fullProfile.raw);
  const workDetails = mapWorkDetailsFromRaw(fullProfile.raw);

  return {
    profileId: fullProfile.id,
    ...(fullProfile.linkedHelperPublicId
      ? { linkedHelperPublicId: fullProfile.linkedHelperPublicId }
      : {}),
    hasPhoto: hasProfilePhoto(fullProfile.photo),
    experience: fullProfile.experience,
    education: fullProfile.education,
    ...(fullProfile.headline ? { headline: fullProfile.headline } : {}),
    ...(fullProfile.location ? { location: fullProfile.location } : {}),
    ...(typeof fullProfile.openToWork === 'boolean'
      ? { openToWork: fullProfile.openToWork }
      : {}),
    ...(fullProfile.imageAnalysis
      ? { imageAnalysis: fullProfile.imageAnalysis.assessment }
      : {}),
    ...(about ? { about } : {}),
    ...(workDetails.length > 0 ? { workDetails } : {}),
  };
}
