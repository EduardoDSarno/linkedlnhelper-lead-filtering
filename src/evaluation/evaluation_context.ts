import type { FullProfile } from '../profile/index.js';
import type { FullEvaluationCriteria } from './criterias/index.js';
import {
  mapEvaluationProfileData,
  type EvaluationProfileData,
} from './mapper.js';

export type { EvaluationProfileData } from './mapper.js';

/**
 * The complete structured input for one profile evaluation request.
 *
 * Its references are read-only because an evaluation consumes configuration
 * and profile data; it does not own or modify either source.
 */
export interface EvaluationContext {
  readonly criteria: FullEvaluationCriteria;
  readonly profile: EvaluationProfileData;
}

/**
 * The compact profiles that share one campaign's evaluation criteria.
 *
 * The batch is read-only so filters can route profiles without changing the
 * shared evaluation inputs.
 */
export interface EvaluationBatchContext {
  readonly criteria: FullEvaluationCriteria;
  readonly profiles: readonly EvaluationProfileData[];
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
