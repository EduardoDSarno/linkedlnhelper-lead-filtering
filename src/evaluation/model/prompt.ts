import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../context.js';
import type { ModelPart } from '../../models/index.js';
import {
  MODEL_EVALUATION_CLOSING,
  MODEL_EVALUATION_EMPTY_CAMPAIGN_CRITERIA,
  MODEL_EVALUATION_EMPTY_USER_PROMPT,
  MODEL_EVALUATION_PROFILE_BLOCK,
  MODEL_EVALUATION_PROFILE_IMAGE_LABEL,
  MODEL_EVALUATION_PROFILE_IMAGE_MISSING,
  MODEL_EVALUATION_PROMPT_SLOTS,
  MODEL_EVALUATION_REQUEST_HEADER,
  MODEL_EVALUATION_SYSTEM_INSTRUCTION,
} from './config.js';

/** Campaign fields the model may use, excluding net worth and prompt text. */
interface ModelCampaignCriteria {
  location?: FullEvaluationCriteria['location'];
  keywordLists?: FullEvaluationCriteria['keywordLists'];
  age?: FullEvaluationCriteria['age'];
  requirePhoto?: boolean;
  openToWork?: boolean;
}

/** The two prompt channels used by one evaluation request. */
export interface ModelEvaluationPrompt {
  readonly systemInstruction: string;
  readonly parts: readonly ModelPart[];
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

/** Builds the protected instruction layer plus the user's primary campaign prompt. */
function systemInstruction(criteria: FullEvaluationCriteria): string {
  return fillPromptTemplate(MODEL_EVALUATION_SYSTEM_INSTRUCTION, {
    [MODEL_EVALUATION_PROMPT_SLOTS.systemPrompt]: criteria.systemPrompt.trim(),
  });
}

/** Drops the loaded photo bytes so they are not repeated as JSON text. */
function profileTextPayload(
  profile: EvaluationProfileData,
): Omit<EvaluationProfileData, 'photo'> {
  const { photo: _photo, ...textFields } = profile;
  return textFields;
}

/**
 * Builds the parts for one profile: its text block, then either its photo or a
 * note that no photo exists.
 *
 * The profile ID is repeated in the image label so the model can bind each
 * image to the profile it belongs to. Sending images as an unlabelled sequence
 * is what would let a batched request attribute one person's photo to another.
 */
function profileParts(profile: EvaluationProfileData): ModelPart[] {
  const slots = {
    [MODEL_EVALUATION_PROMPT_SLOTS.profileId]: profile.profileId,
    [MODEL_EVALUATION_PROMPT_SLOTS.profileJson]: JSON.stringify(
      profileTextPayload(profile),
    ),
  };
  const parts: ModelPart[] = [
    { text: fillPromptTemplate(MODEL_EVALUATION_PROFILE_BLOCK, slots) },
  ];

  if (!profile.photo) {
    parts.push({
      text: fillPromptTemplate(MODEL_EVALUATION_PROFILE_IMAGE_MISSING, slots),
    });
    return parts;
  }

  parts.push({
    text: fillPromptTemplate(MODEL_EVALUATION_PROFILE_IMAGE_LABEL, slots),
  });
  parts.push({ image: profile.photo });
  return parts;
}

/** Builds the header, per-profile blocks with photos, and the closing line. */
function requestParts(
  criteria: FullEvaluationCriteria,
  profiles: readonly EvaluationProfileData[],
): ModelPart[] {
  const campaign = campaignCriteriaForModel(criteria);

  return [
    {
      text: fillPromptTemplate(MODEL_EVALUATION_REQUEST_HEADER, {
        [MODEL_EVALUATION_PROMPT_SLOTS.additionalGuidance]:
          criteria.userPrompt?.trim() || MODEL_EVALUATION_EMPTY_USER_PROMPT,
        [MODEL_EVALUATION_PROMPT_SLOTS.campaignCriteria]: campaign
          ? JSON.stringify(campaign)
          : MODEL_EVALUATION_EMPTY_CAMPAIGN_CRITERIA,
      }),
    },
    ...profiles.flatMap(profileParts),
    { text: MODEL_EVALUATION_CLOSING },
  ];
}

/** Builds both prompt channels for one group of compact profiles. */
export function buildModelEvaluationPrompt(
  criteria: FullEvaluationCriteria,
  profiles: readonly EvaluationProfileData[],
): ModelEvaluationPrompt {
  return {
    systemInstruction: systemInstruction(criteria),
    parts: requestParts(criteria, profiles),
  };
}
