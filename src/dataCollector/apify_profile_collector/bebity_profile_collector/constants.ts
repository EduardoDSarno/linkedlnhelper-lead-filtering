export const BEBITY_LINKEDIN_PREMIUM_ACTOR = 'bebity/linkedin-premium-actor';
export const DEFAULT_BEBITY_CONCURRENCY = 15;
export const BEBITY_BATCH_CONCURRENCY_ENVIRONMENT_KEY = 'BEBITY_BATCH_CONCURRENCY';
export const DEFAULT_BEBITY_PROFILE_FIELDS = ['about', 'experience'] as const;
export const BEBITY_PROFILE_FIELDS_ENVIRONMENT_KEY = 'BEBITY_PROFILE_FIELDS';
export const BEBITY_PROFILE_FIELD_VALUES = ['about', 'experience', 'languages', 'skills', 'honors', 'projects', 'organizations'] as const;
export type BebityProfileField = (typeof BEBITY_PROFILE_FIELD_VALUES)[number];
