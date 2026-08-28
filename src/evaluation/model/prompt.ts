import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../context.js';
import {
  MODEL_EVALUATION_EMPTY_CAMPAIGN_CRITERIA,
  MODEL_EVALUATION_EMPTY_USER_PROMPT,
  MODEL_EVALUATION_PROMPT_SLOTS,
  MODEL_EVALUATION_SYSTEM_INSTRUCTION,
  MODEL_EVALUATION_USER_CONTENT,
} from './config.js';

/** Campaign fields the model may use, excluding net worth and prompt text. */
interface ModelCampaignCriteria {
  location?: FullEvaluationCriteria['location'];
  keywordLists?: FullEvaluationCriteria['keywordLists'];
  age?: FullEvaluationCriteria['age'];
  requirePhoto?: boolean;
  openToWork?: boolean;
}

/** The two prompt channels used by one Gemini evaluation request. */
export interface ModelEvaluationPrompt {
  readonly systemInstruction: string;
  readonly userContent: string;
}

/**
 * Substitutes named slots in a prompt template with request-specific values.
 */
function fillPromptTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  let filled = template;

  for (const [slot, value] of Object.entries(values)) {
    filled = filled.replaceAll(slot, value);
  }

  return filled;
}

/**
 * Collects the campaign cuts the model should apply, omitting net worth.
 *
 * Net worth and application decision thresholds stay out of model grading.
 */
function campaignCriteriaForModel(
  criteria: FullEvaluationCriteria,
): ModelCampaignCriteria | undefined {
  const campaign: ModelCampaignCriteria = {};

  if (criteria.location) campaign.location = criteria.location;
  if (criteria.keywordLists) campaign.keywordLists = criteria.keywordLists;
  if (criteria.age) campaign.age = criteria.age;
  if (criteria.requirePhoto !== undefined) {
    campaign.requirePhoto = criteria.requirePhoto;
  }
  if (criteria.openToWork !== undefined) {
    campaign.openToWork = criteria.openToWork;
  }

  return Object.keys(campaign).length > 0 ? campaign : undefined;
}

/**
 * Builds the protected instruction layer plus the user's primary campaign prompt.
 *
 * The model receives the compact profile in full, including apparent age and
 * location, and must estimate a monthly salary range from that evidence.
 */
function systemInstruction(criteria: FullEvaluationCriteria): string {
  return fillPromptTemplate(MODEL_EVALUATION_SYSTEM_INSTRUCTION, {
    [MODEL_EVALUATION_PROMPT_SLOTS.systemPrompt]: criteria.systemPrompt.trim(),
  });
}

/** Builds the per-request content containing criteria, guidance, and profiles. */
function userContent(
  criteria: FullEvaluationCriteria,
  profiles: readonly EvaluationProfileData[],
): string {
  const additionalGuidance =
    criteria.userPrompt?.trim() || MODEL_EVALUATION_EMPTY_USER_PROMPT;
  const campaign = campaignCriteriaForModel(criteria);
  const campaignSection = campaign
    ? JSON.stringify(campaign)
    : MODEL_EVALUATION_EMPTY_CAMPAIGN_CRITERIA;

  return fillPromptTemplate(MODEL_EVALUATION_USER_CONTENT, {
    [MODEL_EVALUATION_PROMPT_SLOTS.additionalGuidance]: additionalGuidance,
    [MODEL_EVALUATION_PROMPT_SLOTS.campaignCriteria]: campaignSection,
    [MODEL_EVALUATION_PROMPT_SLOTS.profilesJson]: JSON.stringify(profiles),
  });
}

/** Builds both prompt channels for one group of compact profiles. */
export function buildModelEvaluationPrompt(
  criteria: FullEvaluationCriteria,
  profiles: readonly EvaluationProfileData[],
): ModelEvaluationPrompt {
  return {
    systemInstruction: systemInstruction(criteria),
    userContent: userContent(criteria, profiles),
  };
}
