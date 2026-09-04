export {
  extractProfileImage,
  extractProfileImages,
  extractProfileImagesWithExecutor,
  extractProfilePhoto,
} from './profile_image_extractor.js';
export type { ProfileImageExecutor } from './profile_image_extractor.js';

export {
  GeminiImageError,
  recognizeProfileImageWithGemini,
} from './gemini_profile_image_client.js';
export type {
  GeminiProfileImageRequest,
  GeminiProfileImageResponse,
} from './gemini_profile_image_client.js';

export { loadProfileImage } from './profile_image_loader.js';
export type {
  LoadedProfileImage,
  ProfileImageLoadingOptions,
} from './profile_image_loader.js';

export {
  GEMINI_IMAGE_RETRY_POLICY,
  PROFILE_IMAGE_DEFAULTS,
  PROFILE_IMAGE_LIMITS,
  resolveProfileImageBatchConcurrency,
  resolveProfileImageExtractionOptions,
  resolveProfileImageResolution,
} from './config.js';
export type { ResolvedProfileImageExtractionOptions } from './config.js';

export {
  APPARENT_AGE_BRACKETS,
  APPARENT_AGE_CONFIDENCE_VALUES,
  PROFILE_IMAGE_ASSESSMENT_JSON_SCHEMA,
  PROFILE_IMAGE_MIME_TYPES,
} from './profile_image_types.js';

export type {
  ApparentAgeBracket,
  ApparentAgeConfidence,
  ApparentAgeEstimate,
  GeminiTokenUsage,
  ModelClient,
  ModelTokenUsage,
  ProfileImageAssessment,
  ProfileImageBatchOptions,
  ProfileImageExtractionOptions,
  ProfileImageExtractionResult,
  ProfileImageJob,
  ProfileImageJobResult,
  ProfileImageMimeType,
  ProfileImageResolution,
  ProfileImageSource,
} from './profile_image_types.js';
