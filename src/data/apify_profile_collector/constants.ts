export const LINKEDIN_PROFILE_SCRAPER_ACTOR =
  'harvestapi/linkedin-profile-scraper';
export const PROFILE_DETAILS_MODE = 'Profile details no email ($4 per 1k)';

// HarvestAPI limits free users to MAX_BATCH_SIZE profiles in one Actor run.
// Keeping the same ceiling on paid plans also makes throughput and retries
// predictable.
export const DEFAULT_BATCH_SIZE = 10;
export const MAX_BATCH_SIZE = 10;

// MAX_BATCH_CONCURRENCY concurrent Actor runs of MAX_BATCH_SIZE profiles each
// were verified successfully on the free plan. Keep this bounded even if an
// unsafe environment value is supplied.
export const DEFAULT_BATCH_CONCURRENCY = 10;
export const MAX_BATCH_CONCURRENCY = 10;

// DEFAULT_MAX_ATTEMPTS counts the initial collection round plus every retry
// round, so the default allows two retries. MAX_ATTEMPTS is the hard ceiling
// an option or environment value can raise it to.
export const DEFAULT_MAX_ATTEMPTS = 3;
export const MAX_ATTEMPTS = 5;
export const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
export const RETRY_JITTER_MS = 250;

// HTTP statuses this module reacts to by name. HTTP_CLIENT_ERROR and
// HTTP_SERVER_ERROR are range floors, not single statuses: any status at or
// above them is treated as that class of error.
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_REQUEST_TIMEOUT = 408;
export const HTTP_UNPROCESSABLE_ENTITY = 422;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_CLIENT_ERROR = 400;
export const HTTP_SERVER_ERROR = 500;
