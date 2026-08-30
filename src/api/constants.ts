/** HTTP status codes the API routes return. */
export const HTTP_STATUS = {
  created: 201,
  badRequest: 400,
  notFound: 404,
  ok: 200,
  internalError: 500,
} as const;

/** Route paths the API exposes. */
export const API_ROUTES = {
  import: '/import',
  review: '/run_filter',
} as const;

/** Field names shared by the API request and response bodies. */
export const API_FIELD = {
  processingId: 'processingId',
  criteria: 'criteria',
} as const;

/** Content type accepted for a raw Linked Helper CSV upload. */
export const CSV_CONTENT_TYPE = 'text/csv';

/** Fastify body-parser mode that yields the upload as raw, undecoded bytes. */
export const PARSE_AS_BUFFER = 'buffer';

/** Default port the API listens on. */
export const DEFAULT_PORT = 3000;