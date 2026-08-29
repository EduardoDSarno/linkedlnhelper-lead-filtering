export const LINKEDIN_PROFILE_SCRAPER_ACTOR =
  'harvestapi/linkedin-profile-scraper';
export const PROFILE_DETAILS_MODE = 'Profile details no email ($4 per 1k)';

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
