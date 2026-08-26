import type { FullProfile } from '../profile/index.js';
import type { FullEvaluationCriteria } from './criterias/index.js';
import {
  mapEvaluationProfileData,
  type EvaluationProfileData,
} from './mapper.js';

export type { EvaluationProfileData } from './mapper.js';

/** The complete structured input for one profile evaluation request.
 * Containing Criteria and Profile Data
*/
export interface EvaluationContext {
  criteria: FullEvaluationCriteria;
  profile: EvaluationProfileData;
}

/** The compact profiles that share one campaign's evaluation criteria. */
export interface EvaluationBatchContext {
  criteria: FullEvaluationCriteria;
  profiles: EvaluationProfileData[];
}

/** Builds the compact, structured profile payload used by a future AI evaluator. */
export function createEvaluationContext(
  fullProfile: FullProfile,
  criteria: FullEvaluationCriteria,
): EvaluationContext {
  return {
    criteria,
    profile: mapEvaluationProfileData(fullProfile),
  };
}

/** Builds one shared-criteria evaluation payload for a group of full profiles. */
export function createEvaluationBatchContext(
  fullProfiles: readonly FullProfile[],
  criteria: FullEvaluationCriteria,
): EvaluationBatchContext {
  return {
    criteria,
    profiles: fullProfiles.map(mapEvaluationProfileData),
  };
}
