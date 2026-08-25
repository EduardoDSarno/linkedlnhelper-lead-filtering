import { asRecord, asString } from '../helpers/index.js';
import type { ProfileExperience, ProfileLocation } from '../profile/index.js';
import type { FullProfile } from '../profile/index.js';
import type { ProfileImageAssessment } from '../image_extractor/index.js';
import type { FullEvaluationCriteria } from './criterias/index.js';

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
  experience: ProfileExperience[];
  imageAnalysis?: ProfileImageAssessment;
  about?: string;
  workDetails?: EvaluationWorkDetails[];
}

/** The complete structured input for one profile evaluation request.
 * Containing Criteria and Profile Data
*/
export interface EvaluationContext {
  criteria: FullEvaluationCriteria;
  profile: EvaluationProfileData;
}

/** Reads the short provider fields that add meaning beyond normalized work data. */
function workDetailsFromRaw(raw: unknown): EvaluationWorkDetails[] {
  const rawProfile = asRecord(raw);
  const rawExperience = rawProfile?.['experience'];

  if (!Array.isArray(rawExperience)) return [];

  const workDetails: EvaluationWorkDetails[] = [];

  for (const value of rawExperience) {
    const experience = asRecord(value);
    if (!experience) continue;

    const position = asString(experience['position']);
    const companyName = asString(experience['companyName']);
    const description = asString(experience['description']);
    const employmentType = asString(experience['employmentType']);
    const workplaceType = asString(experience['workplaceType']);

    if (!position || !companyName) continue;
    if (!description && !employmentType && !workplaceType) continue;

    workDetails.push({
      position,
      companyName,
      ...(description ? { description } : {}),
      ...(employmentType ? { employmentType } : {}),
      ...(workplaceType ? { workplaceType } : {}),
    });
  }

  return workDetails;
}

/** Builds the compact, structured profile payload used by a future AI evaluator. */
export function createEvaluationContext(
  fullProfile: FullProfile,
  criteria: FullEvaluationCriteria,
): EvaluationContext {
  const rawProfile = asRecord(fullProfile.raw);
  const about = rawProfile ? asString(rawProfile['about']) : undefined;
  const workDetails = workDetailsFromRaw(fullProfile.raw);

  return {
    criteria,
    profile: {
      profileId: fullProfile.id,
      ...(fullProfile.headline ? { headline: fullProfile.headline } : {}),
      ...(fullProfile.location ? { location: fullProfile.location } : {}),
      ...(typeof fullProfile.openToWork === 'boolean'
        ? { openToWork: fullProfile.openToWork }
        : {}),
      experience: fullProfile.experience.map((experience) => ({
        ...experience,
      })),
      ...(fullProfile.imageAnalysis
        ? { imageAnalysis: fullProfile.imageAnalysis.assessment }
        : {}),
      ...(about ? { about } : {}),
      ...(workDetails.length > 0 ? { workDetails } : {}),
    },
  };
}
