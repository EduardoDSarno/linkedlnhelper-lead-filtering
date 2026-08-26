/** This file contains the mapper functions for the evaluation pipeline.
 * That maps the raw provider data to the evaluation profile data, and 
 * full profile data to the evaluation profile data.
 */

import { asRecord, asString } from '../helpers/index.js';
import type { ProfileImageAssessment } from '../image_extractor/index.js';
import type {
  FullProfile,
  ProfileExperience,
  ProfileLocation,
} from '../profile/index.js';

/** Supplementary provider fields that help interpret one position. */
export interface EvaluationWorkDetails {
  position: string;
  companyName: string;
  description?: string;
  employmentType?: string;
  workplaceType?: string;
}

/** The compact profile data sent to the future AI evaluator. */
export interface EvaluationProfileData {
  profileId: string;
  headline?: string;
  location?: ProfileLocation;
  openToWork?: boolean;
  hasPhoto: boolean;
  experience: ProfileExperience[];
  imageAnalysis?: ProfileImageAssessment;
  about?: string;
  workDetails?: EvaluationWorkDetails[];
}

/** Reports whether the profile includes a usable photo URL. */
function hasProfilePhoto(photo: FullProfile['photo']): boolean {
  return typeof photo === 'string' && photo.length > 0;
}

/** Copies employment entries so later evaluation cannot mutate the source profile. */
function copyExperience(
  experience: readonly ProfileExperience[],
): ProfileExperience[] {
  return experience.map((entry) => ({ ...entry }));
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

  const profile: EvaluationProfileData = {
    profileId: fullProfile.id,
    hasPhoto: hasProfilePhoto(fullProfile.photo),
    experience: copyExperience(fullProfile.experience),
  };

  if (fullProfile.headline) profile.headline = fullProfile.headline;
  if (fullProfile.location) profile.location = fullProfile.location;
  if (typeof fullProfile.openToWork === 'boolean') {
    profile.openToWork = fullProfile.openToWork;
  }
  if (fullProfile.imageAnalysis) {
    profile.imageAnalysis = fullProfile.imageAnalysis.assessment;
  }
  if (about) profile.about = about;
  if (workDetails.length > 0) profile.workDetails = workDetails;

  return profile;
}
