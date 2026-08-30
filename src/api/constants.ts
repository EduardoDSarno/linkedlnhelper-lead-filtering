/** HTTP status codes the API routes return. */
export const HTTP_STATUS = {
  created: 201,
  badRequest: 400,
  internalError: 500,
} as const;

/** Route paths the API exposes. */
export const API_ROUTES = {
  import: '/import',
} as const;

/** Content type accepted for a raw Linked Helper CSV upload. */
export const CSV_CONTENT_TYPE = 'text/csv';

/** Fastify body-parser mode that yields the upload as raw, undecoded bytes. */
export const PARSE_AS_BUFFER = 'buffer';

/** Default port the API listens on. */
export const DEFAULT_PORT = 3000;